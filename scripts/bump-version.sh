#!/usr/bin/env bash
#
# Set the Oleafly version in one place so a release tag never drifts from the
# manifests. Updates all four spots that carry the version:
#
#   - package.json            ("version")
#   - src-tauri/tauri.conf.json ("version")
#   - src-tauri/Cargo.toml     ([package] version)
#   - src-tauri/Cargo.lock     (the openleaf package entry)
#
# Usage:
#   ./scripts/bump-version.sh 0.2.0
#   ./scripts/bump-version.sh v0.2.0   # a leading "v" is stripped
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$#" -ne 1 ]]; then
  echo "usage: $0 <version>   (e.g. 0.2.0)" >&2
  exit 1
fi

# Strip a leading "v" so both `0.2.0` and `v0.2.0` work.
VERSION="${1#v}"

# Basic semver check (major.minor.patch with an optional -prerelease/+build tail).
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+.][0-9A-Za-z.-]+)?$ ]]; then
  echo "error: '$VERSION' is not a valid semver version (e.g. 0.2.0)" >&2
  exit 1
fi

pkg="$ROOT/package.json"
conf="$ROOT/src-tauri/tauri.conf.json"
cargo="$ROOT/src-tauri/Cargo.toml"
lock="$ROOT/src-tauri/Cargo.lock"

for f in "$pkg" "$conf" "$cargo"; do
  [[ -f "$f" ]] || { echo "error: missing $f" >&2; exit 1; }
done

# package.json / tauri.conf.json: the first top-level "version" field. Slurp
# mode + a non-global substitution replaces only that first occurrence.
perl -0pi -e 's/("version"\s*:\s*")[^"]*(")/${1}'"$VERSION"'${2}/' "$pkg"
perl -0pi -e 's/("version"\s*:\s*")[^"]*(")/${1}'"$VERSION"'${2}/' "$conf"

# Cargo.toml: only the line-anchored [package] `version = "..."`. Dependency
# versions like `serde = { version = "1" }` are indented/inline, so they never
# match `^version = `.
perl -pi -e 'if (!$seen && /^version = "/) { s/^version = "[^"]*"/version = "'"$VERSION"'"/; $seen = 1 }' "$cargo"

# Cargo.lock: the version line immediately under the openleaf package entry.
if [[ -f "$lock" ]]; then
  perl -0pi -e 's/(name = "openleaf"\nversion = ")[^"]*(")/${1}'"$VERSION"'${2}/' "$lock"
fi

echo "Set version to $VERSION in:"
echo "  - package.json"
echo "  - src-tauri/tauri.conf.json"
echo "  - src-tauri/Cargo.toml"
[[ -f "$lock" ]] && echo "  - src-tauri/Cargo.lock"
echo
echo "Next steps:"
echo "  git commit -am \"chore: release v$VERSION\""
echo "  git tag v$VERSION && git push origin v$VERSION   # triggers the Release workflow"
