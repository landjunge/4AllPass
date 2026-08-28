#!/usr/bin/env bash
# CycloneDX SBOMs for npm, Cargo, and Python. Not committed; CI uploads them.
# docs/supply-chain-security.md §1.4 / Phase 3.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-"$root/sbom"}"
mkdir -p "$out"
cd "$root"

npm sbom --package-lock-only --sbom-format cyclonedx --sbom-type application \
  >"$out/sbom-npm.cdx.json"

if cargo cyclonedx --help >/dev/null 2>&1; then
  (
    cd src-tauri
    cargo cyclonedx --format json
  )
  found="$(find src-tauri -maxdepth 1 -name '*.cdx.json' | head -1)"
  if [ -n "$found" ]; then
    mv "$found" "$out/sbom-cargo.cdx.json"
  fi
fi

if command -v pip-audit >/dev/null 2>&1; then
  if pip-audit --help 2>&1 | grep -q cyclonedx-json; then
    pip-audit -r backend/requirements.txt --format cyclonedx-json -o "$out/sbom-python.cdx.json"
  else
    pip-audit -r backend/requirements.txt --format cyclonedx --output "$out/sbom-python.cdx.json"
  fi
fi

echo "SBOMs in $out:"
ls -l "$out"
