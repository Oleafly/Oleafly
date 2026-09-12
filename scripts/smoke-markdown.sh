#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?usage: smoke-markdown.sh <target-triple>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="3.9.0.2"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

case "$TARGET" in
  aarch64-apple-darwin)
    EXT=""; TECTONIC="src-tauri/binaries/tectonic-$TARGET" ;;
  aarch64-unknown-linux-gnu)
    EXT=""; TECTONIC="src-tauri/binaries/tectonic-$TARGET" ;;
  x86_64-unknown-linux-gnu)
    EXT=""; TECTONIC="src-tauri/binaries/tectonic-$TARGET" ;;
  x86_64-pc-windows-msvc)
    EXT=".exe"; TECTONIC="src-tauri/binaries/tectonic-$TARGET.exe" ;;
  *) echo "unsupported Markdown smoke target: $TARGET" >&2; exit 1 ;;
esac

bash "$ROOT/scripts/fetch-pandoc.sh" "$TARGET"
PANDOC="$ROOT/src-tauri/binaries/pandoc-$TARGET$EXT"
"$PANDOC" --version | grep -F "pandoc $VERSION"
if [[ "$TARGET" == x86_64-pc-windows-msvc ]]; then
  ENGINE="$TMP/tectonic.exe"
  cp "$ROOT/$TECTONIC" "$ENGINE"
else
  ENGINE="$TMP/tectonic"
  ln -s "$ROOT/$TECTONIC" "$ENGINE"
fi
# Pull TeX packages from our own mirror instead of relay.fullyjustified.net,
# which rate-limits CI runners (HTTP 429). Attempts 1-2 use the mirror;
# attempts 3-4 drop the pin and use Tectonic's upstream bundle, so neither
# origin being down (or blocking datacenter IPs) can fail the build alone.
BUNDLE_URL="${OLEAFLY_TEX_BUNDLE_URL:-https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar}"
attempt=1
while :; do
  BUNDLE_OPTS=(--pdf-engine-opt=-b "--pdf-engine-opt=$BUNDLE_URL")
  if [[ "$attempt" -ge 3 ]]; then
    BUNDLE_OPTS=()
  fi
  if "$PANDOC" --from=markdown --standalone \
    "--pdf-engine=$ENGINE" \
    ${BUNDLE_OPTS[@]+"${BUNDLE_OPTS[@]}"} \
    --output="$TMP/smoke.pdf" -- \
    "$ROOT/scripts/fixtures/markdown-smoke.md"; then
    break
  fi
  if [[ "$attempt" -ge 4 ]]; then
    echo "markdown smoke compile failed after $attempt attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "compile failed (transient bundle fetch?); attempt $attempt after 75s" >&2
  sleep 75
done
[[ -s "$TMP/smoke.pdf" ]]
