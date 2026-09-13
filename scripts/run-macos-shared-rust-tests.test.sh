#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/oleafly-macos-rust-retry-test.XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$FAKE_BIN"

cleanup_test() {
  rm -rf "$TEST_ROOT"
}
trap cleanup_test EXIT

cat >"$FAKE_BIN/cargo" <<'FAKE_CARGO'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$OLEAFLY_RETRY_TEST_CALL_LOG"
if [[ "${1:-}" == "clean" ]]; then
  exit 0
fi

ATTEMPT=0
if [[ -f "$OLEAFLY_RETRY_TEST_ATTEMPT_FILE" ]]; then
  ATTEMPT="$(cat "$OLEAFLY_RETRY_TEST_ATTEMPT_FILE")"
fi
ATTEMPT=$((ATTEMPT + 1))
printf '%s\n' "$ATTEMPT" >"$OLEAFLY_RETRY_TEST_ATTEMPT_FILE"

emit_exec_failure() {
  echo 'error: failed to run custom build command for `oleafly-cli v0.1.0`'
  echo "process didn't exit successfully: \`/tmp/target/debug/build/oleafly-cli-hash/build-script-build\` (exit status: 126)"
  echo '/tmp/target/debug/build/oleafly-cli-hash/build-script-build: cannot execute binary file'
}

case "$OLEAFLY_RETRY_TEST_SCENARIO" in
  success|tee_failure)
    exit 0
    ;;
  ordinary_failure)
    echo 'test assertion failed'
    exit 23
    ;;
  retry_success)
    if [[ "$ATTEMPT" -eq 1 ]]; then
      emit_exec_failure
      exit 101
    fi
    exit 0
    ;;
  retry_failure)
    emit_exec_failure
    exit 101
    ;;
  *)
    exit 99
    ;;
esac
FAKE_CARGO
chmod +x "$FAKE_BIN/cargo"

cat >"$FAKE_BIN/tee" <<'FAKE_TEE'
#!/usr/bin/env bash
set -euo pipefail

output_file="${1:?output file is required}"
cat >"$output_file"
cat "$output_file"
if [[ "$OLEAFLY_RETRY_TEST_SCENARIO" == "tee_failure" ]]; then
  exit 34
fi
FAKE_TEE
chmod +x "$FAKE_BIN/tee"

run_case() {
  local scenario="$1"
  local expected_status="$2"
  local expected_calls="$3"
  local case_root="$TEST_ROOT/$scenario"
  local call_log="$case_root/calls.log"
  local attempt_file="$case_root/attempt"
  local output="$case_root/output.log"
  local status
  local actual_calls

  mkdir -p "$case_root"
  set +e
  PATH="$FAKE_BIN:$PATH" \
    RUNNER_TEMP="$case_root" \
    OLEAFLY_MACOS_RUST_RETRY_DELAY_SECONDS=0 \
    OLEAFLY_RETRY_TEST_CALL_LOG="$call_log" \
    OLEAFLY_RETRY_TEST_ATTEMPT_FILE="$attempt_file" \
    OLEAFLY_RETRY_TEST_SCENARIO="$scenario" \
    bash "$ROOT/scripts/run-macos-shared-rust-tests.sh" >"$output" 2>&1
  status=$?
  set -e

  [[ "$status" -eq "$expected_status" ]]
  actual_calls="$(wc -l <"$call_log" | tr -d ' ')"
  [[ "$actual_calls" -eq "$expected_calls" ]]
}

run_case success 0 1
run_case success 0 2
run_case tee_failure 34 1
run_case ordinary_failure 23 1
run_case retry_success 0 3
run_case retry_failure 101 3

grep -Fq 'clean -p oleafly-cli' "$TEST_ROOT/retry_success/calls.log"
grep -Fq 'Retrying shared Rust tests' "$TEST_ROOT/retry_success/output.log"
if grep -Fq 'Retrying shared Rust tests' "$TEST_ROOT/ordinary_failure/output.log"; then
  exit 1
fi

echo 'macOS Rust retry guard tests passed'
