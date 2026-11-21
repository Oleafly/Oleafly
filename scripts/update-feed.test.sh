#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/oleafly-update-feed-test.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

fail() {
  local message="$1"
  printf 'update-feed.test.sh: %s\n' "$message" >&2
  exit 1
}

digest_of() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum <"$file" | cut -d' ' -f1
  else
    shasum -a 256 <"$file" | cut -d' ' -f1
  fi
}

mkdir -p "$SCRATCH/bin" "$SCRATCH/release"

cat >"$SCRATCH/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$GH_LOG"
case "$1 $2" in
  "release view")
    cat "$GH_ASSETS"
    ;;
  "release download")
    name=""
    directory=""
    shift 3
    while (($#)); do
      case "$1" in
        -p) name="$2"; shift 2 ;;
        -D) directory="$2"; shift 2 ;;
        --repo) shift 2 ;;
        *) shift ;;
      esac
    done
    [[ -f "$GH_FILES/$name" ]] || exit 1
    mkdir -p "$directory"
    cp "$GH_FILES/$name" "$directory/$name"
    ;;
  *)
    exit 1
    ;;
esac
EOF

cat >"$SCRATCH/bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$AWS_LOG"
[[ "$1" == --endpoint-url && "$2" == https://account.r2.test ]] || exit 9
[[ "${AWS_ACCESS_KEY_ID:-}" == key-id && "${AWS_SECRET_ACCESS_KEY:-}" == key-secret ]] || exit 9
shift 2
case "$1 $2" in
  "s3 cp")
    [[ -z "${AWS_FAIL_UPLOAD:-}" ]] || exit 1
    key="${4#s3://oleafly-mirror/}"
    [[ "$key" != "$4" ]] || exit 9
    mkdir -p "$BUCKET/$(dirname "$key")"
    cp "$3" "$BUCKET/$key"
    ;;
  "s3 rm")
    key="${3#s3://oleafly-mirror/}"
    [[ "$key" != "$3" ]] || exit 9
    rm -f "$BUCKET/$key"
    ;;
  "s3api list-objects-v2")
    [[ -z "${AWS_FAIL_LIST:-}" ]] || exit 1
    prefix=""
    while (($#)); do
      case "$1" in
        --prefix) prefix="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    (cd "$BUCKET" && find . -type f | sed 's#^\./##' | sort) \
      | jq -R . | jq -s --arg prefix "$prefix" \
        'map(select(startswith($prefix))) | if length == 0 then null else . end'
    ;;
  *)
    exit 9
    ;;
esac
EOF

cat >"$SCRATCH/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${!#}"
printf '%s\n' "$url" >>"$CURL_LOG"
printf '%s\n' "$*" >>"$CURL_ARGUMENTS"
case "$url" in
  https://mirror.test/*)
    key="${url#https://mirror.test/}"
    [[ -f "$BUCKET/$key" ]] || exit 22
    if [[ -n "${MIRROR_CORRUPT:-}" ]]; then
      printf 'not the upload'
    else
      cat "$BUCKET/$key"
    fi
    ;;
  https://github.com/Oleafly/Oleafly/releases/latest/download/latest.json)
    [[ -n "${LIVE_FEED:-}" && -f "$LIVE_FEED" ]] || exit 22
    cat "$LIVE_FEED"
    ;;
  *)
    exit 22
    ;;
esac
EOF
chmod +x "$SCRATCH/bin/gh" "$SCRATCH/bin/aws" "$SCRATCH/bin/curl"

printf 'mac archive' >"$SCRATCH/release/Oleafly_9.9.9_aarch64.app.tar.gz"
printf 'windows installer' >"$SCRATCH/release/Oleafly_9.9.9_x64-setup.exe"
MAC_DIGEST="$(digest_of "$SCRATCH/release/Oleafly_9.9.9_aarch64.app.tar.gz")"
WINDOWS_DIGEST="$(digest_of "$SCRATCH/release/Oleafly_9.9.9_x64-setup.exe")"
MAC_KEY="releases/desktop/v9.9.9/${MAC_DIGEST:0:16}/Oleafly_9.9.9_aarch64.app.tar.gz"
WINDOWS_KEY="releases/desktop/v9.9.9/${WINDOWS_DIGEST:0:16}/Oleafly_9.9.9_x64-setup.exe"
RELEASE="https://github.com/Oleafly/Oleafly/releases/download/v9.9.9"

cat >"$SCRATCH/assets.json" <<'EOF'
{"assets":[
  {"apiUrl":"https://api.github.com/repos/Oleafly/Oleafly/releases/assets/11","name":"Oleafly_9.9.9_aarch64.app.tar.gz"},
  {"apiUrl":"https://api.github.com/repos/Oleafly/Oleafly/releases/assets/12","name":"Oleafly_9.9.9_x64-setup.exe"},
  {"apiUrl":"https://api.github.com/repos/Oleafly/Oleafly/releases/assets/13","name":"latest.json"}
]}
EOF

write_feed() {
  cat >"$SCRATCH/latest.json" <<'EOF'
{
  "version": "9.9.9",
  "notes": "Notes",
  "pub_date": "2026-11-20T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {"signature": "mac-signature", "url": "https://api.github.com/repos/Oleafly/Oleafly/releases/assets/11"},
    "darwin-aarch64-app": {"signature": "mac-signature", "url": "https://api.github.com/repos/Oleafly/Oleafly/releases/assets/11"},
    "windows-x86_64": {"signature": "windows-signature", "url": "https://api.github.com/repos/Oleafly/Oleafly/releases/assets/12"}
  }
}
EOF
}

reset() {
  rm -rf "$SCRATCH/bucket" "$SCRATCH/out.txt"
  mkdir -p "$SCRATCH/bucket"
  : >"$SCRATCH/gh.log"
  : >"$SCRATCH/aws.log"
  : >"$SCRATCH/curl.log"
  : >"$SCRATCH/curl-arguments.log"
  : >"$SCRATCH/summary.md"
  write_feed
}

update_feed() {
  env PATH="$SCRATCH/bin:$PATH" \
    GH_LOG="$SCRATCH/gh.log" GH_ASSETS="$SCRATCH/assets.json" GH_FILES="$SCRATCH/release" \
    AWS_LOG="$SCRATCH/aws.log" CURL_LOG="$SCRATCH/curl.log" BUCKET="$SCRATCH/bucket" \
    CURL_ARGUMENTS="$SCRATCH/curl-arguments.log" \
    GITHUB_REPOSITORY=Oleafly/Oleafly GITHUB_STEP_SUMMARY="$SCRATCH/summary.md" \
    MIRROR_URL=https://mirror.test TAG="${TAG:-v9.9.9}" "$@" \
    bash "$ROOT/scripts/update-feed.sh" "$SCRATCH/latest.json" >"$SCRATCH/out.txt" 2>&1
}

with_mirror() {
  update_feed MIRROR_R2_ACCESS_KEY_ID=key-id MIRROR_R2_SECRET_ACCESS_KEY=key-secret \
    MIRROR_R2_ENDPOINT=https://account.r2.test "$@"
}

field() {
  local filter="$1"
  jq -r "$filter" "$SCRATCH/latest.json"
}

MAC_URL='.platforms["darwin-aarch64"].url'
WINDOWS_URL='.platforms["windows-x86_64"].url'

expect_release_addresses() {
  local context="$1"
  [[ "$(field "$MAC_URL")" == "$RELEASE/Oleafly_9.9.9_aarch64.app.tar.gz" ]] \
    || fail "$context: the Mac address is $(field "$MAC_URL")"
  [[ "$(field "$WINDOWS_URL")" == "$RELEASE/Oleafly_9.9.9_x64-setup.exe" ]] \
    || fail "$context: the Windows address is $(field "$WINDOWS_URL")"
  [[ "$(field '[.platforms[] | has("original_url")] | any')" == false ]] \
    || fail "$context: an unmirrored feed names a second address"
}

reset
update_feed || fail "the feed without a mirror failed: $(cat "$SCRATCH/out.txt")"
expect_release_addresses "no mirror"
[[ "$(field '.platforms["darwin-aarch64-app"].signature')" == mac-signature ]] \
  || fail "no mirror: a signature changed"
[[ "$(field '[.version, .notes, .pub_date] | join("|")')" == "9.9.9|Notes|2026-11-20T00:00:00Z" ]] \
  || fail "no mirror: the release details changed"
[[ ! -s "$SCRATCH/aws.log" ]] || fail "no mirror: the bucket was contacted"
grep -q "The mirror is not set up" "$SCRATCH/summary.md" || fail "no mirror: the summary does not say so"

reset
jq '.platforms["windows-x86_64"].url = "https://api.github.com/repos/Oleafly/Oleafly/releases/assets/99"' \
  "$SCRATCH/latest.json" >"$SCRATCH/unknown.json"
mv "$SCRATCH/unknown.json" "$SCRATCH/latest.json"
if update_feed; then
  fail "an asset the release lacks was accepted"
fi
grep -q "names an asset the release lacks" "$SCRATCH/out.txt" || fail "the unknown asset is not named"
[[ "$(field "$WINDOWS_URL")" == *"/assets/99" ]] \
  || fail "a rejected feed was still rewritten"

reset
jq '.platforms["windows-x86_64"].url = "https://downloads.invalid/Oleafly.exe"' \
  "$SCRATCH/latest.json" >"$SCRATCH/foreign.json"
mv "$SCRATCH/foreign.json" "$SCRATCH/latest.json"
if update_feed; then
  fail "a download address outside the release was accepted"
fi

reset
if update_feed MIRROR_R2_ACCESS_KEY_ID=key-id; then
  fail "half a mirror configuration was accepted"
fi
grep -q "together, or none of them" "$SCRATCH/out.txt" || fail "the missing mirror settings are not named"

reset
mkdir -p "$SCRATCH/bucket/releases/desktop/v9.9.7/aaaa" "$SCRATCH/bucket/releases/desktop/v9.9.8/bbbb" \
  "$SCRATCH/bucket/releases/desktop/v9.9.9/stale" "$SCRATCH/bucket/fonts"
printf 'older' >"$SCRATCH/bucket/releases/desktop/v9.9.7/aaaa/Oleafly_9.9.7_x64-setup.exe"
printf 'previous' >"$SCRATCH/bucket/releases/desktop/v9.9.8/bbbb/Oleafly_9.9.8_x64-setup.exe"
printf 'earlier build' >"$SCRATCH/bucket/releases/desktop/v9.9.9/stale/Oleafly_9.9.9_x64-setup.exe"
printf 'font' >"$SCRATCH/bucket/fonts/Lato-Regular.ttf"
cat >"$SCRATCH/live.json" <<'EOF'
{"version":"9.9.8","platforms":{"windows-x86_64":{"signature":"s","url":"https://mirror.test/releases/desktop/v9.9.8/bbbb/Oleafly_9.9.8_x64-setup.exe","original_url":"https://github.com/Oleafly/Oleafly/releases/download/v9.9.8/Oleafly_9.9.8_x64-setup.exe"}}}
EOF
with_mirror LIVE_FEED="$SCRATCH/live.json" || fail "the mirrored feed failed: $(cat "$SCRATCH/out.txt")"
[[ "$(field "$MAC_URL")" == "https://mirror.test/$MAC_KEY" ]] \
  || fail "mirror: the Mac address is $(field "$MAC_URL")"
[[ "$(field '.platforms["darwin-aarch64-app"].url')" == "https://mirror.test/$MAC_KEY" ]] \
  || fail "mirror: the Mac app address is $(field '.platforms["darwin-aarch64-app"].url')"
[[ "$(field "$WINDOWS_URL")" == "https://mirror.test/$WINDOWS_KEY" ]] \
  || fail "mirror: the Windows address is $(field "$WINDOWS_URL")"
[[ "$(field '.platforms["darwin-aarch64"].original_url')" == "$RELEASE/Oleafly_9.9.9_aarch64.app.tar.gz" ]] \
  || fail "mirror: the Mac second address is $(field '.platforms["darwin-aarch64"].original_url')"
[[ "$(field '.platforms["windows-x86_64"].original_url')" == "$RELEASE/Oleafly_9.9.9_x64-setup.exe" ]] \
  || fail "mirror: the Windows second address is $(field '.platforms["windows-x86_64"].original_url')"
[[ "$(field '.platforms["windows-x86_64"].signature')" == windows-signature ]] \
  || fail "mirror: a signature changed"
cmp -s "$SCRATCH/bucket/$MAC_KEY" "$SCRATCH/release/Oleafly_9.9.9_aarch64.app.tar.gz" \
  || fail "mirror: the Mac archive was not uploaded intact"
cmp -s "$SCRATCH/bucket/$WINDOWS_KEY" "$SCRATCH/release/Oleafly_9.9.9_x64-setup.exe" \
  || fail "mirror: the Windows installer was not uploaded intact"
[[ "$(grep -c '^--endpoint-url https://account.r2.test s3 cp ' "$SCRATCH/aws.log")" == 2 ]] \
  || fail "mirror: each file should be uploaded once: $(cat "$SCRATCH/aws.log")"
grep -q "cache-control public, max-age=31536000, immutable" "$SCRATCH/aws.log" \
  || fail "mirror: uploads are not marked as unchanging"
grep -qx "https://mirror.test/$MAC_KEY" "$SCRATCH/curl.log" || fail "mirror: the Mac copy was not read back"
grep -qx "https://mirror.test/$WINDOWS_KEY" "$SCRATCH/curl.log" \
  || fail "mirror: the Windows copy was not read back"
[[ -f "$SCRATCH/bucket/releases/desktop/v9.9.8/bbbb/Oleafly_9.9.8_x64-setup.exe" ]] \
  || fail "mirror: a file the live feed points at was removed"
[[ ! -e "$SCRATCH/bucket/releases/desktop/v9.9.7/aaaa/Oleafly_9.9.7_x64-setup.exe" ]] \
  || fail "mirror: a copy no feed points at was kept"
[[ ! -e "$SCRATCH/bucket/releases/desktop/v9.9.9/stale/Oleafly_9.9.9_x64-setup.exe" ]] \
  || fail "mirror: an earlier build of this release was kept"
[[ -f "$SCRATCH/bucket/fonts/Lato-Regular.ttf" ]] || fail "mirror: a file outside the release folder was removed"
grep -q "downloads come from https://mirror.test" "$SCRATCH/summary.md" \
  || fail "mirror: the summary does not name the mirror"
[[ -s "$SCRATCH/curl-arguments.log" ]] || fail "mirror: nothing was downloaded"
if grep -qv -- "--proto =https --tlsv1.2" "$SCRATCH/curl-arguments.log"; then
  fail "mirror: a download could follow a redirect to plain HTTP: $(cat "$SCRATCH/curl-arguments.log")"
fi

cp "$SCRATCH/latest.json" "$SCRATCH/first.json"
write_feed
with_mirror LIVE_FEED="$SCRATCH/live.json" || fail "a second run failed: $(cat "$SCRATCH/out.txt")"
cmp -s "$SCRATCH/latest.json" "$SCRATCH/first.json" || fail "a second run produced a different feed"

reset
with_mirror MIRROR_CORRUPT=1 LIVE_FEED="$SCRATCH/live.json" \
  || fail "a mirror that serves other bytes failed the release: $(cat "$SCRATCH/out.txt")"
expect_release_addresses "wrong bytes"
grep -q "::warning::.*does not serve the bytes that were uploaded" "$SCRATCH/out.txt" \
  || fail "wrong bytes: no warning"
grep -q "keeps the GitHub addresses for v9.9.9" "$SCRATCH/summary.md" \
  || fail "wrong bytes: the summary does not say the mirror was skipped"
if grep -q " s3 rm " "$SCRATCH/aws.log"; then
  fail "wrong bytes: copies were removed after a failed mirror run"
fi

reset
with_mirror AWS_FAIL_UPLOAD=1 || fail "a failed upload failed the release: $(cat "$SCRATCH/out.txt")"
expect_release_addresses "failed upload"
grep -q "::warning::The mirror copy failed" "$SCRATCH/out.txt" || fail "failed upload: no warning"

reset
rm -f "$SCRATCH/keep-release"
mv "$SCRATCH/release/Oleafly_9.9.9_x64-setup.exe" "$SCRATCH/keep-release"
with_mirror || fail "a missing release file failed the release: $(cat "$SCRATCH/out.txt")"
mv "$SCRATCH/keep-release" "$SCRATCH/release/Oleafly_9.9.9_x64-setup.exe"
expect_release_addresses "missing release file"

reset
mkdir -p "$SCRATCH/bucket/releases/desktop/v9.9.7/aaaa"
printf 'older' >"$SCRATCH/bucket/releases/desktop/v9.9.7/aaaa/Oleafly_9.9.7_x64-setup.exe"
with_mirror || fail "an unreadable live feed failed the release: $(cat "$SCRATCH/out.txt")"
[[ "$(field "$WINDOWS_URL")" == "https://mirror.test/$WINDOWS_KEY" ]] \
  || fail "unreadable live feed: the release was not mirrored"
[[ -f "$SCRATCH/bucket/releases/desktop/v9.9.7/aaaa/Oleafly_9.9.7_x64-setup.exe" ]] \
  || fail "unreadable live feed: a copy was removed without knowing what the live feed needs"
grep -q "::warning::Could not read the live update feed" "$SCRATCH/out.txt" \
  || fail "unreadable live feed: no warning"

reset
mkdir -p "$SCRATCH/bucket/releases/desktop/v9.9.7/aaaa"
printf 'older' >"$SCRATCH/bucket/releases/desktop/v9.9.7/aaaa/Oleafly_9.9.7_x64-setup.exe"
with_mirror AWS_FAIL_LIST=1 LIVE_FEED="$SCRATCH/live.json" \
  || fail "an unlistable bucket failed the release: $(cat "$SCRATCH/out.txt")"
[[ "$(field "$WINDOWS_URL")" == "https://mirror.test/$WINDOWS_KEY" ]] \
  || fail "unlistable bucket: the release was not mirrored"
[[ -f "$SCRATCH/bucket/releases/desktop/v9.9.7/aaaa/Oleafly_9.9.7_x64-setup.exe" ]] \
  || fail "unlistable bucket: a copy was removed"

reset
sed 's/9\.9\.9/9.9.9-rc.1/g' "$SCRATCH/assets.json" >"$SCRATCH/assets.rc.json"
cp "$SCRATCH/release/Oleafly_9.9.9_x64-setup.exe" "$SCRATCH/release/Oleafly_9.9.9-rc.1_x64-setup.exe"
TAG=v9.9.9-rc.1 with_mirror GH_ASSETS="$SCRATCH/assets.rc.json" \
  || fail "a pre-release failed: $(cat "$SCRATCH/out.txt")"
[[ "$(field "$WINDOWS_URL")" \
  == "https://github.com/Oleafly/Oleafly/releases/download/v9.9.9-rc.1/Oleafly_9.9.9-rc.1_x64-setup.exe" ]] \
  || fail "pre-release: the Windows address is $(field "$WINDOWS_URL")"
[[ ! -s "$SCRATCH/aws.log" ]] || fail "pre-release: the bucket was contacted"
grep -q "Pre-releases are not mirrored" "$SCRATCH/summary.md" || fail "pre-release: the summary does not say so"

echo "update-feed.test.sh: ok"
