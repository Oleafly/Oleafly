#!/bin/sh
set -u

repo=${REPO:-/repo}
workflow=$repo/.github/workflows/release-server.yml
work=$(mktemp -d)
passed=0
failed=0
failures=
status=

if ! python3 -c 'import yaml' 2>/dev/null || ! docker compose version >/dev/null 2>&1 || ! command -v file >/dev/null 2>&1; then
	apt-get update -qq >/dev/null
	DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-yaml docker-compose-v2 file >/dev/null 2>&1
fi

extract() {
	python3 - "$workflow" "$1" >"$2" <<'EOF'
import sys
import yaml

workflow = yaml.safe_load(open(sys.argv[1]))
for job in workflow["jobs"].values():
    for step in job.get("steps", []):
        if step.get("name") == sys.argv[2]:
            sys.stdout.write(step["run"])
            sys.exit(0)
sys.exit(1)
EOF
}

blocks=$work/blocks
mkdir -p "$blocks"
extract "Stamp the installer and Compose files" "$blocks/stamp.sh" || {
	echo "the workflow has no 'Stamp the installer and Compose files' step"
	exit 1
}
extract "Write SHA256SUMS" "$blocks/sums.sh" || {
	echo "the workflow has no 'Write SHA256SUMS' step"
	exit 1
}
extract "Check and package the static binaries" "$blocks/package.sh" || {
	echo "the workflow has no 'Check and package the static binaries' step"
	exit 1
}
extract "Create or update the draft release" "$blocks/draft.sh" || {
	echo "the workflow has no 'Create or update the draft release' step"
	exit 1
}
extract "Test the installer" "$blocks/test.sh" || {
	echo "the workflow has no 'Test the installer' step"
	exit 1
}

workspace() {
	ws=$work/ws
	rm -rf "$ws"
	mkdir -p "$ws/deploy" "$ws/stubs"
	cp -R "$repo/deploy/server" "$ws/deploy/server"
	cp "$repo/LICENSE" "$ws/LICENSE"
}

fake_archives() {
	mkdir -p "$ws/dist/release"
	for triple in x86_64-unknown-linux-musl aarch64-unknown-linux-musl; do
		printf 'archive %s\n' "$triple" >"$ws/dist/release/oleafly-server-$1-$triple.tar.gz"
	done
}

run_block() {
	block=$1
	shift
	(cd "$ws" && env "$@" PATH="$ws/stubs:$PATH" bash "$blocks/$block" >"$work/out" 2>&1)
	status=$?
}

begin() {
	scenario=$1
	scenario_failed=0
	workspace
}

expect() {
	description=$1
	shift
	if ! "$@"; then
		scenario_failed=1
		printf '    expected: %s\n' "$description"
	fi
}

out_has() {
	grep -qF -- "$1" "$work/out"
}

finish() {
	if [ "$scenario_failed" = 0 ]; then
		passed=$((passed + 1))
		printf 'ok   %s\n' "$scenario"
	else
		failed=$((failed + 1))
		failures="$failures
  $scenario"
		printf 'FAIL %s\n' "$scenario"
		sed 's/^/    | /' "$work/out"
	fi
}

image_line() {
	awk '$1 == "image:" && $2 ~ /\/oleafly-server:/ { print $2 }' "$ws/dist/release/docker-compose.yml"
}

emit() {
	workspace
	fake_archives "$2"
	run_block stamp.sh VERSION="$2" IMAGE="$3"
	[ "$status" = 0 ] || {
		cat "$work/out"
		exit 1
	}
	run_block sums.sh
	[ "$status" = 0 ] || {
		cat "$work/out"
		exit 1
	}
	mkdir -p "$1"
	cp "$ws/dist/release/install.sh" "$ws/dist/release/docker-compose.yml" "$ws/dist/release/Caddyfile" \
		"$ws/dist/release/env.example" "$ws/dist/release/litestream.yml" "$ws/dist/release/SHA256SUMS" "$1/"
	cp "$ws/dist/release/"*.tar.gz "$1/"
	echo "release $2 with $3 written to $1"
	rm -rf "$work"
	exit 0
}

if [ "${1:-}" = --emit ]; then
	emit "$2" "$3" "$4"
fi

begin "stamps the installer and Compose files from the repository as it is"
fake_archives 0.1.0
run_block stamp.sh VERSION=0.1.0 IMAGE=ghcr.io/oleafly/oleafly-server
expect "exit 0, got $status" [ "$status" = 0 ]
expect "the installer is stamped once" [ "$(grep -cx 'installer_version=0.1.0' "$ws/dist/release/install.sh")" = 1 ]
expect "no unstamped line is left" [ "$(grep -c 'installer_version=unreleased' "$ws/dist/release/install.sh")" = 0 ]
expect "the installer is otherwise the same" sh -c "diff '$ws/deploy/server/install.sh' '$ws/dist/release/install.sh' | grep -c '^[<>]' | grep -qx 2"
expect "the compose image is the release" [ "$(image_line)" = ghcr.io/oleafly/oleafly-server:0.1.0 ]
expect "caddy keeps its image" grep -q 'image: caddy:2.11.7' "$ws/dist/release/docker-compose.yml"
expect "the compose file has no build section" sh -c "! grep -q 'build:' '$ws/dist/release/docker-compose.yml'"
expect "env.example is .env.example" cmp -s "$ws/deploy/server/.env.example" "$ws/dist/release/env.example"
expect "the Caddyfile is copied" cmp -s "$ws/deploy/server/Caddyfile" "$ws/dist/release/Caddyfile"
expect "litestream.yml is copied" cmp -s "$ws/deploy/server/litestream.yml" "$ws/dist/release/litestream.yml"
expect "the installer is executable" [ "$(stat -c %a "$ws/dist/release/install.sh")" = 755 ]
expect "the other files are 644" [ "$(stat -c %a "$ws/dist/release/env.example")" = 644 ]
expect "the summary names both" out_has 'docker-compose.yml: ghcr.io/oleafly/oleafly-server:0.1.0'
run_block sums.sh
expect "SHA256SUMS is written" [ "$status" = 0 ]
expect "SHA256SUMS has seven lines" [ "$(wc -l <"$ws/dist/release/SHA256SUMS")" = 7 ]
expect "SHA256SUMS lists env.example" grep -q ' env.example$' "$ws/dist/release/SHA256SUMS"
expect "SHA256SUMS checks out" sh -c "cd '$ws/dist/release' && sha256sum -c SHA256SUMS >/dev/null"
finish

begin "stamps a prerelease built from a fork"
run_block stamp.sh VERSION=0.2.0-rc.1 IMAGE=ghcr.io/somefork/oleafly-server
expect "exit 0, got $status" [ "$status" = 0 ]
expect "the fork's image is used" [ "$(image_line)" = ghcr.io/somefork/oleafly-server:0.2.0-rc.1 ]
expect "the installer carries the prerelease" grep -qx 'installer_version=0.2.0-rc.1' "$ws/dist/release/install.sh"
finish

begin "stamps an image line with odd spacing, trailing spaces and a digest"
sed -i 's|^    image: ghcr.io/oleafly/oleafly-server:0.1$|    image:    ghcr.io/oleafly/oleafly-server:0.1@sha256:0123abcd   |' "$ws/deploy/server/docker-compose.yml"
run_block stamp.sh VERSION=0.1.0 IMAGE=ghcr.io/oleafly/oleafly-server
expect "exit 0, got $status" [ "$status" = 0 ]
expect "the whole reference is replaced" [ "$(image_line)" = ghcr.io/oleafly/oleafly-server:0.1.0 ]
finish

begin "refuses a missing installer"
rm "$ws/deploy/server/install.sh"
run_block stamp.sh VERSION=0.1.0 IMAGE=ghcr.io/oleafly/oleafly-server
expect "a failure, got $status" [ "$status" != 0 ]
expect "the file is named" out_has '::error file=deploy/server/install.sh::missing or empty'
finish

begin "refuses an empty .env.example"
: >"$ws/deploy/server/.env.example"
run_block stamp.sh VERSION=0.1.0 IMAGE=ghcr.io/oleafly/oleafly-server
expect "a failure, got $status" [ "$status" != 0 ]
expect "the file is named" out_has '::error file=deploy/server/.env.example::missing or empty'
finish

begin "refuses an installer without the version line"
sed -i '/^installer_version=unreleased$/d' "$ws/deploy/server/install.sh"
run_block stamp.sh VERSION=0.1.0 IMAGE=ghcr.io/oleafly/oleafly-server
expect "a failure, got $status" [ "$status" != 0 ]
expect "the line is named" out_has "expected exactly one line 'installer_version=unreleased'"
finish

begin "refuses a compose file without the server image"
sed -i 's|ghcr.io/oleafly/oleafly-server:0.1|example.org/other:1|' "$ws/deploy/server/docker-compose.yml"
run_block stamp.sh VERSION=0.1.0 IMAGE=ghcr.io/oleafly/oleafly-server
expect "a failure, got $status" [ "$status" != 0 ]
expect "the problem is named" out_has "expected one oleafly-server image line to become ghcr.io/oleafly/oleafly-server:0.1.0, got ''"
finish

begin "refuses a compose file with two server images"
printf '  extra:\n    image: ghcr.io/oleafly/oleafly-server:0.1\n' >>"$ws/deploy/server/docker-compose.yml"
run_block stamp.sh VERSION=0.1.0 IMAGE=ghcr.io/oleafly/oleafly-server
expect "a failure, got $status" [ "$status" != 0 ]
expect "the problem is named" out_has 'expected one oleafly-server image line'
finish

begin "refuses a compose file Docker Compose can't read"
printf 'services:\n  broken: [\n' >>"$ws/deploy/server/docker-compose.yml"
run_block stamp.sh VERSION=0.1.0 IMAGE=ghcr.io/oleafly/oleafly-server
expect "a failure, got $status" [ "$status" != 0 ]
finish

begin "SHA256SUMS fails when there are no archives"
run_block stamp.sh VERSION=0.1.0 IMAGE=ghcr.io/oleafly/oleafly-server
run_block sums.sh
expect "a failure, got $status" [ "$status" != 0 ]
finish

begin "packages static binaries and leaves SHA256SUMS to the next step"
mkdir -p "$ws/dist/binaries/linux_amd64" "$ws/dist/binaries/linux_arm64"
for platform in linux_amd64 linux_arm64; do
	printf '#!/bin/sh\necho "oleafly-server 0.1.0"\n' >"$ws/dist/binaries/$platform/oleafly-server"
done
printf '#!/bin/sh\necho "ELF 64-bit LSB executable, static-pie linked, stripped"\n' >"$ws/stubs/file"
chmod 755 "$ws/stubs/file"
run_block package.sh VERSION=0.1.0
expect "exit 0, got $status" [ "$status" = 0 ]
expect "the amd64 archive exists" [ -f "$ws/dist/release/oleafly-server-0.1.0-x86_64-unknown-linux-musl.tar.gz" ]
expect "the arm64 archive exists" [ -f "$ws/dist/release/oleafly-server-0.1.0-aarch64-unknown-linux-musl.tar.gz" ]
expect "no SHA256SUMS yet" [ ! -f "$ws/dist/release/SHA256SUMS" ]
rm -rf "$ws/dist"
mkdir -p "$ws/dist/binaries"
run_block package.sh VERSION=0.1.0
expect "missing binaries fail" [ "$status" != 0 ]
expect "the missing binary is named" out_has '::error::missing dist/binaries/linux_amd64/oleafly-server'
finish

gh_stub() {
	cat >"$ws/stubs/gh" <<'EOF'
#!/bin/sh
printf 'gh %s\n' "$*" >>"$GH_LOG"
case "$1 $2" in
	"release view") [ -f "$GH_STATE/exists" ] ;;
	"release create")
		while [ $# -gt 0 ]; do
			if [ "$1" = --notes-file ]; then
				cp "$2" "$GH_STATE/notes"
			fi
			shift
		done
		touch "$GH_STATE/exists"
		;;
	"release upload")
		shift 3
		for file in "$@"; do
			case $file in
				--*) break ;;
			esac
			[ -f "$file" ] || {
				echo "open $file: no such file or directory" >&2
				exit 1
			}
			basename "$file" >>"$GH_STATE/uploaded"
		done
		;;
esac
EOF
	chmod 755 "$ws/stubs/gh"
	mkdir -p "$ws/gh"
	: >"$ws/gh/log"
}

begin "the draft release gets notes with the install command and every file"
gh_stub
mkdir -p "$ws/archives"
for file in install.sh docker-compose.yml Caddyfile env.example litestream.yml SHA256SUMS oleafly-server-0.1.0-x86_64-unknown-linux-musl.tar.gz; do
	echo "$file" >"$ws/archives/$file"
done
run_block draft.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" GH_TOKEN=token TAG=server-v0.1.0 VERSION=0.1.0 GITHUB_REPOSITORY=Oleafly/Oleafly GITHUB_REPOSITORY_OWNER=Oleafly
expect "exit 0, got $status" [ "$status" = 0 ]
expect "a draft is created" grep -q 'gh release create server-v0.1.0 --repo Oleafly/Oleafly --draft --verify-tag' "$ws/gh/log"
expect "the notes have the install command" grep -qxF 'curl -fsSL https://oleafly.com/server/install.sh | sudo sh' "$ws/gh/notes"
expect "the notes name the image in lower case" grep -qF 'ghcr.io/oleafly/oleafly-server:0.1.0' "$ws/gh/notes"
expect "the notes avoid semicolons" sh -c "! grep -q ';' '$ws/gh/notes'"
expect "every file is uploaded" [ "$(sort "$ws/gh/uploaded" | paste -sd ' ' -)" = 'Caddyfile SHA256SUMS docker-compose.yml env.example install.sh litestream.yml oleafly-server-0.1.0-x86_64-unknown-linux-musl.tar.gz' ]
: >"$ws/gh/log"
: >"$ws/gh/uploaded"
run_block draft.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" GH_TOKEN=token TAG=server-v0.1.0 VERSION=0.1.0 GITHUB_REPOSITORY=Oleafly/Oleafly GITHUB_REPOSITORY_OWNER=Oleafly
expect "a second run only uploads" sh -c "! grep -q 'release create' '$ws/gh/log'"
expect "a second run uploads again" [ -s "$ws/gh/uploaded" ]
finish

begin "the draft release fails when there is nothing to upload"
gh_stub
mkdir -p "$ws/archives"
run_block draft.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" GH_TOKEN=token TAG=server-v0.1.0 VERSION=0.1.0 GITHUB_REPOSITORY=Oleafly/Oleafly GITHUB_REPOSITORY_OWNER=Oleafly
expect "a failure, got $status" [ "$status" != 0 ]
finish

begin "the installer test step runs shellcheck and the container tests"
expect "shellcheck covers the installer and its tests" grep -qF 'shellcheck --shell=sh install.sh tests/*.sh tests/stubs/*' "$blocks/test.sh"
expect "the tests run in ubuntu:24.04 for amd64" grep -q 'docker run --rm --platform linux/amd64 .* ubuntu:24.04 sh /src/tests/installer-test.sh' "$blocks/test.sh"
expect "the tests run under bash too" grep -q 'INSTALLER_SHELL=bash' "$blocks/test.sh"
finish

rm -rf "$work"
printf '\n%s passed, %s failed\n' "$passed" "$failed"
if [ "$failed" -gt 0 ]; then
	printf 'Failed:%s\n' "$failures"
	exit 1
fi
