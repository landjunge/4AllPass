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
  code="$(curl -4 -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || true)"
  # 000 = connect/TLS failed. Any HTTP status means the handshake worked.
  [ -n "$code" ] && [ "$code" != "000" ]
}

echo "Checking package registries…"
missing=()
tls_reaches "https://registry.npmjs.org/" || missing+=("registry.npmjs.org")
tls_reaches "https://pypi.org/" || missing+=("pypi.org")
tls_reaches "https://files.pythonhosted.org/" || missing+=("files.pythonhosted.org")
if [ "${#missing[@]}" -gt 0 ]; then
  cat >&2 <<EOF
4AllPass cloud install: TLS to the package registries is reset (ECONNRESET / SSL_ERROR_SYSCALL).
TCP connects and the Client Hello is sent; the peer then closes the handshake.
npm/pip then either hang on retries or crash with "Exit handler never called!".

Add these hosts to the Cloud Agent environment egress allowlist, then rerun:
  registry.npmjs.org
  pypi.org
  files.pythonhosted.org

Unreachable now: ${missing[*]}
EOF
  exit 1
fi

echo "npm ci"
npm ci --no-audit --no-fund

echo "pip (scripts/requirements-dev.txt)"
python3 -m pip install --user -r scripts/requirements-dev.txt
