#!/usr/bin/env bash
# Self-contained e2e run: builds + launches the app with the e2e bridge and a
# throwaway data dir, waits for the bridge socket, runs the Playwright suite,
# and always tears the app down.
# Usage: ./scripts/e2e.sh [--suite-max-failures=N] [playwright args...]
set -euo pipefail
# Give each background app launch its own process group so teardown can target
# only processes owned by this runner.
set -m
cd "$(dirname "$0")/.."

SUITE_MAX_FAILURES=0
SHARD=""
PLAYWRIGHT_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --suite-max-failures=*)
      SUITE_MAX_FAILURES="${1#*=}"
      ;;
    --suite-max-failures)
      shift
      [ "$#" -gt 0 ] || { echo "e2e: --suite-max-failures requires a value" >&2; exit 2; }
      SUITE_MAX_FAILURES="$1"
      ;;
    --shard=*)
      SHARD="${1#*=}"
      ;;
    --ci-parity)
      # Reproduce CI's smaller window locally so toolbar controls overflow the
      # same way they do on runners (a whole class of CI-only interaction bugs
      # reproduces in minutes with this instead of needing a CI round-trip).
      export OLEAFLY_E2E_WINDOW="${OLEAFLY_E2E_WINDOW:-1024x700}"
      ;;
    *)
      PLAYWRIGHT_ARGS+=("$1")
      ;;
  esac
  shift
done

if [ -n "$SHARD" ]; then
  case "$SHARD" in
    */*) ;;
    *)
      echo "e2e: --shard must look like K/N (e.g. 2/4)" >&2
      exit 2
      ;;
  esac
fi

case "$SUITE_MAX_FAILURES" in
  ''|*[!0-9]*)
    echo "e2e: --suite-max-failures must be a non-negative integer" >&2
    exit 2
    ;;
esac

set -- "${PLAYWRIGHT_ARGS[@]}"

source scripts/e2e-run-lock.sh
acquire_e2e_lock

APP_PID=""
LOG=""
DATA_DIR=""
LOG_STREAM_PID=""
HEARTBEAT_PID=""
SOCK="${TAURI_PLAYWRIGHT_SOCKET:-/tmp/tauri-playwright.sock}"
APP_BINARY="${OLEAFLY_E2E_APP_BINARY:-}"
SOCK_ID=""
CLEANED=0

# A packaged custom-protocol smoke can point this runner at a binary built
# with `tauri build --features e2e-testing`. Default runs remain Vite-backed.
if [ -n "$APP_BINARY" ] && [ ! -x "$APP_BINARY" ]; then
  echo "e2e: OLEAFLY_E2E_APP_BINARY is not executable: $APP_BINARY" >&2
  exit 2
fi
if [ -n "$APP_BINARY" ]; then
  export OLEAFLY_E2E_PRODUCTION="${OLEAFLY_E2E_PRODUCTION:-1}"
fi

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
  if [ -n "$DATA_DIR" ] && [ -f "$DATA_DIR/app.log" ]; then
    mkdir -p test-results && cp "$DATA_DIR/app.log" test-results/user-app.log 2>/dev/null || true
  fi
  # The per-run data dir is ~200MB of disposable app data; leaking one per
  # run once filled a developer machine's /tmp with tens of gigabytes.
  if [ -n "$DATA_DIR" ]; then
    rm -rf "$DATA_DIR" 2>/dev/null || true
  fi
  if [ -n "$LOG" ]; then
    rm -f "$LOG" 2>/dev/null || true
  fi
  release_e2e_lock
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

bash scripts/ensure-e2e-sidecars.sh

DATA_DIR="$(mktemp -d /tmp/oleafly-e2e.XXXXXX)"
LOG="$(mktemp /tmp/oleafly-e2e-log.XXXXXX)"
# Export so Playwright specs can read discovery files (e.g. mcp.json) written
# into the same throwaway data dir the app uses.
export OLEAFLY_DATA_DIR="$DATA_DIR"
# Hermetic remote endpoints: specs 42/44 run a local fixture server on this fixed
# port; other specs never call the pack/deadline commands, so this is harmless.
export OLEAFLY_PACKS_BASE_URL="${OLEAFLY_PACKS_BASE_URL:-http://127.0.0.1:38999}"
export OLEAFLY_DEADLINES_URL="${OLEAFLY_DEADLINES_URL:-http://127.0.0.1:38999/allconf.yml}"

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

SKIPPED_TOTAL=0
SKIPPED_LIST="$(mktemp)"

run_playwright() {
  local label="$1"
  shift
  local safe_label="${label//[^A-Za-z0-9._-]/-}"
  local output_dir="test-results/$safe_label"
  echo "e2e: starting ${label} at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  start_heartbeat "$label"
  local status=0
  local captured
  captured="$(mktemp)"
  # pipefail is set, so this still reports Playwright's status, not tee's.
  pnpm exec playwright test -c e2e/playwright.config.ts \
    "--output=$output_dir" "$@" 2>&1 | tee "$captured" || status=$?
  stop_heartbeat
  # A skipped test is not coverage. Collect them so the final summary can say
  # so out loud instead of letting "0 failed" imply everything was exercised.
  local skipped
  skipped="$(grep -oE '[0-9]+ skipped' "$captured" | tail -1 | grep -oE '[0-9]+' || true)"
  if [ -n "$skipped" ] && [ "$skipped" -gt 0 ]; then
    SKIPPED_TOTAL=$((SKIPPED_TOTAL + skipped))
    grep -E '^[[:space:]]+-[[:space:]]+[0-9]+ ' "$captured" >>"$SKIPPED_LIST" || true
  fi
  rm -f "$captured"
  if [ "$status" -eq 0 ]; then
    echo "e2e: completed ${label}"
  else
    echo "e2e: failed ${label} with exit code ${status}" >&2
  fi
  return "$status"
}

# The suite launches an app per spec file. If a previous app has not released
# port 1420 yet, the next launch dies and - before this waited - `set -e` tore
# the whole run down, leaving later spec files silently unexecuted.
wait_for_port_free() {
  [ -n "$APP_BINARY" ] && return 0
  local waited=0
  while lsof -ti :1420 >/dev/null 2>&1; do
    if [ "$waited" -ge 30 ]; then
      echo "e2e: port 1420 still held after ${waited}s by pid(s): $(lsof -ti :1420 | tr '\n' ' ')" >&2
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  [ "$waited" -gt 0 ] && echo "e2e: port 1420 cleared after ${waited}s"
  return 0
}

stream_app_log &
LOG_STREAM_PID=$!

if [ -z "$APP_BINARY" ] && lsof -ti :1420 >/dev/null 2>&1; then
  echo "e2e: port 1420 is already owned by pid(s): $(lsof -ti :1420 | tr '\n' ' ')" >&2
  exit 1
fi

start_app() {
  rm -f "$SOCK"
  if [ -n "$APP_BINARY" ]; then
    OLEAFLY_DATA_DIR="$DATA_DIR" "$APP_BINARY" >>"$LOG" 2>&1 &
  else
    OLEAFLY_DATA_DIR="$DATA_DIR" pnpm tauri dev --features e2e-testing >>"$LOG" 2>&1 &
  fi
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
  suite_failures=0
  SUITE_SPECS=()
  if [ -n "$SHARD" ]; then
    # Round-robin split for parallel CI runners. Every shard gets
    # 02-create-compile first: it creates the shared "E2E Doc" project and
    # warms the compile path that later specs assume (the same convention as
    # running a manual subset).
    shard_index="${SHARD%%/*}"
    shard_total="${SHARD##*/}"
    SUITE_SPECS+=("e2e/tests/02-create-compile.spec.ts")
    position=0
    for spec in e2e/tests/*.spec.ts; do
      if [ "$spec" != "e2e/tests/02-create-compile.spec.ts" ] \
        && [ $(( position % shard_total )) -eq $(( shard_index - 1 )) ]; then
        SUITE_SPECS+=("$spec")
      fi
      position=$((position + 1))
    done
    echo "e2e: shard ${SHARD} runs ${#SUITE_SPECS[@]} spec file(s)"
  else
    for spec in e2e/tests/*.spec.ts; do
      SUITE_SPECS+=("$spec")
    done
  fi
  SPECS_RAN=()
  SPECS_FAILED=()
  SPECS_NOT_RUN=()
  stopped_early=0
  for spec in "${SUITE_SPECS[@]}"; do
    # A spec that never runs is indistinguishable from a passing one in the
    # exit code alone, so every spec is accounted for explicitly below.
    if ! wait_for_port_free || ! start_app; then
      stop_app
      echo "e2e: retrying ${spec} after a failed app launch" >&2
      if ! wait_for_port_free || ! start_app; then
        stop_app
        SPECS_NOT_RUN+=("$spec")
        suite_status=1
        continue
      fi
    fi
    if run_playwright "$(basename "$spec")" "$@" "$spec"; then
      SPECS_RAN+=("$spec")
    else
      SPECS_RAN+=("$spec")
      SPECS_FAILED+=("$spec")
      suite_status=1
      suite_failures=$((suite_failures + 1))
    fi
    stop_app
    if [ "$SUITE_MAX_FAILURES" -gt 0 ] && [ "$suite_failures" -ge "$SUITE_MAX_FAILURES" ]; then
      echo "e2e: stopping after ${suite_failures} failed spec(s)" >&2
      stopped_early=1
      break
    fi
  done

  echo
  echo "e2e: ===== run summary ====="
  echo "e2e: spec files expected : ${#SUITE_SPECS[@]}"
  echo "e2e: spec files executed : ${#SPECS_RAN[@]}"
  echo "e2e: spec files failed   : ${#SPECS_FAILED[@]}"
  for spec in "${SPECS_FAILED[@]:-}"; do [ -n "$spec" ] && echo "e2e:   FAILED  $spec"; done
  if [ "${#SPECS_NOT_RUN[@]}" -gt 0 ]; then
    echo "e2e: spec files NOT RUN  : ${#SPECS_NOT_RUN[@]} (treated as failure)"
    for spec in "${SPECS_NOT_RUN[@]}"; do echo "e2e:   NOT RUN $spec"; done
  fi
  if [ "$stopped_early" -eq 1 ]; then
    remaining=$(( ${#SUITE_SPECS[@]} - ${#SPECS_RAN[@]} - ${#SPECS_NOT_RUN[@]} ))
    echo "e2e: stopped early, ${remaining} spec file(s) were never reached"
  fi
  if [ "$SKIPPED_TOTAL" -gt 0 ]; then
    echo "e2e: individual tests skipped: ${SKIPPED_TOTAL} (skipped is not coverage)"
    sort -u "$SKIPPED_LIST" | sed 's/^/e2e:   SKIPPED /' || true
  fi
  rm -f "$SKIPPED_LIST"
  echo "e2e: ========================"
  exit "$suite_status"
fi
