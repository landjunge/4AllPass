#!/bin/sh
# macOS wrapper around the portable sidecar packager.
set -e
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PY="${ROOT}/backend/.venv/bin/python"
if [ ! -x "$PY" ]; then
  PY="python3"
fi
exec "$PY" "$ROOT/scripts/package-sidecar.py" "$@"
