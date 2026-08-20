#!/usr/bin/env bash
#
# Fetch a Biber binary pinned to match Tectonic 0.16.x's bundled biblatex (3.17).
#   ./scripts/fetch-biber.sh aarch64-apple-darwin
#   ./scripts/fetch-biber.sh all
#
# Output: src-tauri/binaries/tectonic-biber-<triple>[.exe]
# Tectonic prefers a binary named `tectonic-biber` on PATH over a generic `biber`,
# which avoids version skew with system TeX Live.
set -euo pipefail

# biblatex 3.17 (Tectonic 0.16.9 bundle) requires Biber 2.17.
VERSION="2.17"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
CACHE_DIR="${OLEAFLY_SIDECAR_CACHE_DIR:-$ROOT/src-tauri/target/e2e-sidecars}"
mkdir -p "$BIN_DIR"
mkdir -p "$CACHE_DIR"
TMP=""

cleanup_fetch() {
  if [[ -n "$TMP" ]]; then
    rm -rf "$TMP"
    TMP=""
  fi
}
trap cleanup_fetch EXIT INT TERM

# "<relative-path-under-binaries>:<archive-kind>:<sha256>[:lipo-arch]"
# lipo-arch is optional: when set, extract a universal binary and thin to that arch.
asset_for() {
  case "$1" in
    aarch64-apple-darwin)
      # Universal 2.17 binary; thin to arm64 to keep the sidecar smaller.
      echo "MacOS/biber-darwin_universal.tar.gz:tar:182e1efa074d8a2a23a8893f2a22440d4e463cce55e4ed02076ac4c0ee0614b2:arm64"
      ;;
    x86_64-apple-darwin)
      echo "MacOS/biber-darwin_x86_64.tar.gz:tar:aa72ccdd01d59367b919d517f7a116e5dc40848abc1909cd812b485f791df7f4"
      ;;
    x86_64-unknown-linux-gnu)
      echo "Linux/biber-linux_x86_64.tar.gz:tar:129d2e0332a57e985ffa253e5e9fbd28ef99af5a068d1b141145211969aa8999"
      ;;
    x86_64-pc-windows-msvc)
      echo "Windows/biber-MSWIN64.zip:zip:c103bffc5ae0a7f513e7c26b6d394e9be6cf41952959c5d604ee2e6581b5dea2"
      ;;
    aarch64-unknown-linux-gnu)
      # Upstream did not publish a native 2.17 aarch64 Linux binary.
      # Marker: handled specially with a clear-error stub so externalBin packaging
      # still has a file for this triple.
      echo "STUB"
      ;;
    *)
      echo ""
      ;;
  esac
}

ALL_TARGETS="aarch64-apple-darwin x86_64-apple-darwin aarch64-unknown-linux-gnu x86_64-unknown-linux-gnu x86_64-pc-windows-msvc"

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

write_stub() {
  local target="$1"
  local out="$BIN_DIR/tectonic-biber-$target"
  cat > "$out" <<'STUB'
#!/bin/sh
echo "Oleafly: pinned Biber 2.17 is not available for this platform (no upstream aarch64 Linux binary)." >&2
echo "Install a matching Biber yourself or compile on x86_64 / macOS / Windows." >&2
exit 1
STUB
  chmod +x "$out"
  echo "✓ $out (stub — no upstream Biber $VERSION binary for $target)"
}

fetch() {
  local target="$1"
  local entry
  entry="$(asset_for "$target")"
  if [[ "$entry" == "STUB" ]]; then
    write_stub "$target"
    return 0
  fi
  if [[ -z "$entry" ]]; then
    echo "unknown target: $target" >&2
    exit 1
  fi

  local asset="${entry%%:*}"
  local rest="${entry#*:}"
  local kind="${rest%%:*}"
  rest="${rest#*:}"
  local expected_sha="${rest%%:*}"
  local lipo_arch=""
  if [[ "$rest" == *:* ]]; then
    lipo_arch="${rest#*:}"
  fi

  local ext=""
  [[ "$target" == *windows* ]] && ext=".exe"
  local out="$BIN_DIR/tectonic-biber-$target$ext"
  local base="https://downloads.sourceforge.net/project/biblatex-biber/biblatex-biber/$VERSION/binaries"
  local mirror_url="https://mirrors.oleafly.com/binaries/biber/$VERSION/$asset"
  local url="$base/$asset"
  local cache_name="biber-$VERSION-$(basename "$asset")"
  local archive="$CACHE_DIR/$cache_name"

  TMP="$(mktemp -d)"
  local tmp="$TMP"
  local actual_sha=""
  if [[ -f "$archive" && ! -L "$archive" ]]; then
    actual_sha="$(checksum "$archive")"
  fi
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    rm -f "$archive"
    echo "→ fetching $target ($asset)"
    # Mirror first: SourceForge is the least reliable origin in the toolchain.
    # The checksum pin below keeps either origin honest.
    if ! curl -fSL --proto '=https' --connect-timeout 30 \
        --speed-limit 1024 --speed-time 60 \
        --retry 5 --retry-delay 3 --retry-connrefused \
        -o "$tmp/download" "$mirror_url"; then
      echo "mirror download failed; falling back to $url" >&2
      rm -f "$tmp/download"
      if ! curl -fSL --proto '=https' --connect-timeout 30 \
          --speed-limit 1024 --speed-time 60 \
          --retry 5 --retry-delay 3 --retry-connrefused \
          -o "$tmp/download" "$url"; then
        echo "failed to download $url" >&2
        exit 1
      fi
    fi
    actual_sha="$(checksum "$tmp/download")"
    if [[ "$actual_sha" == "$expected_sha" ]]; then
      mv "$tmp/download" "$archive"
    fi
  fi
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "checksum mismatch for $asset: expected $expected_sha, got $actual_sha" >&2
    exit 1
  fi

  case "$kind" in
    tar)
      tar xzf "$archive" -C "$tmp"
      if [[ ! -f "$tmp/biber" || -L "$tmp/biber" ]]; then
        echo "could not locate biber binary in archive for $target" >&2
        exit 1
      fi
      if [[ -n "$lipo_arch" ]]; then
        if ! command -v lipo >/dev/null 2>&1; then
          echo "lipo is required to thin the macOS universal Biber binary" >&2
          exit 1
        fi
        lipo "$tmp/biber" -thin "$lipo_arch" -output "$tmp/biber-thin"
        mv "$tmp/biber-thin" "$tmp/biber"
      fi
      local bin="$tmp/biber"
      ;;
    zip)
      unzip -oq "$archive" -d "$tmp"
      local bin=""
      if [[ -f "$tmp/biber.exe" ]]; then
        bin="$tmp/biber.exe"
      else
        bin="$(find "$tmp" -type f -name 'biber.exe' | head -n 1 || true)"
      fi
      if [[ -z "$bin" || ! -f "$bin" ]]; then
        echo "could not locate biber.exe in archive for $target" >&2
        exit 1
      fi
      ;;
    *)
      echo "unknown archive kind: $kind" >&2
      exit 1
      ;;
  esac

  if [[ -f "$out" && ! -L "$out" ]] && cmp -s "$bin" "$out"; then
    chmod +x "$out" 2>/dev/null || true
    if [[ "$(uname)" == "Darwin" ]]; then
      xattr -d com.apple.quarantine "$out" 2>/dev/null || true
    fi
    cleanup_fetch
    echo "✓ $out"
    return
  fi
  cp "$bin" "$out"
  chmod +x "$out" 2>/dev/null || true
  if [[ "$(uname)" == "Darwin" ]]; then
    xattr -d com.apple.quarantine "$out" 2>/dev/null || true
  fi
  cleanup_fetch
  echo "✓ $out"
}

if [[ "$#" -eq 0 ]]; then
  echo "usage: $0 <target-triple> | all"
  echo "targets: $ALL_TARGETS"
  echo "pinned Biber version: $VERSION (matches Tectonic 0.16.x / biblatex 3.17)"
  exit 0
fi

if [[ "$1" == "all" ]]; then
  for t in $ALL_TARGETS; do fetch "$t"; done
else
  fetch "$1"
fi
