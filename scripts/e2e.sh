#!/usr/bin/env bash
# Self-contained e2e run: builds + launches the app with the e2e bridge and a
# throwaway data dir, waits for the bridge socket, runs the Playwright suite,
# and always tears the app down. Usage: ./scripts/e2e.sh [playwright args...]
set -euo pipefail
cd "$(dirname "$0")/.."

source scripts/e2e-run-lock.sh
acquire_e2e_lock

APP_PID=""
LOG=""
SOCK="${TAURI_PLAYWRIGHT_SOCKET:-/tmp/tauri-playwright.sock}"
SOCK_ID=""
CLEANED=0

cleanup() {
  [ "$CLEANED" -eq 0 ] || return 0
  CLEANED=1
  if [ -n "$APP_PID" ]; then
    terminate_e2e_tree "$APP_PID"
  fi
  remove_owned_e2e_socket "$SOCK" "$SOCK_ID"
  if [ -n "$LOG" ]; then
    mkdir -p test-results && cp "$LOG" test-results/app.log 2>/dev/null || true
  fi
  release_e2e_lock
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

bash scripts/ensure-e2e-sidecars.sh

DATA_DIR="$(mktemp -d /tmp/openleaf-e2e.XXXXXX)"
LOG="$(mktemp /tmp/openleaf-e2e-log.XXXXXX)"
# Export so Playwright specs can read discovery files (e.g. mcp.json) written
# into the same throwaway data dir the app uses.
export OPENLEAF_DATA_DIR="$DATA_DIR"

echo "e2e: data dir $DATA_DIR"
echo "e2e: app log  $LOG"
rm -f "$SOCK"

if lsof -ti :1420 >/dev/null 2>&1; then
  echo "e2e: port 1420 is already owned by pid(s): $(lsof -ti :1420 | tr '\n' ' ')" >&2
  exit 1
fi

OPENLEAF_DATA_DIR="$DATA_DIR" pnpm tauri dev --features e2e-testing >"$LOG" 2>&1 &
APP_PID=$!

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
SOCK_ID="$(e2e_socket_identity "$SOCK")"
sleep 2

pnpm exec playwright test -c e2e/playwright.config.ts "$@"
