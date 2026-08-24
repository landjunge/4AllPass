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
