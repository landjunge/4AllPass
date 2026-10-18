#!/bin/sh
# Fixture: release body names an older _x64.dmg; assets[] has the desktop one.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
got=$(sh "$root/scripts/install.sh" --pick-from-json _x64.dmg "$root/scripts/testdata/release-body-older-dmg.json")
want="https://github.com/landjunge/4AllPass/releases/download/desktop/4AllPass_0.1.1_x64.dmg"
[ "$got" = "$want" ] || {
  printf 'install.sh picked the wrong URL\n got:  %s\n want: %s\n' "$got" "$want" >&2
  exit 1
}
printf 'ok install.sh assets[] over release body\n'

channel=$(sh "$root/scripts/install.sh" --print-channel)
[ "$channel" = "v0.1.2-rc.2" ] || {
  printf 'install.sh default channel is %s, want v0.1.2-rc.2\n' "$channel" >&2
  exit 1
}
printf 'ok install.sh channel v0.1.2-rc.2\n'

# Must not scan every GitHub release: the live API is /releases/tags/v0.1.2-rc.2.
# --dry-run hits the network; skip if offline.
if json=$(curl -fsSL --max-time 20 "https://api.github.com/repos/landjunge/4AllPass/releases/tags/v0.1.2-rc.2" 2>/dev/null); then
  url=$(sh "$root/scripts/install.sh" --pick-from-json _x64.dmg /dev/stdin <<EOF
$json
EOF
)
  printf '%s\n' "$url" | grep -q '/releases/download/v0.1.2-rc.2/' || {
    printf 'new tag pick was not a v0.1.2-rc.2/ asset: %s\n' "$url" >&2
    exit 1
  }
  printf 'ok install.sh pins GitHub tag v0.1.2-rc.2\n'
else
  printf 'skip live v0.1.2-rc.2 tag check (offline)\n'
fi
