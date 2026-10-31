#!/bin/sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
image=${1:?usage: deploy/server/tests/e2e.sh <local linux/amd64 oleafly-server image>}
suffix=$$
registry=oleafly-e2e-registry-$suffix
box=oleafly-e2e-box-$suffix
docker_volume=oleafly-e2e-docker-$suffix
work=$(mktemp -d "${TMPDIR:-/tmp}/oleafly-e2e.XXXXXX")

cleanup() {
	docker rm -f "$box" "$registry" >/dev/null 2>&1 || true
	docker volume rm "$docker_volume" >/dev/null 2>&1 || true
	# The containers run as root, and with Docker on Linux what they wrote
	# into $work/e2e belongs to root, so this user can't delete it. A
	# container removes it first.
	docker run --rm --pull never --platform linux/amd64 -v "$work:/work" ubuntu:24.04 rm -rf /work/e2e >/dev/null 2>&1 || true
	rm -rf "$work" >/dev/null 2>&1 || true
	if [ -e "$work" ]; then
		echo "Couldn't remove $work. Remove it with: sudo rm -rf $work" >&2 || true
	fi
}
main() {
	trap 'cleanup' EXIT
	trap 'exit 130' INT TERM
	mkdir -p "$work/e2e"
	echo "== Building release files with the workflow's own steps"
	docker run --rm --platform linux/amd64 -v "$repo:/repo:ro" -v "$work/e2e:/out" ubuntu:24.04 sh -c '
		for version in 0.1.0 0.1.1; do
			sh /repo/deploy/server/tests/release-workflow-test.sh --emit "/out/release-$version" "$version" localhost:5000/oleafly/oleafly-server || exit 1
		done
	'
	mkdir -p "$work/e2e/tests"
	cp "$here/lib.sh" "$work/e2e/tests/lib.sh"
	cp "$here/e2e-inside.sh" "$work/e2e/e2e-inside.sh"

	echo "== Serving $image from a local registry as 0.1.0 and 0.1.1"
	docker run -d --name "$registry" registry:2.8.3 >/dev/null
	tries=0
	until docker run --rm --network "container:$registry" gcr.io/go-containerregistry/crane:v0.20.3 catalog --insecure localhost:5000 >/dev/null 2>&1; do
		tries=$((tries + 1))
		[ "$tries" -lt 30 ] || {
			echo "the registry didn't start"
			return 1
		}
		sleep 1
	done
	docker save "$image" -o "$work/server.tar"
	chmod 755 "$work"
	chmod 644 "$work/server.tar"
	for version in 0.1.0 0.1.1; do
		docker run --rm --network "container:$registry" -v "$work:/work:ro" gcr.io/go-containerregistry/crane:v0.20.3 \
			push --insecure /work/server.tar "localhost:5000/oleafly/oleafly-server:$version"
	done
	rm -f "$work/server.tar"

	echo "== Running the installer in a privileged ubuntu:24.04 linux/amd64 machine"
	docker volume create "$docker_volume" >/dev/null
	set +e
	docker run --name "$box" --privileged --platform linux/amd64 --network "container:$registry" \
		-v "$docker_volume:/var/lib/docker" -v "$work/e2e:/e2e" \
		ubuntu:24.04 sh /e2e/e2e-inside.sh
	status=$?
	set -e
	return "$status"
}

main "$@"
