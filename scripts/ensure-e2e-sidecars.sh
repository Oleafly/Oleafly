#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="$(rustc -vV | awk '/^host: / { print $2 }')"
case "$HOST" in
  aarch64-apple-darwin|aarch64-unknown-linux-gnu|x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc) ;;
  *) echo "unsupported E2E host: $HOST" >&2; exit 1 ;;
esac

EXT=""
[[ "$HOST" == *windows* ]] && EXT=".exe"
TYPST="$ROOT/src-tauri/binaries/typst-$HOST$EXT"
TECTONIC="$ROOT/src-tauri/binaries/tectonic-$HOST$EXT"
BIBER="$ROOT/src-tauri/binaries/tectonic-biber-$HOST$EXT"

bash "$ROOT/scripts/fetch-typst.sh" "$HOST"
bash "$ROOT/scripts/fetch-tectonic.sh" "$HOST"
bash "$ROOT/scripts/fetch-biber.sh" "$HOST"

TYPST_VERSION="$("$TYPST" --version)"
TECTONIC_VERSION="$("$TECTONIC" --version)"
grep -Fi "typst 0.15.0" <<<"$TYPST_VERSION" >/dev/null
grep -Fi "tectonic 0.16.9" <<<"$TECTONIC_VERSION" >/dev/null
# Biber is optional on aarch64 Linux (no upstream 2.17 binary).
if [[ -f "$BIBER" ]]; then
  BIBER_VERSION="$("$BIBER" --version 2>&1 || true)"
  grep -Fi "2.17" <<<"$BIBER_VERSION" >/dev/null
fi
