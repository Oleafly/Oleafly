#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?usage: smoke-typst.sh <target-triple>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT=""
[[ "$TARGET" == *windows* ]] && EXT=".exe"
BIN="$ROOT/src-tauri/binaries/typst-$TARGET$EXT"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

"$BIN" --version | grep -F "typst 0.15.0"
"$BIN" --color never compile "$ROOT/scripts/fixtures/typst-smoke.typ" "$OUT/smoke.pdf" \
  --root "$ROOT" --diagnostic-format short
test -s "$OUT/smoke.pdf"
if "$BIN" --color never compile "$ROOT/scripts/fixtures/typst-invalid.typ" "$OUT/invalid.pdf" \
  --root "$ROOT" --diagnostic-format short 2>"$OUT/invalid.log"; then
  echo "invalid Typst fixture unexpectedly compiled" >&2
  exit 1
fi
grep -F "typst-invalid.typ" "$OUT/invalid.log"
