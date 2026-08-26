# 4AllPass Windows install. Not SmartScreen-clean (no certificate).
# irm https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.ps1 | iex
# Does not touch %APPDATA%\4AllPass\. Unlock is still the vault password.
# Channel: GitHub tag `desktop` (override: $env:FOURALLPASS_RELEASE).

$ErrorActionPreference = "Stop"
$repo = "landjunge/4AllPass"
$channel = if ($env:FOURALLPASS_RELEASE) { $env:FOURALLPASS_RELEASE } else { "desktop" }
$api = "https://api.github.com/repos/$repo/releases/tags/$channel"
Write-Host "4AllPass install"
Write-Host "Channel $channel · GitHub $repo"
Write-Host "Not signed. Vault folder is never deleted."

$rel = Invoke-RestMethod -Uri $api
$url = $null
$assetName = $null
foreach ($asset in $rel.assets) {
  if ($asset.name -like "*_x64-setup.exe" -and $asset.name -notlike "*.sha256") {
    $url = $asset.browser_download_url
    $assetName = $asset.name
    break
  }
}
if (-not $url) { throw "No *_x64-setup.exe on tag $channel." }

$tmp = Join-Path $env:TEMP "4AllPass-setup.exe"
Invoke-WebRequest -Uri $url -OutFile $tmp
$sumUrl = "$url.sha256"
try {
  $expect = ((Invoke-WebRequest -Uri $sumUrl).Content -split "\s+")[0].Trim()
} catch {
  throw "No SHA-256 sidecar for this asset ($sumUrl)."
}
$got = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLowerInvariant()
if ($got -ne $expect.ToLowerInvariant()) {
  throw "SHA-256 mismatch. Abort."
}
Write-Host "tag $($rel.tag_name) · $assetName"
Write-Host "SHA-256 $got"
Write-Host "SHA-256 ok."
Write-Host "4AllPass wird gestartet... / Starting 4AllPass..."
Start-Process -FilePath $tmp -Wait
Write-Host "✓ 4AllPass installiert / installed"
Write-Host "Vault stays in: $env:APPDATA\4AllPass"
