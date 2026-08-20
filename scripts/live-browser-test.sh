#!/bin/sh
# Headed multi-browser run on this Mac. Backend must already answer on :8000.
set -e
cd "$(dirname "$0")/.."
if ! curl -sf "http://127.0.0.1:8000/api/v1/health" >/dev/null 2>&1 \
  && ! curl -sf "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
  echo "Backend not reachable on :8000. Start Postgres, Redis and uvicorn (see docs/live-browser-test.md)."
  exit 1
fi
cd frontend
npx playwright install firefox webkit >/dev/null
export LIVE_SLOWMO="${LIVE_SLOWMO:-350}"
exec npx playwright test -c playwright.live.config.ts "$@"
