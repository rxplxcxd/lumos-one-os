#!/usr/bin/env bash
# Bundles every source file of the project into lumos-one-os-<version>.zip (no node_modules / build output).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
VERSION="$(node -p "require('./package.json').version")"
OUT="${1:-$REPO/lumos-one-os-$VERSION.zip}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
DIR="$STAGE/lumos-one-os"
mkdir -p "$DIR"
# tracked + new (non-ignored) files, so the archive matches the working tree
git ls-files -co --exclude-standard -z | while IFS= read -r -d '' f; do
  [[ -f "$f" ]] || continue
  mkdir -p "$DIR/$(dirname "$f")"
  cp -p "$f" "$DIR/$f"
done
chmod +x "$DIR"/scripts/*.sh "$DIR/system/session/lumos-session" "$DIR/daemon/lumos_priv.py" "$DIR/updater/pc_client/lumos_sync.py"
rm -f "$OUT"
(cd "$STAGE" && zip -qr -9 "$OUT" lumos-one-os)
echo "$OUT ($(du -h "$OUT" | cut -f1), $(unzip -Z1 "$OUT" | grep -vc '/$') Dateien)"
