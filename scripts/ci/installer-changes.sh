#!/usr/bin/env bash
set -uo pipefail

event="${1:-}"
base="${2:-}"
head="${3:-HEAD}"

run() {
  echo "run=$1"
  exit 0
}

case "$event" in
  pull_request | push) ;;
  *) run true ;;
esac

if [[ -z "$base" || "$base" =~ ^0+$ ]]; then
  run true
fi

if ! git cat-file -e "$base^{commit}" 2>/dev/null \
  && ! git fetch --quiet --no-tags --depth=1 origin "$base" 2>/dev/null; then
  run true
fi

if ! changed="$(git diff --name-only "$base" "$head" 2>/dev/null)"; then
  run true
fi

pattern='^(src-tauri/windows/|src-tauri/src/system_integration|src-tauri/tauri(\.e2e)?\.conf\.json$|scripts/windows-installer-check\.ps1$|scripts/ci/(installer-changes|unpack-windows-e2e-app)\.sh$|\.github/workflows/ci\.yml$|package\.json$)'

if grep -Eq "$pattern" <<<"$changed"; then
  run true
fi
run false
