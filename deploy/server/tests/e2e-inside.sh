#!/bin/sh
set -u

out=/e2e/out
typescript=/e2e/typescript
exit_file=/e2e/exit
feed_patience=12000
install_dir=/opt/oleafly-server
domain=oleafly.localhost
passed=0
failed=0
failures=
status=

here=$(cd "$(dirname "$0")" && pwd)
. "$here/tests/lib.sh"

if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
	mkdir -p /sys/fs/cgroup/init
	xargs -rn1 </sys/fs/cgroup/cgroup.procs >/sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
	sed -e 's/ / +/g' -e 's/^/+/' </sys/fs/cgroup/cgroup.controllers >/sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
fi

echo "== Installing curl, as a fresh server image would have it"
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null 2>&1

begin() {
	scenario=$1
	scenario_failed=0
	echo "== $scenario"
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
	grep -qF -- "$1" "$out"
}

out_lacks() {
	! grep -qF -- "$1" "$out"
}

compose() {
	(cd "$install_dir" && docker compose "$@")
}

diagnose() {
	echo "---- installer output"
	sed 's/^/    | /' "$out"
	echo "---- containers"
	compose ps --all 2>&1 | sed 's/^/    | /'
	echo "---- server log"
	compose logs --no-color --tail 40 oleafly-server 2>&1 | sed 's/^/    | /'
	echo "---- caddy log"
	compose logs --no-color --tail 20 caddy 2>&1 | sed 's/^/    | /'
	echo "---- dockerd log"
	tail -n 20 /var/log/dockerd.log 2>&1 | sed 's/^/    | /'
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
		diagnose
	fi
}

run() {
	sh -c "$1" >"$out" 2>&1
	status=$?
}

piped() {
	printf 'dd if=/e2e/release-%s/install.sh bs=512 2>/dev/null | OLEAFLY_RELEASE_URL=file:///e2e/release-%s OLEAFLY_TEST_LOCAL_TLS=1 %s sh -s -- %s' "$1" "$1" "$2" "$3"
}

server_image() {
	docker inspect --format '{{.Config.Image}}' "$(compose ps -q oleafly-server)" 2>/dev/null
}

local_ca() {
	compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt >/e2e/ca.crt 2>/dev/null
}

manifest() {
	local_ca
	curl -fsS --max-time 10 --cacert /e2e/ca.crt --resolve "$domain:443:127.0.0.1" "https://$domain/.well-known/oleafly-server"
}

server_id() {
	manifest | sed -n 's/.*"server_id":"\([^"]*\)".*/\1/p'
}

env_sum() {
	sha256sum "$install_dir/.env" | awk '{ print $1 }'
}

begin "a fresh machine without Docker: the installer is piped to sh, installs Docker with Docker's script, asks its questions and starts the server"
(
	until grep -q "Docker is installed but not running" "$typescript" 2>/dev/null; do
		[ ! -f "$exit_file" ] || exit 0
		sleep 1
	done
	echo "== This box has no systemd, so the test starts dockerd the way systemd would"
	dockerd >/var/log/dockerd.log 2>&1 &
) &
status=$(run_in_terminal "$(piped 0.1.0 '' '')" \
	"Install Docker now? [y/N] " "y" \
	"Domain: " "$domain" \
	"Server name [Oleafly Server]: " "E2E Lab" \
	"Choose 1 or 2: " "1" \
	"Client ID: " "Ov23liEndToEnd" \
	"Client secret (hidden): " "e2e-client-secret" \
	"Set up email now? [y/N] " "n" \
	"Keep files in an S3 bucket? [y/N] " "n" \
	"Go ahead? [Y/n] " "y")
expect "exit 0, got $status" [ "$status" = 0 ]
expect "Docker was installed" command -v docker
expect "the containers run the release image" [ "$(server_image)" = localhost:5000/oleafly/oleafly-server:0.1.0 ]
expect "HTTPS answered through Caddy" out_has "https://$domain answers on this machine with a valid certificate."
printed_code=$(sed -n 's/^  Setup code: \([A-Z0-9-]*\)$/\1/p' "$out" | tail -n 1)
logged_code=$(compose logs --no-color --no-log-prefix oleafly-server 2>/dev/null | sed -n 's/.*Setup code: \([A-Z0-9][A-Z0-9-]*\)\..*/\1/p' | tail -n 1)
expect "a setup code was printed" [ -n "$printed_code" ]
expect "the printed code is the server's newest one ($printed_code vs $logged_code)" [ "$printed_code" = "$logged_code" ]
local_ca
expect "the server needs setup" sh -c "curl -fsS --cacert /e2e/ca.crt --resolve $domain:443:127.0.0.1 https://$domain/.well-known/oleafly-server | grep -q '\"needs_setup\":true'"
expect ".env is root-only" [ "$(stat -c '%a %u %g' "$install_dir/.env")" = '600 0 0' ]
expect ".env has the client secret" grep -qx 'OLEAFLY_GITHUB_CLIENT_SECRET=e2e-client-secret' "$install_dir/.env"
expect "the secret wasn't echoed" out_lacks 'e2e-client-secret'
expect "the server name is set" grep -qx "OLEAFLY_SERVER_NAME='E2E Lab'" "$install_dir/.env"
first_id=$(server_id)
expect "the server has an id" [ -n "$first_id" ]
finish

begin "running the installer again keeps .env and the data"
before=$(env_sum)
run "$(piped 0.1.0 OLEAFLY_DOMAIN=ignored.example.org --yes)"
expect "exit 0, got $status" [ "$status" = 0 ]
expect "it found the server" out_has "Found a server in $install_dir."
expect ".env didn't change" [ "$(env_sum)" = "$before" ]
expect "the server id didn't change" [ "$(server_id)" = "$first_id" ]
expect "HTTPS still answers" out_has "https://$domain answers on this machine with a valid certificate."
finish

begin "status reports a healthy server"
run "OLEAFLY_TEST_LOCAL_TLS=1 sh $install_dir/install.sh status"
expect "exit 0, got $status" [ "$status" = 0 ]
expect "it says the server is ready" out_has 'The server is running and ready.'
expect "it names the version" out_has "Oleafly Server 0.1.0 in $install_dir"
finish

begin "update moves to 0.1.1, keeps .env and the data"
before=$(env_sum)
run "$(piped 0.1.1 '' update)"
expect "exit 0, got $status" [ "$status" = 0 ]
expect "it says what changed" out_has 'Updated from 0.1.0 to 0.1.1'
expect "the data was copied before 0.1.1 started" sh -c "ls $install_dir/backups | grep -q -- '-0.1.0.tar.gz\$'"
expect "the containers run 0.1.1" [ "$(server_image)" = localhost:5000/oleafly/oleafly-server:0.1.1 ]
expect ".env didn't change" [ "$(env_sum)" = "$before" ]
expect "the server id didn't change" [ "$(server_id)" = "$first_id" ]
finish

begin "the 0.1.0 installer refuses to take the server back to 0.1.0"
run "$(piped 0.1.0 '' update)"
expect "exit 1, got $status" [ "$status" = 1 ]
expect "it says why" out_has 'This server runs 0.1.1, which is newer than this release (0.1.0).'
expect "the containers still run 0.1.1" [ "$(server_image)" = localhost:5000/oleafly/oleafly-server:0.1.1 ]
finish

begin "uninstall with --yes removes the containers and keeps the data volume"
run "sh $install_dir/install.sh uninstall --yes"
expect "exit 0, got $status" [ "$status" = 0 ]
expect "no containers are left" [ -z "$(docker ps -aq --filter label=com.docker.compose.project=oleafly-server)" ]
expect "the data volume is still there" docker volume inspect oleafly-server_oleafly-data
expect "it says where the data is" out_has '/var/lib/docker/volumes/oleafly-server_oleafly-data/_data'
finish

begin "installing again with the saved installer brings back the same server"
run "OLEAFLY_RELEASE_URL=file:///e2e/release-0.1.1 OLEAFLY_TEST_LOCAL_TLS=1 sh $install_dir/install.sh --yes"
expect "exit 0, got $status" [ "$status" = 0 ]
expect "the server id is the same" [ "$(server_id)" = "$first_id" ]
expect "a setup code is printed again" out_has 'Setup code: '
finish

begin "uninstall in a terminal deletes the data only after delete is typed"
status=$(run_in_terminal "sh $install_dir/install.sh uninstall" \
	"Stop and remove the containers? [y/N] " "y" \
	"To delete the data and settings, type delete. To keep them, press Enter: " "delete")
expect "exit 0, got $status" [ "$status" = 0 ]
expect "the data volume is gone" sh -c '! docker volume inspect oleafly-server_oleafly-data >/dev/null 2>&1'
expect "the install folder is gone" [ ! -e "$install_dir" ]
finish

printf '\n%s passed, %s failed\n' "$passed" "$failed"
if [ "$failed" -gt 0 ]; then
	printf 'Failed:%s\n' "$failures"
	exit 1
fi
