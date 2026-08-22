#!/usr/bin/env bash
set -euo pipefail
set -m

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DATA_A="$(mktemp -d /tmp/oleafly-realtime-alice.XXXXXX)"
DATA_B="$(mktemp -d /tmp/oleafly-realtime-bob.XXXXXX)"
SOCKET_A="/tmp/oleafly-realtime-alice.sock"
SOCKET_B="/tmp/oleafly-realtime-bob.sock"
VITE_LOG="$(mktemp /tmp/oleafly-realtime-vite.XXXXXX)"
ALICE_LOG="$(mktemp /tmp/oleafly-realtime-alice-log.XXXXXX)"
BOB_LOG="$(mktemp /tmp/oleafly-realtime-bob-log.XXXXXX)"
VITE_PID=""
ALICE_PID=""
BOB_PID=""
CLEANED=0
VITE_PORT="${OLEAFLY_REALTIME_VITE_PORT:-1431}"
REALTIME_TEST_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

cleanup() {
  local status=$?
  [ "$CLEANED" -eq 0 ] || return
  CLEANED=1
  for pid in "$ALICE_PID" "$BOB_PID" "$VITE_PID"; do
    if [ -n "$pid" ]; then
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$SOCKET_A" "$SOCKET_B"
  if [[ "$DATA_A" == /tmp/oleafly-realtime-alice.* ]]; then rm -rf "$DATA_A"; fi
  if [[ "$DATA_B" == /tmp/oleafly-realtime-bob.* ]]; then rm -rf "$DATA_B"; fi
  if [ "$status" -ne 0 ]; then
    echo "Alice Desktop log:" >&2
    tail -40 "$ALICE_LOG" >&2 || true
    echo "Bob Desktop log:" >&2
    tail -40 "$BOB_LOG" >&2 || true
  fi
  rm -f "$VITE_LOG" "$ALICE_LOG" "$BOB_LOG"
}
trap cleanup EXIT INT TERM

docker compose -f compose.realtime.dev.yaml up -d --build
HOST="$(rustc -vV | awk '/^host: / { print $2}')"
if [ ! -x "src-tauri/binaries/typst-$HOST" ] || \
   [ ! -x "src-tauri/binaries/tectonic-$HOST" ] || \
   [ ! -x "src-tauri/binaries/tectonic-biber-$HOST" ]; then
  bash scripts/ensure-e2e-sidecars.sh
fi

if lsof -ti ":$VITE_PORT" >/dev/null 2>&1; then
  echo "Port $VITE_PORT is already in use; set OLEAFLY_REALTIME_VITE_PORT to a free port" >&2
  exit 1
fi
pnpm exec vite --host 127.0.0.1 --port "$VITE_PORT" >"$VITE_LOG" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$VITE_PORT" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$VITE_PORT" >/dev/null

TAURI_CONFIG="{\"build\":{\"devUrl\":\"http://127.0.0.1:$VITE_PORT\"}}" \
  cargo build --manifest-path src-tauri/Cargo.toml --features e2e-testing
APP="$ROOT/src-tauri/target/debug/oleafly"
if [ ! -x "$APP" ]; then
  echo "Desktop test binary was not built at $APP" >&2
  exit 1
fi

SEED='{"oleafly.experimentalRealtime":"true"}'
rm -f "$SOCKET_A" "$SOCKET_B"
OLEAFLY_DATA_DIR="$DATA_A" \
OLEAFLY_REALTIME_TEST_KEY="$REALTIME_TEST_KEY" \
TAURI_PLAYWRIGHT_SOCKET="$SOCKET_A" \
OLEAFLY_E2E_BOOT_LOCALSTORAGE="$SEED" \
OLEAFLY_E2E_WINDOW=900x700 \
  "$APP" >"$ALICE_LOG" 2>&1 &
ALICE_PID=$!
OLEAFLY_DATA_DIR="$DATA_B" \
OLEAFLY_REALTIME_TEST_KEY="$REALTIME_TEST_KEY" \
TAURI_PLAYWRIGHT_SOCKET="$SOCKET_B" \
OLEAFLY_E2E_BOOT_LOCALSTORAGE="$SEED" \
OLEAFLY_E2E_WINDOW=900x700 \
  "$APP" >"$BOB_LOG" 2>&1 &
BOB_PID=$!

for socket in "$SOCKET_A" "$SOCKET_B"; do
  for _ in $(seq 1 90); do
    [ -S "$socket" ] && break
    sleep 1
  done
  if [ ! -S "$socket" ]; then
    echo "A Desktop bridge did not start. Alice log: $ALICE_LOG; Bob log: $BOB_LOG" >&2
    exit 1
  fi
done

OLEAFLY_REALTIME_SOCKET_A="$SOCKET_A" \
OLEAFLY_REALTIME_SOCKET_B="$SOCKET_B" \
OLEAFLY_REALTIME_ALICE_PID="$ALICE_PID" \
OLEAFLY_REALTIME_APP="$APP" \
OLEAFLY_REALTIME_DATA_A="$DATA_A" \
OLEAFLY_REALTIME_ALICE_LOG="$ALICE_LOG" \
OLEAFLY_REALTIME_TEST_KEY="$REALTIME_TEST_KEY" \
OLEAFLY_REALTIME_BOOT_SEED="$SEED" \
  node scripts/realtime-desktop-e2e.mjs
