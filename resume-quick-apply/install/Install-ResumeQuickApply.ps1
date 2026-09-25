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
$runtimeFiles = @('manifest.json', 'popup.html', 'popup.css', 'popup.js', 'dashboard.html', 'dashboard.css', 'dashboard.js', 'dashboard-data.js', 'catalog.js', 'catalog-data.js', 'catalog-db.js', 'content.js', 'data.js', 'backup-sync-data.js', 'resume-parser.js', 'service-worker.js', 'onboarding.html', 'README.md')
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
  $installMessage = 'Edge 本地扩展需要先打开开发人员模式。安装助手会复制扩展文件，并打开 Edge 扩展管理页、中文安装教程和 ResumeQuickApply 文件夹。请按教程操作：点击右上角拼图图标→管理扩展→打开左侧开发人员模式→加载解压缩的扩展。文件夹窗口停留在 ResumeQuickApply 这一层，直接选中 Extension 文件夹，不要进入 Extension。真正的一键安装需要发布到 Microsoft Edge 扩展商店；本地安装不会修改系统策略，也不需要管理员权限。'
  [System.Windows.MessageBox]::Show($installMessage, '投简历助手 - 安装提示', [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Information) | Out-Null
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
Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$targetRoot`""
Start-Process -FilePath $edgePath -ArgumentList @('edge://extensions/', $guideUri)

Write-Output ''
Write-Output "扩展文件已复制到：$targetRoot"
Write-Output 'Edge、中文安装教程和 ResumeQuickApply 文件夹已打开。'
Write-Output '请按教程完成浏览器中的最后确认。'
Read-Host '按回车键关闭此窗口'
