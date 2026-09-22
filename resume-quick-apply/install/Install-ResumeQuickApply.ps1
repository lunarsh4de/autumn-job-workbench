[CmdletBinding()]
param(
  [switch]$ValidateOnly,
  [string]$Destination,
  [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $sourceRoot 'manifest.json'
$runtimeFiles = @('manifest.json', 'popup.html', 'popup.css', 'popup.js', 'content.js', 'data.js', 'resume-parser.js', 'service-worker.js', 'onboarding.html', 'README.md')
$vendorFiles = @('pdf.min.mjs', 'pdf.worker.min.mjs', 'mammoth.browser.min.js', 'PDFJS-LICENSE', 'MAMMOTH-LICENSE')
$edgeCandidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
)

if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'manifest.json is missing.' }
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) { throw 'This package is not a Manifest V3 extension.' }
foreach ($file in $runtimeFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $file))) { throw "Required file is missing: $file" }
}
$iconRoot = Join-Path $sourceRoot 'icons'
if (-not (Test-Path -LiteralPath (Join-Path $iconRoot 'briefcase-business.svg'))) { throw 'Icon files are missing.' }
$vendorRoot = Join-Path $sourceRoot 'vendor'
foreach ($file in $vendorFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $vendorRoot $file))) { throw "Required vendor file is missing: $file" }
}
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edgePath) { throw 'Microsoft Edge was not found on this computer.' }

if ($ValidateOnly) {
  Write-Output "Installer validation passed for version $($manifest.version)."
  Write-Output "Edge: $edgePath"
  exit 0
}

if (-not $NoLaunch) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Edge requires Developer mode before a local extension can be loaded.`n`nThe helper will copy all files and open edge://extensions. Turn on Developer mode, click Load unpacked, then choose the opened Extension folder.`n`nFor a true one-click install, the extension must be published in Microsoft Edge Add-ons.",
    'Resume Quick Apply - Installation Notice',
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Information
  ) | Out-Null
}

$targetRoot = if ($Destination) { [System.IO.Path]::GetFullPath($Destination) } else { Join-Path $env:LOCALAPPDATA 'ResumeQuickApply\Extension' }
$targetIcons = Join-Path $targetRoot 'icons'
$targetVendor = Join-Path $targetRoot 'vendor'
New-Item -ItemType Directory -Force -Path $targetRoot, $targetIcons, $targetVendor | Out-Null
foreach ($file in $runtimeFiles) {
  Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination (Join-Path $targetRoot $file) -Force
}
Get-ChildItem -LiteralPath $iconRoot -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetIcons $_.Name) -Force
}
foreach ($file in $vendorFiles) {
  Copy-Item -LiteralPath (Join-Path $vendorRoot $file) -Destination (Join-Path $targetVendor $file) -Force
}

$installed = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $targetRoot 'manifest.json') | ConvertFrom-Json
if ($installed.version -ne $manifest.version) { throw 'Copied extension version does not match the package.' }

if ($NoLaunch) {
  Write-Output "Install copy validation passed: $targetRoot"
  exit 0
}

$guidePath = Join-Path $PSScriptRoot 'install-guide.html'
$guideUri = [System.Uri]::new($guidePath).AbsoluteUri
Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$(Join-Path $targetRoot 'manifest.json')`""
Start-Process -FilePath $edgePath -ArgumentList @('edge://extensions/', $guideUri)

Write-Output ''
Write-Output "Extension files copied to: $targetRoot"
Write-Output 'Edge and the visual install guide are now open.'
Write-Output 'Complete the final browser confirmation shown in the guide.'
Read-Host 'Press Enter to close this window'
