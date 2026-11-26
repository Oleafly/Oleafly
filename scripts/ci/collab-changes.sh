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

pattern='^(crates/oleafly-collab|crates/oleafly-live/|crates/oleafly-ot/|crates/oleafly-net/|crates/oleafly-server/|src-tauri/src/collab/|src/features/collab/|src/components/collab/|src/lib/collab-|src/lib/tauri\.ts$|src/lib/tauri-collab\.ts$|packages/editor/src/(collaboration|document-session)\.|src/components/editor/cm/editor-slots\.|src/components/editor/wysiwyg/|src/components/notes/|src/components/layout/Collab|e2e/tests/[^/]*-peer\.spec\.ts$|e2e/helpers\.ts$|e2e/rich-editor\.ts$|crates/oleafly-online/src/browser_signin/|crates/oleafly-online/examples/fake_browser\.rs$|crates/oleafly-online/tests/browser_signin\.rs$|src-tauri/src/overleaf/signin\.rs$|src/components/settings/browser-sign-in/|e2e/tests/[^/]*-browser-sign-in\.spec\.ts$|scripts/e2e-collab-browser\.sh$|scripts/ci/collab-changes\.sh$|\.github/workflows/ci\.yml$)'

if grep -Eq "$pattern" <<<"$changed"; then
  run true
fi
run false
