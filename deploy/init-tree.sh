#!/usr/bin/env bash
# Create isolated trees so products do not share webroot or data.
# Safe to re-run. Does not start Docker or write secrets.
set -euo pipefail
ROOT="${NETZWERKPUNKT_ROOT:-/srv/netzwerkpunkt}"
umask 027
for dir in \
  hub/www \
  4allpass/landing \
  4allpass/vault \
  tollgate/landing \
  tollgate/app \
  gnom-hub-v1/landing \
  gnom-hub-v1/app
do
  mkdir -p "${ROOT}/${dir}"
done
if [ "$(id -u)" -eq 0 ]; then
  chmod 0750 "${ROOT}" "${ROOT}"/* "${ROOT}"/*/* 2>/dev/null || true
fi
echo "ok ${ROOT}"
echo "4allpass landing → ${ROOT}/4allpass/landing"
echo "4allpass vault   → ${ROOT}/4allpass/vault   (compose project 4allpass-vault)"
echo "do not put /api on 4allpass.netzwerkpunkt.de"
