#!/usr/bin/env bash
set -euo pipefail

dir="${1:-}"
out="${2:-}"
if [ -z "$dir" ] || [ -z "$out" ]; then
  echo "usage: $0 <target-debug-dir> <archive.tar.gz>" >&2
  exit 2
fi
if [ ! -d "$dir" ]; then
  echo "pack: build directory $dir does not exist" >&2
  exit 1
fi

app=""
for candidate in "$dir"/*.exe; do
  [ -f "$candidate" ] || continue
  base="$(basename "$candidate" | tr '[:upper:]' '[:lower:]')"
  if [ "$base" = "oleafly.exe" ]; then
    app="$candidate"
  fi
done
if [ -z "$app" ]; then
  echo "pack: no oleafly.exe in $dir" >&2
  ls -la "$dir" >&2 || true
  exit 1
fi

entries=()
for entry in "$dir"/*; do
  [ -e "$entry" ] || continue
  name="$(basename "$entry")"
  case "$name" in
    build|deps|incremental|examples|.fingerprint|.cargo-lock|*.d|*.pdb|*.rlib|*.rmeta) continue ;;
  esac
  entries+=("$name")
done

tar -czf "$out" -C "$dir" "${entries[@]}"
echo "--- packed ${#entries[@]} entries into $out ---"
printf '%s\n' "${entries[@]}" | sed -n '1,40p'
