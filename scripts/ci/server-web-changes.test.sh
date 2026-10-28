#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/ci/server-web-changes.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oleafly-server-web-changes.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

failures=0

git_in() {
  local repo="$1"
  shift
  git -C "$repo" -c user.name=ci -c user.email=ci@example.invalid -c commit.gpgsign=false "$@"
}

origin="$WORK/origin"
mkdir -p "$origin/src" "$origin/crates/oleafly-collab/src"
git init --quiet "$origin"
git_in "$origin" config uploadpack.allowAnySHA1InWant true
printf 'x\n' >"$origin/src/app.ts"
printf 'x\n' >"$origin/crates/oleafly-collab/src/lib.rs"
git_in "$origin" add -- src crates
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
  crates/oleafly-server/src/web/room.rs \
  crates/oleafly-server/Cargo.toml \
  crates/oleafly-server/migrations/0018_web_sessions.sql \
  crates/oleafly-collab/src/suggestions.rs \
  crates/oleafly-collab-protocol/src/page.rs \
  crates/oleafly-s3/src/lib.rs \
  web/src/controller.ts \
  web/index.html \
  Cargo.lock \
  Cargo.toml \
  rust-toolchain.toml \
  scripts/ci/server-web-changes.sh \
  .github/workflows/ci.yml; do
  head="$(commit_change "$path")"
  name="pr-$(printf '%s' "$path" | tr '/.' '--')"
  dir="$(shallow "$name" "$head")"
  expect "$name" true "$dir" pull_request "$base" "$head"
done

for path in \
  src/app.ts \
  src/features/collab/sharing/ShareDialog.tsx \
  src/lib/tauri.ts \
  src-tauri/src/collab/live.rs \
  src-tauri/Cargo.toml \
  crates/oleafly-core/src/lib.rs \
  packages/editor/src/view.ts \
  webapp/notes.md \
  e2e/tests/21-library.spec.ts \
  scripts/ci/collab-changes.sh \
  package.json \
  README.md; do
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
  echo "$failures server web change check(s) failed" >&2
  exit 1
fi
echo "all server web change checks passed"
