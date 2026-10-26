#!/usr/bin/env bash
# Builds oleafly.mcpb, the bundle the MCP Registry entry points at, and the
# server.json that describes it to the registry. Used by
# .github/workflows/mcp-registry.yml; the bundle itself lives in mcpb/.
#
#   scripts/mcpb-release.sh pack VERSION OUT.mcpb
#   scripts/mcpb-release.sh server-json VERSION SHA256 OUT.json
#
# MCPB_VERSION picks the @anthropic-ai/mcpb release that validates and packs.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mcpb_version="${MCPB_VERSION:-2.1.2}"
usage="usage: $0 pack VERSION OUT.mcpb | server-json VERSION SHA256 OUT.json"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

check_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
    || die "not a release version (expected 1.2.3 without the v): $1"
}

pack() {
  local version="$1" out="$2" stage
  check_version "$version"
  stage="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand now: $stage is local to this function
  trap "rm -rf '$stage'" EXIT
  cp -R "$root/mcpb/." "$stage/"
  rm -f "$stage"/server/*.test.cjs
  cp "$root/src-tauri/icons/icon.png" "$stage/icon.png"
  jq --arg version "$version" '.version = $version' "$root/mcpb/manifest.json" \
    > "$stage/manifest.json"
  npx --yes "@anthropic-ai/mcpb@${mcpb_version}" validate "$stage/manifest.json"
  npx --yes "@anthropic-ai/mcpb@${mcpb_version}" pack "$stage" "$out"
}

server_json() {
  local version="$1" sha="$2" out="$3"
  check_version "$version"
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || die "not a lowercase SHA-256: $sha"
  jq --arg version "$version" --arg sha "$sha" \
    --arg url "https://github.com/Oleafly/Oleafly/releases/download/v${version}/oleafly.mcpb" \
    '.version = $version
     | .packages[0].identifier = $url
     | .packages[0].fileSha256 = $sha' \
    "$root/server.json" > "$out"
}

case "${1:-}" in
  pack)
    [[ $# -eq 3 ]] || die "$usage"
    pack "$2" "$3"
    ;;
  server-json)
    [[ $# -eq 4 ]] || die "$usage"
    server_json "$2" "$3" "$4"
    ;;
  *) die "$usage" ;;
esac
