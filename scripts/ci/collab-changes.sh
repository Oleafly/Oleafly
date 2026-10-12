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

pattern='^(crates/oleafly-collab|crates/oleafly-server/|src-tauri/src/collab/|src/features/collab/|src/components/collab/|src/lib/collab-|e2e/tests/[^/]*-peer\.spec\.ts$|scripts/e2e-collab-browser\.sh$|scripts/ci/collab-changes\.sh$|\.github/workflows/ci\.yml$)'

if grep -Eq "$pattern" <<<"$changed"; then
  run true
fi
run false
