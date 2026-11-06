#!/usr/bin/env bash
# Runs every automated check of the project.
#   UI build + unit tests · cloud server integration test · daemon/updater pytest ·
#   firmware native tests + C++→Python protocol vectors
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
PY="${PYTHON:-python3}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> UI: vite build + vitest"
npx vite build >/dev/null
npx vitest run

echo "==> Cloud server (node:test, real UI client against real server)"
(cd cloud-server && node --test test/*.test.js)

echo "==> Firmware: native tests + protocol vectors"
g++ -std=c++17 -Wall -Wextra -DLUMOS_NO_UNITY -Ifirmware/include firmware/test/test_native/test_main.cpp -o "$TMP/fwtest"
"$TMP/fwtest"
g++ -std=c++17 -Wall -Ifirmware/include firmware/test/native_vectors.cpp -o "$TMP/fwvec"
"$TMP/fwvec" > "$TMP/vectors.hex"

echo "==> Daemon (pytest, incl. end-to-end WebSocket + firmware vectors)"
(cd daemon && LUMOS_FW_VECTORS="$TMP/vectors.hex" "$PY" -m pytest -q)

echo "==> Updater (pytest)"
(cd updater && "$PY" -m pytest -q)

echo "alle Checks bestanden ✓"
