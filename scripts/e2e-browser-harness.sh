#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

SPECS=(e2e/tests/*-browser.spec.ts)
if [[ "${#SPECS[@]}" -eq 0 ]] || [[ ! -f "${SPECS[0]}" ]]; then
  echo "e2e-browser-harness: no e2e/tests/*-browser.spec.ts files found" >&2
  exit 1
fi
PROBE_URL="http://localhost:1420/e2e/settings-install-harness.html"

if lsof -ti :1420 >/dev/null 2>&1; then
  echo "e2e-browser-harness: port 1420 is already owned by pid(s): $(lsof -ti :1420 | tr '\n' ' ')" >&2
  exit 1
fi

VITE_LOG="$(mktemp)"
pnpm exec vite --port 1420 --strictPort >"$VITE_LOG" 2>&1 &
VITE_PID=$!

cleanup() {
  local pids
  pids="$(lsof -ti :1420 2>/dev/null | tr '\n' ' ')"
  kill "$VITE_PID" $pids 2>/dev/null || true
  wait "$VITE_PID" 2>/dev/null || true
  rm -f "$VITE_LOG"
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null "$PROBE_URL"; then
    ready=1
    break
  fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "e2e-browser-harness: Vite never served $PROBE_URL" >&2
  tail -n 40 "$VITE_LOG" >&2
  exit 1
fi
echo "e2e-browser-harness: Vite is serving $PROBE_URL"
printf 'e2e-browser-harness: spec %s\n' "${SPECS[@]}"

status=0
pnpm exec playwright test -c e2e/playwright.config.ts "${SPECS[@]}" "$@" || status=$?
if [[ "$status" -ne 0 ]]; then
  echo "e2e-browser-harness: Playwright exited with $status; last Vite output:" >&2
  tail -n 40 "$VITE_LOG" >&2
fi
exit "$status"
