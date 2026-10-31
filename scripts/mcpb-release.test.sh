#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/oleafly-mcpb-release-test.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

fail() {
  local message="$1"
  printf 'mcpb-release.test.sh: %s\n' "$message" >&2
  exit 1
}

mkdir -p "$SCRATCH/bin"
cat >"$SCRATCH/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$NPX_LOG"
if [[ "$3" == "pack" ]]; then
  cp -R "$4" "$NPX_STAGE_COPY"
  printf 'bundle' >"$5"
fi
EOF
chmod +x "$SCRATCH/bin/npx"
export NPX_LOG="$SCRATCH/npx.log"
export NPX_STAGE_COPY="$SCRATCH/staged"

PATH="$SCRATCH/bin:$PATH" bash "$ROOT/scripts/mcpb-release.sh" pack 1.2.3 "$SCRATCH/out.mcpb" \
  || fail "pack failed"

[[ "$(cat "$SCRATCH/out.mcpb")" == bundle ]] || fail "pack did not write the bundle"
grep -qx -- "--yes @anthropic-ai/mcpb@2.1.2 validate .*/manifest.json" "$NPX_LOG" \
  || fail "manifest was not validated: $(cat "$NPX_LOG")"
[[ "$(jq -r .version "$NPX_STAGE_COPY/manifest.json")" == 1.2.3 ]] \
  || fail "the staged manifest does not carry the release version"
[[ "$(jq -r .version "$ROOT/mcpb/manifest.json")" != 1.2.3 ]] \
  || fail "pack must not edit the committed manifest"
[[ -f "$NPX_STAGE_COPY/icon.png" ]] || fail "the icon is missing from the bundle"
[[ -f "$NPX_STAGE_COPY/server/index.cjs" ]] || fail "the launcher is missing from the bundle"
if compgen -G "$NPX_STAGE_COPY/server/*.test.cjs" >/dev/null; then
  fail "tests must not ship in the bundle"
fi

if PATH="$SCRATCH/bin:$PATH" bash "$ROOT/scripts/mcpb-release.sh" pack v1.2.3 "$SCRATCH/x.mcpb" 2>/dev/null; then
  fail "a tag (v1.2.3) was accepted as a version"
fi

sha="$(printf 'a%.0s' {1..64})"
bash "$ROOT/scripts/mcpb-release.sh" server-json 1.2.3 "$sha" "$SCRATCH/server.json" \
  || fail "server-json failed"
[[ "$(jq -r .version "$SCRATCH/server.json")" == 1.2.3 ]] || fail "server.json version"
[[ "$(jq -r '.packages[0].identifier' "$SCRATCH/server.json")" \
  == https://github.com/Oleafly/Oleafly/releases/download/v1.2.3/oleafly.mcpb ]] \
  || fail "server.json identifier"
[[ "$(jq -r '.packages[0].fileSha256' "$SCRATCH/server.json")" == "$sha" ]] || fail "server.json sha"
[[ "$(jq -r .name "$SCRATCH/server.json")" == io.github.Oleafly/oleafly ]] || fail "server.json name"

if bash "$ROOT/scripts/mcpb-release.sh" server-json 1.2.3 ABC "$SCRATCH/bad.json" 2>/dev/null; then
  fail "a malformed SHA-256 was accepted"
fi
if bash "$ROOT/scripts/mcpb-release.sh" 2>/dev/null; then
  fail "running without a command should fail"
fi

echo "mcpb-release.test.sh: ok"
