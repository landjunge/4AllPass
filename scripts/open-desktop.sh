#!/bin/sh
# Open the human vault: installed 4AllPass Desk. Never a browser tab on :8788.
# Agents MUST pass --desktop. Usage: bash scripts/open-desktop.sh --desktop
set -eu

if [ "${1:-}" != "--desktop" ]; then
  echo "usage: $0 --desktop" >&2
  echo "Opens /Applications/4AllPass.app (your vault). Does not open http://127.0.0.1:8788" >&2
  exit 2
fi

APP="/Applications/4AllPass.app"
if [ ! -d "$APP" ]; then
  echo "4AllPass Desk not installed at $APP" >&2
  exit 1
fi

# If Desk UI is already running, just bring it forward.
if pgrep -x fourallpass >/dev/null 2>&1; then
  open "$APP"
  echo "4AllPass Desk: already running, brought forward"
  exit 0
fi

# python -m app.local / npm run app on 8788 is NOT the Desk. Same data dir.
# Free the port so Desk can spawn fourallpass-core.
if command -v lsof >/dev/null 2>&1; then
  pid=$(lsof -t -nP -iTCP:8788 -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "${pid:-}" ]; then
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    case "$cmd" in
      *app.local*|*app/local.py*)
        echo "stopping local python profile on 8788 (pid $pid) so Desk can start"
        kill "$pid" 2>/dev/null || true
        i=0
        while [ $i -lt 20 ] && lsof -t -nP -iTCP:8788 -sTCP:LISTEN >/dev/null 2>&1; do
          i=$((i + 1))
          sleep 0.1
        done
        ;;
      *fourallpass-core*)
        echo "core on 8788 without UI; Desk will take over"
        ;;
      *)
        echo "8788 is in use by a foreign process; not opening a browser. cmd: $cmd" >&2
        exit 1
        ;;
    esac
  fi
fi

open "$APP"
echo "4AllPass Desk: launched $APP"
