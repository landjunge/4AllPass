#!/bin/sh
# 4AllPass one-command install. POSIX sh. Installs the app only — not Node,
# Python, Docker, or Postgres. Does not touch the vault folder.
#
# curl -fsSL https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.sh | sh
#
# Channel: GitHub release tag `desktop` (override: FOURALLPASS_RELEASE=tag).
# SHA-256 sidecar is required. Not notarized. Alternative: save this file,
# read it, then: sh install.sh
#
# Unlock is still the vault password. FastAPI mints no tokens.

set -eu

REPO="landjunge/4AllPass"
CHANNEL="${FOURALLPASS_RELEASE:-desktop}"
API="https://api.github.com/repos/${REPO}/releases/tags/${CHANNEL}"
VAULT_MAC="${HOME}/Library/Application Support/4AllPass"
VAULT_LINUX="${HOME}/.local/share/4allpass"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

os=$(uname -s)
arch=$(uname -m)

asset_suffix() {
  if [ "$os" = Darwin ] && [ "$arch" = x86_64 ]; then
    printf '%s\n' "_x64.dmg"
  elif [ "$os" = Darwin ] && [ "$arch" = arm64 ]; then
    printf '%s\n' "_aarch64.dmg"
  elif [ "$os" = Linux ] && [ "$arch" = x86_64 ]; then
    printf '%s\n' "_amd64.AppImage"
  elif [ "$os" = Linux ] && [ "$arch" = amd64 ]; then
    printf '%s\n' "_amd64.AppImage"
  elif [ "$os" = Darwin ]; then
    die "Unsupported Mac CPU: ${arch}. Need x86_64 or arm64."
  elif [ "$os" = Linux ]; then
    die "Unsupported Linux CPU: ${arch}. Need x86_64."
  else
    die "Unsupported OS: ${os}. Windows: irm https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.ps1 | iex"
  fi
}

# Only assets[].browser_download_url — never the release body, which GitHub
# serializes first and may contain an older DMG link.
pick_asset_url() {
  printf '%s\n' "$1" | grep -o '"browser_download_url":[[:space:]]*"[^"]*"' | sed 's/.*"\(https:\/\/[^"]*\)".*/\1/' | grep "${2}$" | head -n 1
}

if [ "${1:-}" = "--suffix-only" ]; then
  asset_suffix
  exit 0
fi

if [ "${1:-}" = "--print-channel" ]; then
  printf '%s\n' "$CHANNEL"
  exit 0
fi

if [ "${1:-}" = "--pick-from-json" ]; then
  suffix=${2:-}
  file=${3:-}
  [ -n "$suffix" ] && [ -n "$file" ] || die "usage: install.sh --pick-from-json SUFFIX FILE"
  json=$(cat "$file") || die "Could not read ${file}"
  url=$(pick_asset_url "$json" "$suffix")
  [ -n "$url" ] || die "No release asset matching *${suffix}."
  printf '%s\n' "$url"
  exit 0
fi

suffix=$(asset_suffix)

printf '%s\n' "4AllPass install"
printf '%s\n' "Channel ${CHANNEL} · GitHub ${REPO}"
printf '%s\n' "Alpha. Not notarized. SHA-256 is not GitHub-account security."
printf '%s\n' "Vault folders are never deleted."

json=$(curl -fsSL "$API") || die "Could not load GitHub release tag ${CHANNEL}."

# Must end with the suffix so *.dmg.sha256 is not picked as the installer.
url=$(pick_asset_url "$json" "$suffix")
[ -n "$url" ] || die "No ${CHANNEL} asset matching *${suffix}. See https://github.com/${REPO}/releases/tag/${CHANNEL}"

asset=$(printf '%s\n' "$url" | sed 's|.*/||')
tag=$(printf '%s\n' "$json" | grep -o '"tag_name":[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)".*/\1/')
[ -n "$tag" ] || tag="$CHANNEL"

if [ "${1:-}" = "--dry-run" ]; then
  printf '%s\n' "tag ${tag}"
  printf '%s\n' "asset ${asset}"
  printf '%s\n' "$url"
  exit 0
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fL --progress-bar -o "$tmp" "$url" || die "Download failed: $url"

sum_url="${url}.sha256"
expect=$(curl -fsSL "$sum_url" | awk '{print $1}') || die "No SHA-256 sidecar for this asset (${sum_url})."
[ -n "$expect" ] || die "Empty SHA-256 sidecar."
if command -v sha256sum >/dev/null 2>&1; then
  got=$(sha256sum "$tmp" | awk '{print $1}')
else
  got=$(shasum -a 256 "$tmp" | awk '{print $1}')
fi
[ "$got" = "$expect" ] || die "SHA-256 mismatch. Abort. Expected ${expect}, got ${got}."
printf '%s\n' "tag ${tag} · ${asset}"
printf '%s\n' "SHA-256 ${got}"
printf '%s\n' "SHA-256 ok."

if [ "$os" = Darwin ]; then
  dest="/Applications"
  if [ ! -w "$dest" ]; then
    dest="${HOME}/Applications"
    mkdir -p "$dest"
    printf '%s\n' "No write access to /Applications — installing to ${dest}"
  fi
  mnt=$(mktemp -d)
  trap 'rm -f "$tmp"; hdiutil detach "$mnt" >/dev/null 2>&1 || true; rmdir "$mnt" 2>/dev/null || true' EXIT
  hdiutil attach "$tmp" -nobrowse -quiet -mountpoint "$mnt" || die "Could not mount DMG."
  app=$(find "$mnt" -maxdepth 2 -name "*.app" -print | head -n 1)
  [ -n "$app" ] || die "No .app in the DMG."
  rm -rf "${dest}/4AllPass.app"
  cp -R "$app" "${dest}/4AllPass.app"
  hdiutil detach "$mnt" >/dev/null 2>&1 || true
  printf '%s\n' "Ad-hoc: removing macOS quarantine so the app can start."
  printf '%s\n' "This is the tester path, not a production Gatekeeper bypass."
  xattr -cr "${dest}/4AllPass.app" 2>/dev/null || true
  printf '%s\n' "✓ 4AllPass installiert / installed"
  printf '%s\n' "  ${dest}/4AllPass.app"
  printf '%s\n' "  Vault stays in: ${VAULT_MAC}"
  printf '%s\n' "4AllPass wird gestartet... / Starting 4AllPass..."
  open -a "${dest}/4AllPass.app" || open -a 4AllPass
elif [ "$os" = Linux ]; then
  bin="${HOME}/.local/bin"
  mkdir -p "$bin"
  install_path="${bin}/4allpass"
  cp "$tmp" "$install_path"
  chmod +x "$install_path"
  printf '%s\n' "✓ 4AllPass installiert / installed"
  printf '%s\n' "  ${install_path}"
  printf '%s\n' "  Vault stays in: ${VAULT_LINUX}"
  printf '%s\n' "4AllPass wird gestartet... / Starting 4AllPass..."
  "$install_path" >/dev/null 2>&1 &
fi
