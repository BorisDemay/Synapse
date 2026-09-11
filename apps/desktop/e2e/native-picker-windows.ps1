param(
  [Parameter(Mandatory = $true)][int]$AppProcessId,
  [string]$Directory = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$automation = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]::Descendants
$condition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new($automation::NameProperty, 'Choisir un dossier de coffre Synapse'),
  [System.Windows.Automation.PropertyCondition]::new($automation::ProcessIdProperty, $AppProcessId)
)
$deadline = (Get-Date).AddSeconds(30)
do {
  $dialog = $automation::RootElement.FindFirst($scope, $condition)
  if ($dialog) { break }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
if (!$dialog) { throw 'Owned native folder dialog did not appear' }

$shell = New-Object -ComObject WScript.Shell
if (!$shell.AppActivate('Choisir un dossier de coffre Synapse')) { throw 'Native folder dialog could not be focused' }
if ($Directory) {
  $shell.SendKeys('%d')
  Start-Sleep -Milliseconds 200
  # SendKeys metacharacters must remain literal characters in a filesystem path.
  $literal = [regex]::Replace($Directory, '[+^%~(){}\[\]]', { param($match) '{' + $match.Value + '}' })
  $shell.SendKeys($literal)
  $shell.SendKeys('{ENTER}')
  Start-Sleep -Milliseconds 500
}

# Common Item Dialog uses IDOK=1 and IDCANCEL=2. Invoke the control itself;
# accelerator keys vary with focus and the runner's display language.
$buttonId = if ($Directory) { '1' } else { '2' }
$buttonCondition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty, $buttonId),
  [System.Windows.Automation.PropertyCondition]::new($automation::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
)
$button = $dialog.FindFirst($scope, $buttonCondition)
if (!$button -or !$button.Current.IsEnabled) { throw 'Native folder dialog button is unavailable' }
Write-Output "Invoking native dialog button: $($button.Current.Name)"
$invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()

$deadline = (Get-Date).AddSeconds(30)
do {
  if (!$automation::RootElement.FindFirst($scope, $condition)) {
    Write-Output "Native folder dialog completed (button $buttonId)"
    exit 0
  }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
throw 'Native folder dialog did not close after explicit confirmation'
