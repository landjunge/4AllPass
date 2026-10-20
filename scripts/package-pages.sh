#!/usr/bin/env bash
# Same Linux archive format as actions/upload-pages-artifact@v3, without its
# nested mutable action. This workflow runs on Ubuntu with GNU tar.
# Source: https://github.com/actions/upload-pages-artifact/blob/56afc609e74202658d3ffba0e8f6dda462b719fa/action.yml
set -euo pipefail
if [[ $# != 2 ]]; then
  echo 'usage: package-pages.sh SITE_DIRECTORY OUTPUT_TAR' >&2
  exit 2
fi
tar --dereference --hard-dereference --directory "$1" \
  -cf "$2" --exclude=.git --exclude=.github .
