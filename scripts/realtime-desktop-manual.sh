#!/usr/bin/env bash
set -euo pipefail
set -m

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOCK_DIR="${TMPDIR:-/tmp}/oleafly-realtime-desktop-manual.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -f "$LOCK_DIR/pid" ] && kill -0 "$(<"$LOCK_DIR/pid")" 2>/dev/null; then
    echo "The two-app realtime launcher is already running (PID $(<"$LOCK_DIR/pid"))." >&2
    exit 1
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
  mkdir "$LOCK_DIR"
fi
echo "$$" >"$LOCK_DIR/pid"

DATA_A="$(mktemp -d "${TMPDIR:-/tmp}/oleafly-realtime-manual-alice.XXXXXX")"
DATA_B="$(mktemp -d "${TMPDIR:-/tmp}/oleafly-realtime-manual-bob.XXXXXX")"
SOCKET_A="${TMPDIR:-/tmp}/oleafly-realtime-manual-alice-$$.sock"
SOCKET_B="${TMPDIR:-/tmp}/oleafly-realtime-manual-bob-$$.sock"
VITE_LOG="$(mktemp "${TMPDIR:-/tmp}/oleafly-realtime-manual-vite.XXXXXX")"
ALICE_LOG="$(mktemp "${TMPDIR:-/tmp}/oleafly-realtime-manual-alice-log.XXXXXX")"
BOB_LOG="$(mktemp "${TMPDIR:-/tmp}/oleafly-realtime-manual-bob-log.XXXXXX")"
VITE_PID=""
ALICE_PID=""
BOB_PID=""
CLEANED=0
VITE_PORT="${OLEAFLY_REALTIME_VITE_PORT:-1431}"
REALTIME_TEST_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
COMPOSE=(docker compose --project-name oleafly-realtime-dev -f compose.realtime.dev.yaml)

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
  if [[ "$DATA_A" == "${TMPDIR:-/tmp}"/oleafly-realtime-manual-alice.* ]]; then
    rm -rf "$DATA_A"
  fi
  if [[ "$DATA_B" == "${TMPDIR:-/tmp}"/oleafly-realtime-manual-bob.* ]]; then
    rm -rf "$DATA_B"
  fi
  if [ "$status" -ne 0 ]; then
    echo "Alice Desktop log: $ALICE_LOG" >&2
    tail -40 "$ALICE_LOG" >&2 || true
    echo "Bob Desktop log: $BOB_LOG" >&2
    tail -40 "$BOB_LOG" >&2 || true
    echo "Vite log: $VITE_LOG" >&2
    tail -40 "$VITE_LOG" >&2 || true
  fi
  rm -f "$VITE_LOG" "$ALICE_LOG" "$BOB_LOG" "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
  return "$status"
}

on_signal() {
  exit 130
}

trap cleanup EXIT
trap on_signal INT TERM

echo "Starting or reusing the oleafly-realtime-dev Docker stack..."
"${COMPOSE[@]}" up -d --build
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:8787/ready" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:8787/ready" >/dev/null

HOST="$(rustc -vV | awk '/^host: / { print $2}')"
if [ ! -x "src-tauri/binaries/typst-$HOST" ] || \
   [ ! -x "src-tauri/binaries/tectonic-$HOST" ] || \
   [ ! -x "src-tauri/binaries/tectonic-biber-$HOST" ]; then
  bash scripts/ensure-e2e-sidecars.sh
fi

if lsof -ti ":$VITE_PORT" >/dev/null 2>&1; then
  echo "Port $VITE_PORT is already in use; set OLEAFLY_REALTIME_VITE_PORT to a free port." >&2
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
OLEAFLY_DATA_DIR="$DATA_A" \
OLEAFLY_REALTIME_TEST_KEY="$REALTIME_TEST_KEY" \
TAURI_PLAYWRIGHT_SOCKET="$SOCKET_A" \
OLEAFLY_E2E_BOOT_LOCALSTORAGE="$SEED" \
OLEAFLY_E2E_WINDOW=900x700 \
OLEAFLY_E2E_POSITION=0,30 \
OLEAFLY_E2E_TITLE="Oleafly — Alice" \
  "$APP" >"$ALICE_LOG" 2>&1 &
ALICE_PID=$!

OLEAFLY_DATA_DIR="$DATA_B" \
OLEAFLY_REALTIME_TEST_KEY="$REALTIME_TEST_KEY" \
TAURI_PLAYWRIGHT_SOCKET="$SOCKET_B" \
OLEAFLY_E2E_BOOT_LOCALSTORAGE="$SEED" \
OLEAFLY_E2E_WINDOW=900x700 \
OLEAFLY_E2E_POSITION=920,30 \
OLEAFLY_E2E_TITLE="Oleafly — Bob" \
  "$APP" >"$BOB_LOG" 2>&1 &
BOB_PID=$!

OLEAFLY_REALTIME_SOCKET_A="$SOCKET_A" \
OLEAFLY_REALTIME_SOCKET_B="$SOCKET_B" \
  node scripts/realtime-desktop-manual.mjs

echo "Close both Oleafly windows to end this launcher."
echo "The reusable Docker stack will remain running. Stop it with:"
echo "  docker compose --project-name oleafly-realtime-dev -f compose.realtime.dev.yaml down"

set +e
wait "$ALICE_PID"
ALICE_STATUS=$?
wait "$BOB_PID"
BOB_STATUS=$?
set -e

echo "Both Oleafly test instances are closed (Alice: $ALICE_STATUS, Bob: $BOB_STATUS)."
