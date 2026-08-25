#!/bin/sh
set -e
root=$(git rev-parse --show-toplevel)
hookdir=$(git rev-parse --git-path hooks)
mkdir -p "$hookdir"
cp "$root/scripts/git-hooks/post-commit" "$hookdir/post-commit"
chmod +x "$hookdir/post-commit"
echo "installed $hookdir/post-commit"
