#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="$(rustc -vV | awk '/^host: / { print $2 }')"
case "$HOST" in
  aarch64-apple-darwin|x86_64-apple-darwin|aarch64-unknown-linux-gnu|x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc) ;;
  *) echo "unsupported E2E host: $HOST" >&2; exit 1 ;;
esac

EXT=""
[[ "$HOST" == *windows* ]] && EXT=".exe"
TYPST="$ROOT/src-tauri/binaries/typst-$HOST$EXT"
TECTONIC="$ROOT/src-tauri/binaries/tectonic-$HOST$EXT"

bash "$ROOT/scripts/fetch-typst.sh" "$HOST"
bash "$ROOT/scripts/fetch-tectonic.sh" "$HOST"

TYPST_VERSION="$("$TYPST" --version)"
TECTONIC_VERSION="$("$TECTONIC" --version)"
grep -Fi "typst 0.15.0" <<<"$TYPST_VERSION" >/dev/null
grep -Fi "tectonic 0.16.9" <<<"$TECTONIC_VERSION" >/dev/null
