#!/usr/bin/env bash
# Idempotent Cloud Agent / environment-build bootstrap.
# Requires egress to registry.npmjs.org, registry.npmjs.com, pypi.org,
# and files.pythonhosted.org. Fail fast if those hosts are blocked —
# otherwise npm hangs and exits with "Exit handler never called!".
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

require_https() {
  local url="$1"
  local host
  host="$(printf '%s\n' "$url" | awk -F/ '{print $3}')"
  if ! curl -fsS --retry 0 --max-time 15 -o /dev/null "$url"; then
    echo "cloud-agent-install: cannot reach $url" >&2
    echo "cloud-agent-install: add '$host' to the Cloud Agent egress allowlist, then retry." >&2
    exit 1
  fi
}

require_https 'https://registry.npmjs.org/'
require_https 'https://pypi.org/simple/pip/'

npm ci --no-audit --no-fund \
  --fetch-retries=1 \
  --fetch-retry-mintimeout=10000 \
  --fetch-retry-maxtimeout=20000

python3 -m pip install --user --disable-pip-version-check -r scripts/requirements-dev.txt
python3 -m pip install --user --disable-pip-version-check -r backend/requirements-dev.txt
