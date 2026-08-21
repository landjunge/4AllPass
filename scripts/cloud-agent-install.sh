#!/usr/bin/env bash
# Idempotent Cloud Agent / local bootstrap.
# Installs lockfile JS workspace deps and the Argon2id KAT verifier.
# Must terminate. Do not start servers here.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

# Playwright's npm package may fetch browser builds from hosts that are
# not on the Cloud Agent egress allowlist. Unit/typecheck work does not
# need those browsers.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD="${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-1}"

# npm 10 retries a dead registry for ~70s and can then crash with
# "Exit handler never called!" instead of a network error. Keep retries
# short so a later fetch failure stays explicit.
export npm_config_fetch_retries="${npm_config_fetch_retries:-1}"
export npm_config_fetch_retry_mintimeout="${npm_config_fetch_retry_mintimeout:-2000}"
export npm_config_fetch_retry_maxtimeout="${npm_config_fetch_retry_maxtimeout:-10000}"

tls_reaches() {
  local url="$1"
  local code
  code="$(curl -4 -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)"
  # 000 = connect/TLS failed. Any HTTP status means the handshake worked.
  [ -n "$code" ] && [ "$code" != "000" ]
}

require_https() {
  local url="$1"
  local host="$2"
  if tls_reaches "$url"; then
    return 0
  fi
  cat >&2 <<EOF
4AllPass cloud install: TLS to ${host} is reset (ECONNRESET / SSL_ERROR_SYSCALL).
TCP connects and the Client Hello is sent; the peer then closes the handshake.
npm/pip then either hang on retries or crash with "Exit handler never called!".

Add these hosts to the Cloud Agent environment egress allowlist, then rerun:
  registry.npmjs.org
  pypi.org
  files.pythonhosted.org

Failed host: ${host}
EOF
  return 1
}

echo "Checking package registries…"
require_https "https://registry.npmjs.org/" "registry.npmjs.org"
require_https "https://pypi.org/" "pypi.org"
require_https "https://files.pythonhosted.org/" "files.pythonhosted.org"

echo "npm ci"
npm ci --no-audit --no-fund

echo "pip (scripts/requirements-dev.txt)"
python3 -m pip install --user -r scripts/requirements-dev.txt
