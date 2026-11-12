[CmdletBinding()]
param([string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$extensionSource = Join-Path $repositoryRoot 'resume-quick-apply'
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $extensionSource 'manifest.json') | ConvertFrom-Json
$version = $manifest.version
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repositoryRoot "output\releases\$version" }
$releaseRoot = [IO.Path]::GetFullPath($OutputDirectory)
$packageRoot = Join-Path $releaseRoot "ResumeQuickApply-$version"
if (Test-Path -LiteralPath $releaseRoot) { throw "Use a new output directory; nothing was overwritten: $releaseRoot" }
New-Item -ItemType Directory -Path $releaseRoot | Out-Null
& (Join-Path $extensionSource 'install\Install-ResumeQuickApply.ps1') -NoLaunch -Destination $packageRoot
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Installer copy failed.' }
Copy-Item -LiteralPath (Join-Path $extensionSource 'install') -Destination (Join-Path $packageRoot 'install') -Recurse
Copy-Item -LiteralPath (Join-Path $extensionSource '安装插件.cmd') -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $extensionSource 'package.json') -Destination $packageRoot
& (Join-Path $packageRoot 'install\Install-ResumeQuickApply.ps1') -ValidateOnly
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Packaged installer validation failed.' }
$archive = Join-Path $releaseRoot "ResumeQuickApply-$version.zip"
Compress-Archive -LiteralPath $packageRoot -DestinationPath $archive -CompressionLevel Optimal
$receipt = [ordered]@{
  version = $version
  archive = $archive
  sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  files = @(Get-ChildItem -LiteralPath $packageRoot -File -Recurse | ForEach-Object {
    [ordered]@{path=$_.FullName.Substring($packageRoot.Length + 1); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
  })
}
$receipt | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $releaseRoot 'package-receipt.json')
Write-Output "Prepared release: $archive"
Write-Output "SHA256: $($receipt.sha256)"
