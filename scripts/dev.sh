#!/usr/bin/env bash
# Desktop development: simulated hardware daemon + Vite + Electron (Ctrl+Shift+D opens the hardware simulator).
#   scripts/dev.sh           → Electron window
#   scripts/dev.sh browser   → UI in the browser at http://127.0.0.1:5173 (daemon in --dev mode, no token)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
MODE="${1:-electron}"
DAEMON_ARGS=(--simulate)
[[ "$MODE" == "browser" ]] && DAEMON_ARGS+=(--dev)

(cd daemon && exec python3 -m lumosd "${DAEMON_ARGS[@]}") &
DAEMON=$!
trap 'kill $DAEMON 2>/dev/null || true' EXIT

if [[ "$MODE" == "browser" ]]; then
  npx vite
else
  npm run dev:electron
fi
