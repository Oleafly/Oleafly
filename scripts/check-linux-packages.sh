#!/usr/bin/env bash
#
# Checks the bundled tools in the finished Linux packages, because a test of the
# staged binaries cannot see what packaging did to them.
#   ./scripts/check-linux-packages.sh <target-triple>
set -euo pipefail

TARGET="${1:?usage: check-linux-packages.sh <target-triple>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS=(tectonic pandoc typst)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BUNDLE="${OLEAFLY_BUNDLE_DIR:-$ROOT/src-tauri/target/$TARGET/release/bundle}"
[[ -d "$BUNDLE" ]] || BUNDLE="$ROOT/src-tauri/target/release/bundle"

sha() {
  local file="$1"
  sha256sum "$file" | awk '{print $1}'
}

check_tree() {
  local label="$1" tree="$2"
  for tool in "${TOOLS[@]}"; do
    local packaged="$tree/usr/libexec/oleafly/$tool"
    if [[ ! -x "$packaged" ]]; then
      echo "$label: $tool is missing or not executable" >&2
      exit 1
    fi
    if [[ "$(sha "$packaged")" != "$(sha "$ROOT/src-tauri/binaries/$tool-$TARGET")" ]]; then
      echo "$label: packaging changed $tool" >&2
      exit 1
    fi
    if [[ -e "$tree/usr/bin/$tool" ]]; then
      echo "$label: $tool is in /usr/bin, where it collides with distribution packages" >&2
      exit 1
    fi
    "$packaged" --version >/dev/null
  done
  "$tree/usr/bin/tectonic-biber" --version | grep -F "biber version: 2.17"
  echo "✓ $label"
}

deb="$(find "$BUNDLE/deb" -maxdepth 1 -name '*.deb' | head -n 1)"
mkdir "$TMP/deb"
dpkg-deb -x "$deb" "$TMP/deb"
check_tree "$(basename "$deb")" "$TMP/deb"

# The release workflow leaves the RPM out of pre-releases.
if [[ "$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version")" != *-* ]]; then
  rpm="$(find "$BUNDLE/rpm" -maxdepth 1 -name '*.rpm' | head -n 1)"
  mkdir "$TMP/rpm"
  # rpm2cpio exits 1 on Tauri's packages after writing the whole payload, so its
  # exit code says nothing. check_tree proves what came out.
  rpm2cpio "$rpm" >"$TMP/payload.cpio" || true
  (cd "$TMP/rpm" && cpio -idm --quiet <"$TMP/payload.cpio")
  check_tree "$(basename "$rpm")" "$TMP/rpm"
fi

appimage="$(find "$BUNDLE/appimage" -maxdepth 1 -name '*.AppImage' | head -n 1)"
(cd "$TMP" && "$appimage" --appimage-extract >/dev/null)
check_tree "$(basename "$appimage")" "$TMP/squashfs-root"
