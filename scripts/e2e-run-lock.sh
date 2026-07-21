#!/usr/bin/env bash

e2e_lock_dir="${OLEAFLY_E2E_LOCK_DIR:-/tmp/oleafly-e2e-bridge.lock}"
e2e_recovery_dir="${e2e_lock_dir}.recovery"

acquire_e2e_lock() {
  local attempt owner
  for attempt in 1 2 3; do
    if [ -d "$e2e_recovery_dir" ]; then
      sleep 1
      continue
    fi
    if mkdir "$e2e_lock_dir" 2>/dev/null; then
      printf '%s\n' "$$" >"$e2e_lock_dir/owner"
      return 0
    fi
    owner="$(sed -n '1p' "$e2e_lock_dir/owner" 2>/dev/null || true)"
    if [[ -z "$owner" ]]; then
      sleep 1
      continue
    fi
    if [[ "$owner" =~ ^[0-9]+$ ]] && kill -0 "$owner" 2>/dev/null; then
      echo "e2e: another runner owns the app and bridge (pid $owner)" >&2
      return 1
    fi
    if [[ -n "$owner" ]] && [[ ! "$owner" =~ ^[0-9]+$ ]]; then
      echo "e2e: runner lock has an invalid owner: $e2e_lock_dir" >&2
      return 1
    fi
    if mkdir "$e2e_recovery_dir" 2>/dev/null; then
      owner="$(sed -n '1p' "$e2e_lock_dir/owner" 2>/dev/null || true)"
      if [[ "$owner" =~ ^[0-9]+$ ]] && kill -0 "$owner" 2>/dev/null; then
        rmdir "$e2e_recovery_dir" 2>/dev/null || true
        echo "e2e: another runner owns the app and bridge (pid $owner)" >&2
        return 1
      fi
      rm -f "$e2e_lock_dir/owner" 2>/dev/null || true
      rmdir "$e2e_lock_dir" 2>/dev/null || true
      if mkdir "$e2e_lock_dir" 2>/dev/null; then
        printf '%s\n' "$$" >"$e2e_lock_dir/owner"
        rmdir "$e2e_recovery_dir" 2>/dev/null || true
        return 0
      fi
      rmdir "$e2e_recovery_dir" 2>/dev/null || true
    fi
    sleep 1
  done
  echo "e2e: could not acquire runner lock: $e2e_lock_dir" >&2
  return 1
}

e2e_descendants() {
  local parent="$1" child
  while read -r child; do
    [[ "$child" =~ ^[0-9]+$ ]] || continue
    printf '%s\n' "$child"
    e2e_descendants "$child"
  done < <(pgrep -P "$parent" 2>/dev/null || true)
}

terminate_e2e_tree() {
  local parent="$1" child descendants="" attempt remaining=""
  for attempt in 1 2 3; do
    while read -r child; do
      [[ "$child" =~ ^[0-9]+$ ]] || continue
      descendants="$descendants $child"
      kill -TERM "$child" 2>/dev/null || true
    done < <(e2e_descendants "$parent")
    kill -TERM "$parent" 2>/dev/null || true
    sleep 1
    kill -0 "$parent" 2>/dev/null || break
  done
  while read -r child; do
    [[ "$child" =~ ^[0-9]+$ ]] || continue
    remaining="$remaining $child"
  done < <(e2e_descendants "$parent")
  for child in $descendants $remaining $parent; do
    kill -KILL "$child" 2>/dev/null || true
  done
}

release_e2e_lock() {
  local owner
  owner="$(sed -n '1p' "$e2e_lock_dir/owner" 2>/dev/null || true)"
  if [[ "$owner" == "$$" ]]; then
    rm -f "$e2e_lock_dir/owner" 2>/dev/null || true
    rmdir "$e2e_lock_dir" 2>/dev/null || true
  fi
}

e2e_socket_identity() {
  local path="$1"
  if stat -f '%d:%i' "$path" >/dev/null 2>&1; then
    stat -f '%d:%i' "$path"
  else
    stat -c '%d:%i' "$path" 2>/dev/null
  fi
}

remove_owned_e2e_socket() {
  local path="$1" expected="$2" current
  [ -n "$expected" ] || return 0
  [ -S "$path" ] || return 0
  current="$(e2e_socket_identity "$path" 2>/dev/null || true)"
  if [ "$current" = "$expected" ]; then
    rm -f "$path"
  fi
}
