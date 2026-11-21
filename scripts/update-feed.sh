#!/usr/bin/env bash
set -euo pipefail

FEED="${1:?usage: update-feed.sh <latest.json>}"
: "${TAG:?TAG is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

MIRROR_URL="${MIRROR_URL:-https://mirrors.oleafly.com}"
MIRROR_R2_BUCKET="${MIRROR_R2_BUCKET:-oleafly-mirror}"
MIRROR_PREFIX="releases/desktop/"
RELEASE_URL="https://github.com/$GITHUB_REPOSITORY/releases/download/$TAG/"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oleafly-update-feed.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

report() {
  local line="$1"
  printf '%s\n' "$line"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n\n' "$line" >>"$GITHUB_STEP_SUMMARY"
  fi
}

warn() {
  local line="$1"
  printf '::warning::%s\n' "$line"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n\n' "$line" >>"$GITHUB_STEP_SUMMARY"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d' ' -f1
  else
    shasum -a 256 | cut -d' ' -f1
  fi
}

r2() {
  AWS_ACCESS_KEY_ID="$MIRROR_R2_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$MIRROR_R2_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION=auto \
    AWS_EC2_METADATA_DISABLED=true \
    aws --endpoint-url "$MIRROR_R2_ENDPOINT" "$@"
}

use_release_addresses() {
  gh release view "$TAG" --repo "$GITHUB_REPOSITORY" --json assets \
    | jq '[.assets[] | {key: .apiUrl, value: .name}] | from_entries' >"$WORK/asset-names.json"
  jq --slurpfile names "$WORK/asset-names.json" --arg base "$RELEASE_URL" '
      .platforms |= with_entries(.value.url |= (
        if startswith("https://api.github.com/") then
          ($names[0][.] // error("latest.json names an asset the release lacks: \(.)"))
          | $base + @uri
        else . end))
    ' "$FEED" >"$WORK/feed.json"
  if jq -e --arg base "$RELEASE_URL" \
    '[.platforms[].url | select(startswith($base) | not)] | length > 0' "$WORK/feed.json" >/dev/null; then
    echo "latest.json has a download address outside $RELEASE_URL:" >&2
    jq -r '.platforms[].url' "$WORK/feed.json" >&2
    exit 1
  fi
  cp "$WORK/feed.json" "$FEED"
}

mirror_settings() {
  local given=0 name
  for name in MIRROR_R2_ACCESS_KEY_ID MIRROR_R2_SECRET_ACCESS_KEY MIRROR_R2_ENDPOINT; do
    if [[ -n "${!name:-}" ]]; then
      given=$((given + 1))
    fi
  done
  case "$given" in
    0) echo none ;;
    3) echo all ;;
    *) echo some ;;
  esac
}

copy_to_mirror() {
  local name file digest key served
  mkdir -p "$WORK/assets" || return 1
  echo '{}' >"$WORK/mirrored.json" || return 1
  while IFS= read -r name; do
    if [[ ! "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
      warn "The update file name \"$name\" is not one the mirror step handles."
      return 1
    fi
    gh release download "$TAG" --repo "$GITHUB_REPOSITORY" -p "$name" -D "$WORK/assets" --clobber \
      || return 1
    file="$WORK/assets/$name"
    [[ -s "$file" ]] || return 1
    digest="$(sha256_of <"$file")"
    key="$MIRROR_PREFIX$TAG/${digest:0:16}/$name"
    r2 s3 cp "$file" "s3://$MIRROR_R2_BUCKET/$key" \
      --content-type application/octet-stream \
      --cache-control "public, max-age=31536000, immutable" \
      --only-show-errors || return 1
    served="$(curl -fsSL --retry 3 --retry-delay 5 "$MIRROR_URL/$key" | sha256_of)" || return 1
    if [[ "$served" != "$digest" ]]; then
      warn "$MIRROR_URL/$key does not serve the bytes that were uploaded."
      return 1
    fi
    jq --arg name "$name" --arg url "$MIRROR_URL/$key" '.[$name] = $url' \
      "$WORK/mirrored.json" >"$WORK/mirrored.next.json" || return 1
    mv "$WORK/mirrored.next.json" "$WORK/mirrored.json" || return 1
    rm -f "$file"
  done < <(jq -r --arg base "$RELEASE_URL" '[.platforms[].url | ltrimstr($base)] | unique | .[]' "$FEED")
  jq --slurpfile mirrored "$WORK/mirrored.json" --arg base "$RELEASE_URL" '
      .platforms |= with_entries(.value |= (
        .url as $original
        | ($mirrored[0][$original | ltrimstr($base)] // error("no mirror copy of \($original)")) as $copy
        | . + {url: $copy, original_url: $original}))
    ' "$FEED" >"$WORK/feed.mirrored.json" || return 1
  cp "$WORK/feed.mirrored.json" "$FEED"
}

mirror_keys() {
  jq -r --arg base "$MIRROR_URL/" --arg prefix "$MIRROR_URL/$MIRROR_PREFIX" \
    '.platforms[].url | select(startswith($prefix)) | ltrimstr($base)' "$1"
}

remove_unlisted_copies() {
  local key
  if ! curl -fsSL --retry 3 --retry-delay 5 \
    "https://github.com/$GITHUB_REPOSITORY/releases/latest/download/latest.json" >"$WORK/live.json" \
    || ! jq -e '.platforms | type == "object"' "$WORK/live.json" >/dev/null 2>&1; then
    warn "Could not read the live update feed, so no older mirror copies were removed."
    return 0
  fi
  { mirror_keys "$FEED"; mirror_keys "$WORK/live.json"; } | sort -u >"$WORK/keep.txt"
  if ! r2 s3api list-objects-v2 --bucket "$MIRROR_R2_BUCKET" --prefix "$MIRROR_PREFIX" \
    --query 'Contents[].Key' --output json >"$WORK/listing.json"; then
    warn "Could not list the mirror, so no older mirror copies were removed."
    return 0
  fi
  while IFS= read -r key; do
    [[ "$key" == "$MIRROR_PREFIX"* ]] || continue
    if grep -qxF -- "$key" "$WORK/keep.txt"; then
      continue
    fi
    if r2 s3 rm "s3://$MIRROR_R2_BUCKET/$key" --only-show-errors; then
      echo "removed older mirror copy: $key"
    else
      warn "Could not remove the older mirror copy $key."
    fi
  done < <(jq -r '(. // [])[]' "$WORK/listing.json")
}

use_release_addresses

case "$(mirror_settings)" in
  some)
    echo "Set MIRROR_R2_ACCESS_KEY_ID, MIRROR_R2_SECRET_ACCESS_KEY and MIRROR_R2_ENDPOINT together, or none of them." >&2
    exit 1
    ;;
  none)
    report "Update feed: downloads come from this release on GitHub. The mirror is not set up."
    ;;
  all)
    if [[ "$TAG" == *-* ]]; then
      report "Update feed: downloads come from this release on GitHub. Pre-releases are not mirrored."
    elif copy_to_mirror; then
      report "Update feed: downloads come from $MIRROR_URL, with this release on GitHub as the second address."
      remove_unlisted_copies || warn "Older mirror copies were not removed."
    else
      warn "The mirror copy failed, so the update feed keeps the GitHub addresses for $TAG."
    fi
    ;;
esac

if ! jq -e --arg release "$RELEASE_URL" --arg mirror "$MIRROR_URL/$MIRROR_PREFIX$TAG/" '
    [.platforms[]
      | if has("original_url")
        then (.url | startswith($mirror)) and (.original_url | startswith($release))
        else .url | startswith($release) end]
    | length > 0 and all
  ' "$FEED" >/dev/null; then
  echo "latest.json has a download address this release does not own:" >&2
  jq -r '.platforms[] | .url, (.original_url // empty)' "$FEED" >&2
  exit 1
fi
if [[ "$(jq '[.platforms[] | has("original_url")] | unique | length' "$FEED")" != 1 ]]; then
  echo "latest.json mixes mirrored and unmirrored platforms." >&2
  exit 1
fi
