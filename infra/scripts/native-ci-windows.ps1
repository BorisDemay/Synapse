param([ValidateSet('start', 'stop')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path $env:RUNNER_TEMP 'synapse-native-postgres'
$statePath = Join-Path $env:RUNNER_TEMP 'synapse-native-postgres.json'

function Invoke-Bounded([string]$Executable, [string[]]$Arguments) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -NoNewWindow -PassThru
  if (!$process.WaitForExit(120000)) {
    $process.Kill($true)
    throw 'Native CI prerequisite exceeded its deadline'
  }
  if ($process.ExitCode -ne 0) { throw 'Native CI prerequisite failed' }
}

if ($Action -eq 'stop') {
  if (Test-Path $statePath) {
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    if ($state.data -ne $taskRoot) { throw 'Unexpected PostgreSQL cleanup ownership' }
    Invoke-Bounded $state.pgCtl @('-D', "`"$taskRoot`"", '-m', 'immediate', '-w', '-t', '30', 'stop')
    Remove-Item $taskRoot -Recurse -Force
    Remove-Item $statePath
  }
  exit 0
}

if ((Test-Path $taskRoot) -or (Test-Path $statePath)) { throw 'Native CI PostgreSQL directory already exists' }
$pgCtl = Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\pg_ctl.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (!$pgCtl) { throw 'Runner PostgreSQL binaries are missing' }
$pgBin = Split-Path $pgCtl.FullName
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
Invoke-Bounded (Join-Path $pgBin 'initdb.exe') @('-D', "`"$taskRoot`"", '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C')
# This disposable cluster listens only on loopback; the harness creates and drops its own database.
@{ data = $taskRoot; pgCtl = $pgCtl.FullName } | ConvertTo-Json | Set-Content $statePath
Invoke-Bounded $pgCtl.FullName @('-D', "`"$taskRoot`"", '-l', "`"$(Join-Path $taskRoot 'server.log')`"", '-o', "`"-h 127.0.0.1 -p $port`"", '-w', '-t', '30', 'start')
$pgBin | Out-File $env:GITHUB_PATH -Encoding utf8 -Append
"SYNAPSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:$port/postgres" | Out-File $env:GITHUB_ENV -Encoding utf8 -Append

# Tauri uses WebView2; match that runtime rather than an independently updated Edge browser.
$runtime = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe" |
  Sort-Object { [version]$_.VersionInfo.ProductVersion } -Descending | Select-Object -First 1
if (!$runtime) { throw 'WebView2 runtime is missing' }
$version = $runtime.VersionInfo.ProductVersion
if ($version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'Invalid WebView2 runtime version' }
$driverRoot = Join-Path $env:RUNNER_TEMP 'synapse-edge-driver'
New-Item -ItemType Directory -Path $driverRoot | Out-Null
$archive = Join-Path $driverRoot 'driver.zip'
Invoke-WebRequest "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip" -OutFile $archive -TimeoutSec 120
Expand-Archive $archive -DestinationPath $driverRoot
$driverVersion = & (Join-Path $driverRoot 'msedgedriver.exe') --version
if ($driverVersion -notmatch [regex]::Escape(($version.Split('.')[0..2] -join '.'))) { throw 'WebView2 and driver versions differ' }
$driverRoot | Out-File $env:GITHUB_PATH -Encoding utf8 -Append
