#!/bin/sh
# Checks how deploy/server/tests/e2e.sh cleans up on a Linux runner. There,
# Docker runs containers as root, so what they write into a bind mount
# belongs to root, and the user who started e2e.sh can't delete it. e2e.sh
# has to remove those files anyway and keep its own exit status, so that a
# passing end-to-end run passes the step.
#
# It runs e2e.sh as the user nobody against stubs/e2e-docker, with a helper
# running as root doing each container's work. Run it as root on Linux:
#   docker run --rm --platform linux/amd64 -v "$PWD/deploy/server:/src:ro" ubuntu:24.04 sh /src/tests/e2e-cleanup-test.sh
set -u

here=$(cd "$(dirname "$0")" && pwd)
if [ "$(id -u)" != 0 ]; then
	echo "Run this as root, for example in an ubuntu:24.04 container."
	exit 1
fi

home=$(mktemp -d /tmp/oleafly-e2e-cleanup.XXXXXX)
chmod 755 "$home"
mkdir -p "$home/repo/deploy/server/tests" "$home/bin"
cp "$here/e2e.sh" "$here/lib.sh" "$here/e2e-inside.sh" "$home/repo/deploy/server/tests/"
cp "$here/stubs/e2e-docker" "$home/bin/docker"
chmod 755 "$home/bin/docker"
install -d -o 65534 -g 65534 "$home/requests" "$home/tmp"
install -m 644 -o 65534 -g 65534 /dev/null "$home/docker.log"
out=$home/out
passed=0
failed=0
status=

# The root helper: it runs what the stub asks for, the way rootful Docker
# runs a container's command on the host's files.
(
	while [ ! -e "$home/stop" ]; do
		for request in "$home"/requests/*.sh; do
			[ -e "$request" ] || continue
			sh "$request" >/dev/null 2>&1
			echo "$?" >"${request%.sh}.status"
			mv "${request%.sh}.status" "${request%.sh}.done"
			rm -f "$request"
		done
		sleep 0.05
	done
) &
helper=$!

run_e2e() {
	setpriv --reuid=65534 --regid=65534 --clear-groups \
		env -i PATH="$home/bin:/usr/bin:/bin" TMPDIR="$home/tmp" E2E_STUB="$home" "$@" \
		sh "$home/repo/deploy/server/tests/e2e.sh" oleafly-server:ci-amd64 >"$out" 2>&1
	status=$?
}

check() {
	description=$1
	shift
	if "$@"; then
		passed=$((passed + 1))
		printf 'ok   %s\n' "$description"
	else
		failed=$((failed + 1))
		printf 'FAIL %s\n' "$description"
		sed 's/^/    | /' "$out"
	fi
}

nothing_left() {
	[ -z "$(find "$home/tmp" -mindepth 1 -maxdepth 1)" ]
}

run_e2e
check "a passing run exits 0, got $status" [ "$status" = 0 ]
check "a passing run leaves nothing behind" nothing_left
check "a container removes what the root containers wrote" grep -q ':/work ubuntu:24.04 rm -rf /work/e2e$' "$home/docker.log"

run_e2e E2E_STUB_BOX_STATUS=3
check "a failing run keeps its exit status, got $status" [ "$status" = 3 ]
check "a failing run leaves nothing behind" nothing_left

run_e2e E2E_STUB_CLEANUP=fails
check "a run whose cleanup can't remove root's files still exits 0, got $status" [ "$status" = 0 ]
check "it says how to remove what's left" grep -qF 'Remove it with: sudo rm -rf' "$out"

touch "$home/stop"
wait "$helper"
rm -rf "$home"
printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" = 0 ]
