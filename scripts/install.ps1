# 4AllPass Windows install. Not SmartScreen-clean (no certificate).
# irm https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.ps1 | iex
# Does not touch %APPDATA%\4AllPass\. Unlock is still the vault password.

$ErrorActionPreference = "Stop"
$repo = "landjunge/4AllPass"
$api = "https://api.github.com/repos/$repo/releases"
Write-Host "4AllPass install. Not signed. You trust GitHub $repo."
Write-Host "Vault folder is never deleted."

$releases = Invoke-RestMethod -Uri $api
$url = $null
foreach ($rel in $releases) {
  foreach ($asset in $rel.assets) {
    if ($asset.name -like "*_x64-setup.exe") {
      $url = $asset.browser_download_url
      break
    }
  }
  if ($url) { break }
}
if (-not $url) { throw "No *_x64-setup.exe in GitHub releases." }

$tmp = Join-Path $env:TEMP "4AllPass-setup.exe"
Invoke-WebRequest -Uri $url -OutFile $tmp
Start-Process -FilePath $tmp -Wait
Write-Host "Vault stays in: $env:APPDATA\4AllPass"
