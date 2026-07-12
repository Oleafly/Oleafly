#!/usr/bin/env bash
# Self-contained e2e run: builds + launches the app with the e2e bridge and a
# throwaway data dir, waits for the bridge socket, runs the Playwright suite,
# and always tears the app down. Usage: ./scripts/e2e.sh [playwright args...]
set -euo pipefail
cd "$(dirname "$0")/.."

SOCK="${TAURI_PLAYWRIGHT_SOCKET:-/tmp/tauri-playwright.sock}"
DATA_DIR="$(mktemp -d /tmp/openleaf-e2e.XXXXXX)"
LOG="$(mktemp /tmp/openleaf-e2e-log.XXXXXX)"
# Export so Playwright specs can read discovery files (e.g. mcp.json) written
# into the same throwaway data dir the app uses.
export OPENLEAF_DATA_DIR="$DATA_DIR"

echo "e2e: data dir $DATA_DIR"
echo "e2e: app log  $LOG"
rm -f "$SOCK"

# A stale dev server or app instance from an earlier run blocks this one.
if lsof -ti :1420 >/dev/null 2>&1; then
  echo "e2e: killing stale process on port 1420"
  lsof -ti :1420 | xargs kill 2>/dev/null || true
  sleep 1
fi
pkill -f "target/debug/openleaf" 2>/dev/null || true

OPENLEAF_DATA_DIR="$DATA_DIR" pnpm tauri dev --features e2e-testing >"$LOG" 2>&1 &
APP_PID=$!

cleanup() {
  # Kill the whole tauri-dev process tree (cargo + app + vite).
  pkill -P "$APP_PID" 2>/dev/null || true
  kill "$APP_PID" 2>/dev/null || true
  pkill -f "target/debug/openleaf" 2>/dev/null || true
  # Keep the app log with the test artifacts (CI uploads test-results/).
  mkdir -p test-results && cp "$LOG" test-results/app.log 2>/dev/null || true
}
trap cleanup EXIT

echo "e2e: waiting for the bridge socket (first build can take minutes)..."
for _ in $(seq 1 180); do
  [ -S "$SOCK" ] && break
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "e2e: app process exited early; last log lines:" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  sleep 5
done
[ -S "$SOCK" ] || { echo "e2e: bridge socket never appeared; log tail:" >&2; tail -20 "$LOG" >&2; exit 1; }
sleep 2

pnpm exec playwright test -c e2e/playwright.config.ts "$@"
