#!/usr/bin/env bash
# Builds a signed OTA/USB update package:  scripts/make-release.sh 1.1.0 path/to/update-signing.key
set -euo pipefail
VERSION="${1:?usage: make-release.sh <version> <signing.key> [channel]}"
KEY="${2:?signing key (python -m lumos_update keygen …)}"
CHANNEL="${3:-stable}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

npx vite build
npx electron-builder --linux dir

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -a release/linux-unpacked "$STAGE/shell"
cp -a daemon updater shared system "$STAGE/"
find "$STAGE" \( -name __pycache__ -o -name .pytest_cache -o -name tests \) -prune -exec rm -rf {} +

PYTHONPATH="$REPO/updater" python3 -m lumos_update build "$STAGE" "$VERSION" --key "$KEY" --out dist-update --channel "$CHANNEL" \
  --notes "$(git log -1 --pretty=%B 2>/dev/null || echo "Lumos One $VERSION")"
echo "→ dist-update/lumos-update-$VERSION.zip (auf GitHub-Release hochladen oder per PC-App / USB-Stick installieren)"
