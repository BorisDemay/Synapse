param(
  [Parameter(Mandatory = $true)][int]$AppProcessId,
  [string]$Directory = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SynapseNativePicker {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, string text);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
}
'@
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
function Owned-Control([string]$Id, [string]$ExpectedClass) {
  $condition = [System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty, $Id)
  $control = $dialog.FindFirst($scope, $condition)
  if (!$control -or !$control.Current.IsEnabled) { throw "Native dialog control $Id is unavailable" }
  $handle = [IntPtr]$control.Current.NativeWindowHandle
  $class = [System.Text.StringBuilder]::new(256)
  [void][SynapseNativePicker]::GetClassName($handle, $class, $class.Capacity)
  if ($handle -eq [IntPtr]::Zero -or $class.ToString() -ne $ExpectedClass) {
    throw "Native dialog control $Id has unexpected class: $class"
  }
  return $handle
}

# The runner exposes these HWND controls as generic UIA panes with no Invoke
# pattern. Use their observed native IDs, but validate the underlying class.
if ($Directory) {
  if (!(Test-Path -LiteralPath $Directory -PathType Container)) { throw 'Test folder is missing' }
  $edit = Owned-Control '1152' 'Edit'
  # WM_SETTEXT on the real folder field: no keyboard shortcuts or navigation race.
  if ([SynapseNativePicker]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $Directory) -eq [IntPtr]::Zero) {
    throw 'Could not set the native folder field'
  }
}
$buttonId = if ($Directory) { '1' } else { '2' }
$button = Owned-Control $buttonId 'Button'
# BM_CLICK triggers the native dialog's normal confirmation/cancellation path.
if (![SynapseNativePicker]::PostMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) {
  throw 'Native dialog click failed'
}

$deadline = (Get-Date).AddSeconds(30)
do {
  if (!$automation::RootElement.FindFirst($scope, $condition)) {
    Write-Output "Native folder dialog completed (button $buttonId)"
    exit 0
  }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
throw 'Native folder dialog did not close after explicit confirmation'
