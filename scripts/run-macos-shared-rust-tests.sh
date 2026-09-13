#!/usr/bin/env bash
set -euo pipefail

LOG_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
FIRST_LOG="$(mktemp "$LOG_ROOT/oleafly-shared-rust-first.XXXXXX")"
RETRY_DELAY_SECONDS="${OLEAFLY_MACOS_RUST_RETRY_DELAY_SECONDS:-2}"

cleanup_first_log() {
  rm -f "$FIRST_LOG"
}
trap cleanup_first_log EXIT

run_shared_tests() {
  cargo test -p oleafly-core -p oleafly-cli --all-targets
}

set +e
run_shared_tests 2>&1 | tee "$FIRST_LOG"
FIRST_PIPE_STATUSES=("${PIPESTATUS[@]}")
set -e

FIRST_CARGO_STATUS="${FIRST_PIPE_STATUSES[0]}"
FIRST_TEE_STATUS="${FIRST_PIPE_STATUSES[1]}"
FIRST_STATUS="$FIRST_CARGO_STATUS"
if [[ "$FIRST_STATUS" -eq 0 ]]; then
  FIRST_STATUS="$FIRST_TEE_STATUS"
fi

if [[ "$FIRST_CARGO_STATUS" -eq 0 && "$FIRST_TEE_STATUS" -eq 0 ]]; then
  exit 0
fi

# GitHub's hosted Apple Silicon runners can occasionally refuse to execute a
# freshly linked Rust build script. Retry only that exact infrastructure
# signature; ordinary compiler and test failures keep their original status.
if ! grep -Fq 'failed to run custom build command for `oleafly-cli' "$FIRST_LOG" \
  || ! grep -Fq 'build-script-build' "$FIRST_LOG" \
  || ! grep -Fq 'exit status: 126' "$FIRST_LOG" \
  || ! grep -Fq 'cannot execute binary file' "$FIRST_LOG"; then
  exit "$FIRST_STATUS"
fi

FAILED_SCRIPT="$(
  sed -n 's/.*process didn.t exit successfully: `\([^`]*\/build\/oleafly-cli-[^`]*\/build-script-build\)`.*/\1/p' "$FIRST_LOG" \
    | tail -n 1
)"
if [[ -n "$FAILED_SCRIPT" && -f "$FAILED_SCRIPT" ]]; then
  echo "Rust build-script diagnostics for $FAILED_SCRIPT"
  file "$FAILED_SCRIPT" || true
  stat -f '%N: %z bytes, mode %Sp' "$FAILED_SCRIPT" || true
  lipo -info "$FAILED_SCRIPT" || true
  codesign --verify --verbose=4 "$FAILED_SCRIPT" || true
  xattr -l "$FAILED_SCRIPT" || true
  shasum -a 256 "$FAILED_SCRIPT" || true
fi

echo "::warning title=Retrying shared Rust tests::The macOS runner could not execute a freshly linked Oleafly build script. The generated CLI artifacts will be rebuilt once."
sleep "$RETRY_DELAY_SECONDS"
cargo clean -p oleafly-cli
run_shared_tests
