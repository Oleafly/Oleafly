#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/ci/installer-changes.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oleafly-installer-changes.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

failures=0

git_in() {
  git -C "$1" -c user.name=ci -c user.email=ci@example.invalid -c commit.gpgsign=false "${@:2}"
}

origin="$WORK/origin"
mkdir -p "$origin/src-tauri/windows" "$origin/src"
git init --quiet "$origin"
git_in "$origin" config uploadpack.allowAnySHA1InWant true
printf 'x\n' >"$origin/src/app.ts"
printf 'x\n' >"$origin/src-tauri/windows/hooks.nsh"
git_in "$origin" add -- src src-tauri
git_in "$origin" commit --quiet -m base
base="$(git_in "$origin" rev-parse HEAD)"

commit_change() {
  local path="$1"
  git_in "$origin" checkout --quiet "$base"
  mkdir -p "$origin/$(dirname "$path")"
  printf '%s\n' "$RANDOM" >>"$origin/$path"
  git_in "$origin" add -- "$path"
  git_in "$origin" commit --quiet -m "change $path"
  git_in "$origin" rev-parse HEAD
}

expect() {
  local name="$1" want="$2" dir="$3"
  shift 3
  local got
  got="$(cd "$dir" && bash "$CHECK" "$@" 2>"$WORK/$name.err")" || got="exit $?"
  if [[ "$got" == "run=$want" ]]; then
    echo "ok   $name -> $got"
  else
    echo "FAIL $name: expected run=$want, got '$got'" >&2
    sed 's/^/     /' "$WORK/$name.err" >&2
    failures=$((failures + 1))
  fi
}

shallow() {
  local name="$1" head="$2"
  local dir="$WORK/$name"
  git clone --quiet --no-local --depth=1 "file://$origin" "$dir" 2>/dev/null
  git_in "$dir" fetch --quiet --depth=1 origin "$head"
  git_in "$dir" checkout --quiet "$head"
  echo "$dir"
}

for path in \
  src-tauri/windows/explorer-menu.wxs \
  src-tauri/windows/hooks.nsh \
  src-tauri/src/system_integration/explorer_menu.rs \
  src-tauri/tauri.conf.json \
  src-tauri/tauri.e2e.conf.json \
  scripts/windows-installer-check.ps1 \
  scripts/ci/installer-changes.sh \
  scripts/ci/unpack-windows-e2e-app.sh \
  .github/workflows/ci.yml \
  package.json; do
  head="$(commit_change "$path")"
  name="pr-$(printf '%s' "$path" | tr '/.' '--')"
  dir="$(shallow "$name" "$head")"
  expect "$name" true "$dir" pull_request "$base" "$head"
done

for path in src/app.ts src-tauri/src/project.rs e2e/tests/21-library.spec.ts README.md src-tauri/tauri.conf.json.bak; do
  head="$(commit_change "$path")"
  name="pr-other-$(printf '%s' "$path" | tr '/.' '--')"
  dir="$(shallow "$name" "$head")"
  expect "$name" false "$dir" pull_request "$base" "$head"
  expect "push-other-$name" false "$dir" push "$base" "$head"
done

dir="$WORK/pr-other-src-app-ts"
expect schedule true "$dir" schedule "" HEAD
expect workflow-dispatch true "$dir" workflow_dispatch "" HEAD
expect empty-event true "$dir" "" "" HEAD
expect missing-base true "$dir" pull_request "" HEAD
expect new-branch-push true "$dir" push 0000000000000000000000000000000000000000 HEAD
expect unknown-base true "$dir" pull_request 1234567890123456789012345678901234567890 HEAD
expect not-a-repo true "$WORK" pull_request "$base" HEAD

if ((failures > 0)); then
  echo "$failures installer change check(s) failed" >&2
  exit 1
fi
echo "all installer change checks passed"
