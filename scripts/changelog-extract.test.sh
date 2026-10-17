#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/oleafly-changelog-extract-test.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

fail() {
  local message="$1"
  printf 'changelog-extract.test.sh: %s\n' "$message" >&2
  exit 1
}

cat >"$SCRATCH/CHANGELOG.md" <<'EOF'
# Changelog

## [1.2.0] - 2026-10-20

### Thanks

- Someone tested it.

<details>
<summary>What each of them did</summary>

**Someone** tested it twice.

</details>

### Fixed

- A bug.

```text
kept


as is
```

## [1.1.0] - 2026-10-01

<details open>
<summary> Older notes </summary>

- An older bug.
</details>
EOF

extract() {
  local version="$1"
  OLEAFLY_CHANGELOG="$SCRATCH/CHANGELOG.md" bash "$ROOT/scripts/changelog-extract.sh" "$version"
}

expected="$(cat <<'EOF'
### Thanks

- Someone tested it.

**What each of them did**

**Someone** tested it twice.

### Fixed

- A bug.

```text
kept


as is
```
EOF
)"
[[ "$(extract v1.2.0)" == "$expected" ]] || fail "1.2.0 notes differ: $(extract v1.2.0)"

older="$(printf '%s\n' '**Older notes**' '' '- An older bug.')"
[[ "$(extract 1.1.0)" == "$older" ]] || fail "1.1.0 notes differ: $(extract 1.1.0)"

[[ "$(extract 9.9.9)" == "See the changelog: https://github.com/Oleafly/Oleafly/blob/main/CHANGELOG.md" ]] ||
  fail "a missing version should point to the changelog"

real="$(bash "$ROOT/scripts/changelog-extract.sh" Unreleased)"
case "$real" in
  *"<details"* | *"</details>"* | *"<summary>"*) fail "the release notes still carry details markup" ;;
esac
