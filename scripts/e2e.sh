#!/usr/bin/env bash
# Self-contained e2e run: builds + launches the app with the e2e bridge and a
# throwaway data dir, waits for the bridge socket, runs the Playwright suite,
# and always tears the app down. Usage: ./scripts/e2e.sh [playwright args...]
set -euo pipefail
# Give each background app launch its own process group so teardown can target
# only processes owned by this runner.
set -m
cd "$(dirname "$0")/.."

source scripts/e2e-run-lock.sh
acquire_e2e_lock

APP_PID=""
LOG=""
LOG_STREAM_PID=""
HEARTBEAT_PID=""
SOCK="${TAURI_PLAYWRIGHT_SOCKET:-/tmp/tauri-playwright.sock}"
SOCK_ID=""
CLEANED=0

terminate_app_group() {
  local leader="$1"
  kill -TERM -- "-$leader" 2>/dev/null || terminate_e2e_tree "$leader"
  for _ in $(seq 1 10); do
    kill -0 "$leader" 2>/dev/null || return 0
    sleep 1
  done
  kill -KILL -- "-$leader" 2>/dev/null || terminate_e2e_tree "$leader"
}

cleanup() {
  [ "$CLEANED" -eq 0 ] || return 0
  CLEANED=1
  if [ -n "$APP_PID" ]; then
    terminate_app_group "$APP_PID"
  fi
  [ -z "$HEARTBEAT_PID" ] || kill "$HEARTBEAT_PID" 2>/dev/null || true
  [ -z "$LOG_STREAM_PID" ] || kill "$LOG_STREAM_PID" 2>/dev/null || true
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

stream_app_log() {
  local shown=0
  while true; do
    local available
    available="$(wc -l < "$LOG" | tr -d ' ')"
    if [ "$available" -gt "$shown" ]; then
      sed -n "$((shown + 1)),${available}p" "$LOG" | sed -u 's/^/[app] /'
      shown="$available"
    fi
    sleep 2
  done
}

start_heartbeat() {
  local label="$1"
  local started
  started="$(date +%s)"
  (
    while true; do
      sleep 30
      echo "e2e: heartbeat — ${label} running for $(( $(date +%s) - started ))s"
    done
  ) &
  HEARTBEAT_PID=$!
}

stop_heartbeat() {
  if [ -n "$HEARTBEAT_PID" ]; then
    kill "$HEARTBEAT_PID" 2>/dev/null || true
    wait "$HEARTBEAT_PID" 2>/dev/null || true
    HEARTBEAT_PID=""
  fi
}

run_playwright() {
  local label="$1"
  shift
  echo "e2e: starting ${label} at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  start_heartbeat "$label"
  local status=0
  pnpm exec playwright test -c e2e/playwright.config.ts "$@" || status=$?
  stop_heartbeat
  if [ "$status" -eq 0 ]; then
    echo "e2e: completed ${label}"
  else
    echo "e2e: failed ${label} with exit code ${status}" >&2
  fi
  return "$status"
}

stream_app_log &
LOG_STREAM_PID=$!

if lsof -ti :1420 >/dev/null 2>&1; then
  echo "e2e: port 1420 is already owned by pid(s): $(lsof -ti :1420 | tr '\n' ' ')" >&2
  exit 1
fi

start_app() {
  rm -f "$SOCK"
  OPENLEAF_DATA_DIR="$DATA_DIR" pnpm tauri dev --features e2e-testing >>"$LOG" 2>&1 &
  APP_PID=$!
  echo "e2e: waiting for the bridge socket (first build can take minutes)..."
  for _ in $(seq 1 900); do
    [ -S "$SOCK" ] && break
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      echo "e2e: app process exited early; last log lines:" >&2
      tail -20 "$LOG" >&2
      return 1
    fi
    sleep 1
  done
  [ -S "$SOCK" ] || { echo "e2e: bridge socket never appeared; log tail:" >&2; tail -20 "$LOG" >&2; return 1; }
  SOCK_ID="$(e2e_socket_identity "$SOCK")"
}

stop_app() {
  if [ -n "$APP_PID" ]; then
    terminate_app_group "$APP_PID"
    APP_PID=""
  fi
  remove_owned_e2e_socket "$SOCK" "$SOCK_ID"
  SOCK_ID=""
}

has_spec=0
for arg in "$@"; do
  case "$arg" in
    *.spec.ts|*.spec.ts:*) has_spec=1 ;;
  esac
done

if [ "$has_spec" -eq 1 ]; then
  start_app
  run_playwright "requested spec selection" "$@"
else
  suite_status=0
  for spec in e2e/tests/*.spec.ts; do
    start_app
    if ! run_playwright "$(basename "$spec")" "$@" "$spec"; then
      suite_status=1
    fi
    stop_app
  done
  exit "$suite_status"
fi
