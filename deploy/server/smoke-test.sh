#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: deploy/server/smoke-test.sh <image>}"
max_image_mb="${MAX_IMAGE_MB:-40}"
suffix="$$-$RANDOM"
name="oleafly-smoke-$suffix"
volume="oleafly-smoke-$suffix"
work="$(mktemp -d)"

cleanup() {
  docker rm -f "$name" "$name-refused" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 129' HUP INT TERM PIPE

fail() {
  echo "FAIL: $*" >&2
  if docker container inspect "$name" >/dev/null 2>&1; then
    docker logs "$name" >&2 || true
  fi
  exit 1
}

pass() {
  echo "ok: $*"
}

inspect() {
  docker image inspect --format "$1" "$image"
}

user="$(inspect '{{.Config.User}}')"
uid="${user%%:*}"
case "$uid" in
  "" | 0 | root) fail "the image runs as root (User is '${user}')" ;;
esac
pass "runs as user $user"

platform="${PLATFORM:-$(inspect '{{.Os}}/{{.Architecture}}')}"
pass "platform $platform"

healthcheck="$(inspect '{{json .Config.Healthcheck}}')"
[ "$healthcheck" != "null" ] || fail "the image has no HEALTHCHECK"
pass "HEALTHCHECK $healthcheck"

if docker run --rm --platform "$platform" --entrypoint /bin/sh "$image" -c true >/dev/null 2>&1; then
  fail "the image contains a shell at /bin/sh"
fi
pass "no shell in the image"

docker create --platform "$platform" --name "$name" "$image" >/dev/null
docker export "$name" > "$work/rootfs.tar"
docker rm "$name" >/dev/null
size_bytes="$(wc -c < "$work/rootfs.tar" | tr -d ' ')"
size_mb=$(( (size_bytes + 1048575) / 1048576 ))
[ "$size_mb" -le "$max_image_mb" ] || fail "the image unpacks to ${size_mb} MB, over the ${max_image_mb} MB budget"
pass "the image unpacks to ${size_mb} MB (budget ${max_image_mb} MB)"
tar -tf "$work/rootfs.tar" > "$work/files.txt"
if grep -E '(\.rs$|Cargo\.(toml|lock)$|\.private|(^|/)\.env|\.git/|(^|/)src/[^/]+)' "$work/files.txt" > "$work/leaks.txt"; then
  fail "source or secret-like files in the image: $(tr '\n' ' ' < "$work/leaks.txt")"
fi
pass "no source, .env, .git or .private files among $(wc -l < "$work/files.txt" | tr -d ' ') entries"

mkdir -p "$work/rootfs"
tar -xf "$work/rootfs.tar" -C "$work/rootfs" usr/local/bin/oleafly-server
if grep -a -o -E '/(Users|home)/[A-Za-z0-9._-]+' "$work/rootfs/usr/local/bin/oleafly-server" | sort -u | { grep -v -x -F '/home/web_user' || true; } > "$work/paths.txt" && [ -s "$work/paths.txt" ]; then
  fail "the binary embeds local paths: $(tr '\n' ' ' < "$work/paths.txt")"
fi
pass "the binary embeds no /Users or /home paths"

version="$(docker run --rm --platform "$platform" "$image" --version)"
case "$version" in
  "oleafly-server "*) pass "version: $version" ;;
  *) fail "unexpected --version output: $version" ;;
esac

docker run -d --name "$name-refused" --platform "$platform" \
  -e OLEAFLY_PUBLIC_URL=http://localhost:8080 \
  "$image" >/dev/null
code=""
for _ in $(seq 1 30); do
  if [ "$(docker inspect --format '{{.State.Running}}' "$name-refused")" = "false" ]; then
    code="$(docker inspect --format '{{.State.ExitCode}}' "$name-refused")"
    break
  fi
  sleep 1
done
refusal="$(docker logs "$name-refused" 2>&1)"
docker rm -f "$name-refused" >/dev/null
[ "$code" = "2" ] || fail "with no GitHub or OpenID Connect the server should stop with code 2, not '${code:-still running}': $refusal"
printf '%s' "$refusal" | grep -q 'No sign-in method is set up' || fail "the refusal doesn't say why: $refusal"
pass "the server refuses to start without GitHub or OpenID Connect"

docker volume create "$volume" >/dev/null
docker run -d --name "$name" \
  --platform "$platform" \
  -p 127.0.0.1::8080 \
  -v "$volume:/data" \
  -e OLEAFLY_PUBLIC_URL=http://localhost:8080 \
  -e OLEAFLY_GITHUB_CLIENT_ID=smoke-test \
  -e OLEAFLY_GITHUB_CLIENT_SECRET=smoke-test \
  "$image" >/dev/null

status=""
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$name")"
  [ "$status" = "healthy" ] && break
  [ "$(docker inspect --format '{{.State.Running}}' "$name")" = "true" ] || fail "the container stopped"
  sleep 1
done
[ "$status" = "healthy" ] || fail "the container is '$status', not healthy, after 60 seconds"
pass "Docker reports the container healthy"

port="$(docker port "$name" 8080/tcp | head -n 1 | awk -F: '{ print $NF }')"
base="http://127.0.0.1:$port"

get() {
  curl -fsS --max-time 5 "$base$1"
}

health="$(get /healthz)" || fail "/healthz did not answer 200"
[ "$health" = '{"status":"ok"}' ] || fail "/healthz answered $health"
pass "/healthz $health"

ready="$(get /readyz)" || fail "/readyz did not answer 200"
[ "$ready" = '{"status":"ready"}' ] || fail "/readyz answered $ready"
pass "/readyz $ready"

manifest="$(get /.well-known/oleafly-server)" || fail "/.well-known/oleafly-server did not answer 200"
server_id="$(printf '%s' "$manifest" | grep -o '"server_id":"[^"]*"' | head -n 1)"
[ -n "$server_id" ] || fail "the manifest has no server_id: $manifest"
printf '%s' "$manifest" | grep -q '"needs_setup":true' || fail "a fresh server should need setup: $manifest"
pass "manifest $server_id, needs_setup true"

process_uids="$(docker top "$name" -eo pid,uid | awk 'NR > 1 { print $2 }' | sort -u | tr '\n' ' ')"
[ "$process_uids" = "$uid " ] || fail "processes run as uid(s) '$process_uids', expected $uid"
pass "the server process runs as uid $uid"

docker logs "$name" 2>&1 | grep -q 'Setup code: ' || fail "the log has no Setup code line"
pass "the log prints a setup code"

docker restart "$name" >/dev/null
for _ in $(seq 1 60); do
  [ "$(docker inspect --format '{{.State.Health.Status}}' "$name")" = "healthy" ] && break
  sleep 1
done
port="$(docker port "$name" 8080/tcp | head -n 1 | awk -F: '{ print $NF }')"
base="http://127.0.0.1:$port"
again="$(get /.well-known/oleafly-server | grep -o '"server_id":"[^"]*"' | head -n 1)" || fail "no manifest after a restart"
[ "$again" = "$server_id" ] || fail "the server id changed across a restart: $server_id then $again"
pass "the data volume keeps $server_id across a restart"

echo "PASS: $image"
