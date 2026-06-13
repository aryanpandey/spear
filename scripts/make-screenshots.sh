#!/usr/bin/env bash
# Build a throwaway demo board and capture dashboard screenshots into docs/screenshots/.
# Never touches your real ~/.spear. Requires: npm run build, system Chrome.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEMO_HOME="$(mktemp -d)/spear-demo"
PORT="${DEMO_PORT:-4399}"
export SPEAR_HOME="$DEMO_HOME"
export SPEAR_CLI="node $ROOT/dist/cli.js"

echo "demo home: $DEMO_HOME"
$SPEAR_CLI init --no-launchd >/dev/null
bash "$ROOT/scripts/build-demo.sh"

$SPEAR_CLI serve --port "$PORT" >/tmp/spear-demo-serve.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT

for _ in $(seq 1 100); do curl -s "http://127.0.0.1:$PORT/api/today" >/dev/null 2>&1 && break; done

BASE="http://127.0.0.1:$PORT" OUT="$ROOT/docs/screenshots" node "$ROOT/scripts/screenshot.mjs"
echo "done."
