#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="$(mktemp -d /tmp/oleafly-e2e-lock-test.XXXXXX)"
export TMPDIR
export OLEAFLY_E2E_LOCK_DIR="$TMPDIR/runner.lock"
source "$ROOT/scripts/e2e-run-lock.sh"

cleanup_test() {
  release_e2e_lock
  rm -rf "$TMPDIR"
}
trap cleanup_test EXIT

acquire_e2e_lock
if (
  source "$ROOT/scripts/e2e-run-lock.sh"
  acquire_e2e_lock
); then
  exit 1
fi
release_e2e_lock

mkdir "$e2e_lock_dir"
(
  sleep 0.2
  printf '%s\n' "$$" >"$e2e_lock_dir/owner"
) &
publisher=$!
if acquire_e2e_lock; then
  exit 1
fi
wait "$publisher"
rm -f "$e2e_lock_dir/owner"
rmdir "$e2e_lock_dir"

mkdir "$e2e_lock_dir"
printf '%s\n' '99999999' >"$e2e_lock_dir/owner"
acquire_e2e_lock
test "$(sed -n '1p' "$e2e_lock_dir/owner")" = "$$"
release_e2e_lock

launcher="$(cat "$ROOT/scripts/e2e.sh")"
case "$launcher" in
  *"acquire_e2e_lock"*"ensure-e2e-sidecars.sh"*) ;;
  *) exit 1 ;;
esac
case "$launcher" in
  *'remove_owned_e2e_socket "$SOCK" "$SOCK_ID"'*"release_e2e_lock"*) ;;
  *) exit 1 ;;
esac
case "$launcher" in
  *'SOCK_ID="$(e2e_socket_identity "$SOCK")"'*) ;;
  *) exit 1 ;;
esac
case "$launcher" in
  *"trap cleanup EXIT"*"trap 'exit 130' INT"*"trap 'exit 143' TERM"*) ;;
  *) exit 1 ;;
esac
case "$(sed -n '1,110p' "$ROOT/scripts/e2e-run-lock.sh")" in
  *"kill -TERM"*"kill -KILL"*) ;;
  *) exit 1 ;;
esac

powershell_launcher="$(cat "$ROOT/scripts/e2e.ps1")"
case "$powershell_launcher" in
  *"WaitOne(0)"*"ensure-e2e-sidecars.ps1"*"ReleaseMutex"*) ;;
  *) exit 1 ;;
esac
case "$powershell_launcher" in
  *'@selection | Out-Host'*'Get-ChildItem -Path "e2e/tests" -Filter "*.spec.ts"'*'$specPath = "e2e/tests/$($spec.Name)"'*'Run-Playwright $label @($specPath)'*"Stop-App"*) ;;
  *) exit 1 ;;
esac
