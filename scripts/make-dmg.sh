#!/bin/sh
# Fallback when Tauri's bundle_dmg.sh fails (no Finder window session).
set -e
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/release/bundle/macos/4AllPass.app"
OUTDIR="$ROOT/src-tauri/target/release/bundle/dmg"
if [ ! -d "$APP" ]; then
  echo "missing $APP — run npm run tauri:build first" >&2
  exit 1
fi
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/4allpass-dmg.XXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/4AllPass.app"
ln -s /Applications "$STAGE/Applications"
mkdir -p "$OUTDIR"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) SLUG="aarch64" ;;
  x86_64) SLUG="x64" ;;
  *) SLUG="$ARCH" ;;
esac
OUT="$OUTDIR/4AllPass_0.1.0_${SLUG}.dmg"
hdiutil create -volname "4AllPass" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
echo "$OUT"
