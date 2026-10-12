#!/usr/bin/env bash

e2e_needs_collab_peer() {
  case "${1:-}" in
    *-peer.spec.ts | *-peer.spec.ts:*) return 0 ;;
    *) return 1 ;;
  esac
}

e2e_launch_seed_for() {
  local live="0"
  if e2e_needs_collab_peer "${1:-}"; then
    live="1"
  fi
  printf '{"oleafly.dictionary.locale":"en_US","oleafly.spellcheck":"1","oleafly.harper":"1","oleafly.liveCollaboration":"%s"}' "$live"
}
