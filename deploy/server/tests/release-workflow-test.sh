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
extract "Work out the version and image tags" "$blocks/version.sh" || {
	echo "the workflow has no 'Work out the version and image tags' step"
	exit 1
}
extract "Check that the image can be pulled without signing in" "$blocks/public.sh" || {
	echo "the workflow has no 'Check that the image can be pulled without signing in' step"
	exit 1
}
extract "Point the minor and latest tags at this release" "$blocks/promote.sh" || {
	echo "the workflow has no 'Point the minor and latest tags at this release' step"
	exit 1
}
extract "Start the copy and wait for the installer to see it" "$blocks/sync.sh" || {
	echo "the workflow has no 'Start the copy and wait for the installer to see it' step"
	exit 1
}

workspace() {
	ws=$work/ws
	rm -rf "$ws"
	mkdir -p "$ws/deploy" "$ws/stubs" "$ws/crates/oleafly-server"
	cp -R "$repo/deploy/server" "$ws/deploy/server"
	cp "$repo/LICENSE" "$ws/LICENSE"
	cp "$repo/rust-toolchain.toml" "$ws/rust-toolchain.toml"
	cp "$repo/crates/oleafly-server/Cargo.toml" "$repo/crates/oleafly-server/Dockerfile" "$ws/crates/oleafly-server/"
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
# Dependabot moves Caddy's tag, so read it from the repository's file.
caddy_pin=$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(caddy:[^[:space:]]*\).*$/\1/p' "$ws/deploy/server/docker-compose.yml" | head -n 1)
expect "the repository's compose file names a Caddy image" [ -n "$caddy_pin" ]
expect "caddy keeps its image" grep -qF "image: $caddy_pin" "$ws/dist/release/docker-compose.yml"
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
expect "this test runs too" grep -q 'docker run --rm --platform linux/amd64 .* ubuntu:24.04 sh /repo/deploy/server/tests/release-workflow-test.sh' "$blocks/test.sh"
expect "the end-to-end cleanup test runs too" grep -q 'docker run --rm --platform linux/amd64 .* ubuntu:24.04 sh /src/tests/e2e-cleanup-test.sh' "$blocks/test.sh"
finish

begin "pull requests run the installer end to end against the image they built"
python3 - "$workflow" >"$work/out" 2>&1 <<'EOF'
import sys
import yaml

steps = yaml.safe_load(open(sys.argv[1]))["jobs"]["build"]["steps"]
names = [step.get("name") for step in steps]
problems = []
if "Run the installer end to end" not in names:
    problems.append("the build job has no end-to-end installer step")
else:
    step = steps[names.index("Run the installer end to end")]
    if step.get("if") != "github.event_name == 'pull_request'":
        problems.append("the end-to-end step doesn't run on pull requests only")
    if "deploy/server/tests/e2e.sh oleafly-server:ci-amd64" not in step.get("run", ""):
        problems.append("the end-to-end step doesn't test the amd64 image the job built")
    if names.index("Run the installer end to end") < names.index("Build the amd64 image"):
        problems.append("the end-to-end step runs before the amd64 image is built")
for problem in problems:
    print(problem)
sys.exit(1 if problems else 0)
EOF
status=$?
expect "the workflow passes the end-to-end checks, got $status" [ "$status" = 0 ]
finish

begin "pull requests get a read-only token, and every action is pinned"
python3 - "$workflow" >"$work/out" 2>&1 <<'EOF'
import re
import sys
import yaml

workflow = yaml.safe_load(open(sys.argv[1]))
jobs = workflow["jobs"]
problems = []
if workflow.get("permissions") != {"contents": "read"}:
    problems.append("the workflow default is not contents: read")
if jobs["build"].get("permissions") != {"contents": "read"}:
    problems.append("the build job, which pull requests run, has more than contents: read")
for name, job in jobs.items():
    writes = [scope for scope, level in (job.get("permissions") or {}).items() if level == "write"]
    if writes and "publish == 'true'" not in str(job.get("if", "")) and "github.event_name == 'release'" not in str(job.get("if", "")):
        problems.append(f"{name} can write {writes} without being limited to tags, manual runs or published releases")
    for step in job.get("steps", []):
        uses = step.get("uses")
        if uses and not uses.startswith("./") and not re.fullmatch(r"[^@]+@[0-9a-f]{40}", uses):
            problems.append(f"{name} uses {uses}, which is not pinned by commit")
        if uses and uses.startswith("actions/checkout@") and (step.get("with") or {}).get("persist-credentials") is not False:
            problems.append(f"{name} leaves the token in .git/config")
for name in ("publish", "draft"):
    if "publish == 'true'" not in str(jobs[name].get("if", "")):
        problems.append(f"{name} isn't limited to server tags and manual runs")
for problem in problems:
    print(problem)
sys.exit(1 if problems else 0)
EOF
status=$?
expect "the workflow passes the permission and pinning checks, got $status" [ "$status" = 0 ]
finish

begin "a server tag pushes only the exact version, and a pull request pushes nothing"
run_block version.sh EVENT=push REF=server-v0.1.0 OWNER=Oleafly DOCKERFILE=crates/oleafly-server/Dockerfile GITHUB_OUTPUT="$ws/output"
version_line=$(sed -n 's/^version[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' "$ws/crates/oleafly-server/Cargo.toml" | head -n 1)
if [ "$version_line" = 0.1.0 ]; then
	expect "exit 0, got $status" [ "$status" = 0 ]
	expect "it publishes" grep -qx 'publish=true' "$ws/output"
	expect "the image is named in lower case" grep -qx 'image=ghcr.io/oleafly/oleafly-server' "$ws/output"
	expect "the exact tag is listed" out_has 'ghcr.io/oleafly/oleafly-server:0.1.0'
	expect "no minor tag is listed" sh -c "! grep -q 'oleafly-server:0.1\$' '$work/out' '$ws/output'"
	expect "no latest tag is listed" sh -c "! grep -q ':latest' '$work/out' '$ws/output'"
else
	expect "the tag matches the crate version $version_line" [ "$status" != 0 ]
fi
rm -f "$ws/output"
run_block version.sh EVENT=pull_request REF=280/merge OWNER=Oleafly DOCKERFILE=crates/oleafly-server/Dockerfile GITHUB_OUTPUT="$ws/output"
expect "a pull request run passes, got $status" [ "$status" = 0 ]
expect "a pull request doesn't publish" grep -qx 'publish=false' "$ws/output"
rm -f "$ws/output"
run_block version.sh EVENT=push REF=server-v9.9.9 OWNER=Oleafly DOCKERFILE=crates/oleafly-server/Dockerfile GITHUB_OUTPUT="$ws/output"
expect "a tag that doesn't match the crate fails" [ "$status" != 0 ]
expect "the mismatch is named" out_has 'the tag server-v9.9.9 says 9.9.9'
finish

docker_stub() {
	cat >"$ws/stubs/docker" <<'EOF'
#!/bin/sh
printf 'docker %s\n' "$*" >>"$DOCKER_LOG"
case "$1 $2 $3" in
	"logout "*) exit 0 ;;
	"buildx imagetools inspect")
		if [ -f "$DOCKER_STATE/private" ]; then
			echo 'ERROR: failed to authorize: failed to fetch anonymous token: unexpected status: 401 Unauthorized' >&2
			exit 1
		fi
		left=$(cat "$DOCKER_STATE/flaky" 2>/dev/null || echo 0)
		if [ "$left" -gt 0 ]; then
			echo $((left - 1)) >"$DOCKER_STATE/flaky"
			echo 'ERROR: failed to do request: Head "https://ghcr.io/v2/oleafly/oleafly-server/manifests/0.1.0": dial tcp: lookup ghcr.io: i/o timeout' >&2
			exit 1
		fi
		case "$*" in
			*--format*) printf 'sha256:%064d\n' 7 ;;
		esac
		;;
	"buildx imagetools create") ;;
	*) exit 1 ;;
esac
EOF
	cat >"$ws/stubs/sleep" <<'EOF'
#!/bin/sh
echo "sleep $*" >>"$DOCKER_LOG"
EOF
	chmod 755 "$ws/stubs/docker" "$ws/stubs/sleep"
	mkdir -p "$ws/docker"
	: >"$ws/docker/log"
}

public_check() {
	: >"$ws/docker/log"
	run_block public.sh DOCKER_LOG="$ws/docker/log" DOCKER_STATE="$ws/docker" IMAGE=ghcr.io/oleafly/oleafly-server VERSION=0.1.0
}

begin "the draft waits until anyone can pull the image, and says how to allow it"
docker_stub
touch "$ws/docker/private"
public_check
expect "a private image fails, got $status" [ "$status" != 0 ]
expect "the image is named" out_has '::error::ghcr.io/oleafly/oleafly-server:0.1.0 can'"'"'t be pulled without signing in'
expect "the fix is named" out_has 'Make it public in the organization'"'"'s Packages settings'
expect "Docker's own message is shown" out_has '401 Unauthorized'
expect "it checks without the run's token" grep -q '^docker logout ghcr.io' "$ws/docker/log"
expect "it tries three times" [ "$(grep -c 'imagetools inspect' "$ws/docker/log")" = 3 ]
expect "it waits between tries" [ "$(grep -c '^sleep 10$' "$ws/docker/log")" = 2 ]
rm -f "$ws/docker/private"
public_check
expect "a public image passes, got $status" [ "$status" = 0 ]
finish

begin "a registry that doesn't answer at first isn't blamed on the package settings"
docker_stub
echo 2 >"$ws/docker/flaky"
public_check
expect "the third try passes, got $status" [ "$status" = 0 ]
echo 5 >"$ws/docker/flaky"
public_check
expect "three failed tries fail, got $status" [ "$status" != 0 ]
expect "Docker's own message is shown" out_has 'lookup ghcr.io: i/o timeout'
expect "it says to try again" out_has 'Re-run this job once the registry answers.'
expect "it doesn't say the package is private" sh -c "! grep -q 'Make it public' '$work/out'"
finish

begin "promote runs one at a time, and tag builds keep their layers for publish"
python3 - "$workflow" >"$work/out" 2>&1 <<'EOF'
import sys
import yaml

jobs = yaml.safe_load(open(sys.argv[1]))["jobs"]
problems = []
if jobs["promote"].get("concurrency") != {"group": "release-server-promote", "cancel-in-progress": False}:
    problems.append("promote doesn't run one at a time in release-server-promote")
steps = {step.get("name"): step.get("with") or {} for job in jobs.values() for step in job.get("steps", [])}
for platform in ("amd64", "arm64"):
    cache_to = str(steps[f"Build the {platform} image"].get("cache-to", ""))
    if "github.event_name != 'pull_request'" not in cache_to or f"scope=release-server-{platform}" not in cache_to or "ignore-error=true" not in cache_to:
        problems.append(f"the {platform} build doesn't keep its layers for publish, or writes them for pull requests")
cache_from = str(steps["Push the multi-arch image with an SBOM and provenance"].get("cache-from", ""))
for platform in ("amd64", "arm64"):
    if f"type=gha,scope=release-server-{platform}" not in cache_from:
        problems.append(f"publish doesn't read the {platform} layers")
for problem in problems:
    print(problem)
sys.exit(1 if problems else 0)
EOF
status=$?
expect "the workflow passes the concurrency and cache checks, got $status" [ "$status" = 0 ]
finish

promote() {
	: >"$ws/docker/log"
	run_block promote.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" DOCKER_LOG="$ws/docker/log" DOCKER_STATE="$ws/docker" \
		GH_TOKEN=token GITHUB_REPOSITORY=Oleafly/Oleafly OWNER=Oleafly TAG="$1" PRERELEASE="$2"
}

begin "publishing moves the minor and latest tags only forward"
gh_stub
docker_stub
cat >>"$ws/stubs/gh" <<'EOF'
case "$1 $2" in
	"release list") cat "$GH_STATE/releases" ;;
esac
EOF
digest=sha256:0000000000000000000000000000000000000000000000000000000000000007
printf 'server-v0.1.0\nserver-v0.1.1\nv0.5.0\n' >"$ws/gh/releases"
promote server-v0.1.1 false
expect "exit 0, got $status" [ "$status" = 0 ]
expect "the newest release moves both tags" grep -qxF "docker buildx imagetools create -t ghcr.io/oleafly/oleafly-server:0.1 -t ghcr.io/oleafly/oleafly-server:latest ghcr.io/oleafly/oleafly-server@$digest" "$ws/docker/log"
printf 'server-v0.1.5\nserver-v0.2.0\n' >"$ws/gh/releases"
promote server-v0.1.5 false
expect "exit 0, got $status" [ "$status" = 0 ]
expect "a fix for an older minor moves only its minor tag" grep -qxF "docker buildx imagetools create -t ghcr.io/oleafly/oleafly-server:0.1 ghcr.io/oleafly/oleafly-server@$digest" "$ws/docker/log"
expect "it says why latest stays" out_has 'ghcr.io/oleafly/oleafly-server:latest stays on 0.2.0'
printf 'server-v0.1.4\nserver-v0.1.10\nserver-v0.2.0\n' >"$ws/gh/releases"
promote server-v0.1.4 false
expect "exit 0, got $status" [ "$status" = 0 ]
expect "an older release moves nothing" sh -c "! grep -q 'imagetools create' '$ws/docker/log'"
expect "0.1.10 counts as newer than 0.1.4" out_has 'ghcr.io/oleafly/oleafly-server:0.1 stays on 0.1.10'
promote server-v0.2.0-rc.1 true
expect "exit 0, got $status" [ "$status" = 0 ]
expect "a prerelease moves nothing" sh -c "! grep -q 'imagetools' '$ws/docker/log'"
finish

sync_stubs() {
	gh_stub
	cat >>"$ws/stubs/gh" <<'EOF'
case "$1 $2" in
	"workflow run")
		if [ -f "$GH_STATE/run-fails" ]; then
			echo 'HTTP 403: Resource not accessible by personal access token' >&2
			exit 1
		fi
		touch "$GH_STATE/started"
		;;
esac
EOF
	cat >"$ws/stubs/curl" <<'EOF'
#!/bin/sh
printf 'curl %s\n' "$*" >>"$GH_LOG"
for arg in "$@"; do url=$arg; done
case $url in
	*/releases/download/*/SHA256SUMS) [ -f "$GH_STATE/started" ] && [ ! -f "$GH_STATE/copy-fails" ] || exit 22 ;;
	*/releases/latest) printf 'https://github.com/Oleafly/oleafly-server/releases/tag/%s' "$(cat "$GH_STATE/latest")" ;;
	*) exit 6 ;;
esac
EOF
	cat >"$ws/stubs/sleep" <<'EOF'
#!/bin/sh
echo "sleep $*" >>"$GH_LOG"
EOF
	chmod 755 "$ws/stubs/curl" "$ws/stubs/sleep"
}

begin "publishing copies the release to Oleafly/oleafly-server and waits for it"
sync_stubs
echo server-v0.1.1 >"$ws/gh/latest"
run_block sync.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" GH_TOKEN=token TAG=server-v0.1.1
expect "exit 0, got $status" [ "$status" = 0 ]
expect "the copy is started for the tag" grep -qxF 'gh workflow run sync-release.yml --repo Oleafly/oleafly-server -f tag=server-v0.1.1' "$ws/gh/log"
expect "it waits for SHA256SUMS" grep -q 'releases/download/server-v0.1.1/SHA256SUMS' "$ws/gh/log"
expect "it says the installer gets it" out_has 'so the one-command install and update get it'
echo server-v0.2.0 >"$ws/gh/latest"
run_block sync.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" GH_TOKEN=token TAG=server-v0.1.1
expect "an older release still passes, got $status" [ "$status" = 0 ]
expect "it says the installer keeps the newer one" out_has 'is server-v0.2.0, not server-v0.1.1'
finish

begin "the copy fails loudly when it can't run or doesn't arrive"
sync_stubs
run_block sync.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" GH_TOKEN= TAG=server-v0.1.1
expect "a missing token fails, got $status" [ "$status" != 0 ]
expect "the secret and the manual command are named" out_has 'OLEAFLY_SERVER_SYNC_TOKEN secret isn'"'"'t set'
expect "the manual command is shown" out_has 'gh workflow run sync-release.yml --repo Oleafly/oleafly-server -f tag=server-v0.1.1'
touch "$ws/gh/run-fails"
run_block sync.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" GH_TOKEN=token TAG=server-v0.1.1
expect "a copy that can't start fails, got $status" [ "$status" != 0 ]
expect "it says the copy didn't start" out_has "Couldn't start sync-release.yml in Oleafly/oleafly-server"
expect "it shows the manual command" out_has 'copy the release by hand with: gh workflow run sync-release.yml --repo Oleafly/oleafly-server -f tag=server-v0.1.1'
rm -f "$ws/gh/run-fails"
touch "$ws/gh/copy-fails"
: >"$ws/gh/log"
run_block sync.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" GH_TOKEN=token TAG=server-v0.1.1
expect "a copy that never arrives fails, got $status" [ "$status" != 0 ]
expect "it gives up after 60 tries" [ "$(grep -c 'releases/download/server-v0.1.1/SHA256SUMS' "$ws/gh/log")" = 60 ]
expect "it says what to do" out_has "didn't answer within 10 minutes"
finish

begin "the draft step says the installer gets the release only after the copy"
gh_stub
mkdir -p "$ws/archives"
echo SHA256SUMS >"$ws/archives/SHA256SUMS"
run_block draft.sh GH_LOG="$ws/gh/log" GH_STATE="$ws/gh" GH_TOKEN=token TAG=server-v0.1.0 VERSION=0.1.0 GITHUB_REPOSITORY=Oleafly/Oleafly GITHUB_REPOSITORY_OWNER=Oleafly
expect "exit 0, got $status" [ "$status" = 0 ]
expect "the last line explains the copy" out_has 'The installer offers the release only once that copy is done.'
finish

rm -rf "$work"
printf '\n%s passed, %s failed\n' "$passed" "$failed"
if [ "$failed" -gt 0 ]; then
	printf 'Failed:%s\n' "$failures"
	exit 1
fi
