#!/bin/sh
set -u

src=$(cd "$(dirname "$0")/.." && pwd)
stub_path=/stub/bin:/stub/late:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
install_dir=/srv/oleafly
out=/stub/out
typescript=/stub/typescript
exit_file=/stub/exit
passed=0
failed=0
failures=
status=
installer_shell=${INSTALLER_SHELL:-sh}
docker_pin=$(sed -n 's/^docker_script_commit=//p' "$src/install.sh")
docker_pin_sha256=$(sed -n 's/^docker_script_sha256=//p' "$src/install.sh")
docker_pin_url=https://raw.githubusercontent.com/docker/docker-install/$docker_pin/install.sh
docker_stub_sha256=
compose_pin=$(sed -n 's/^compose_plugin_version=//p' "$src/install.sh")
compose_pin_x86_64=$(sed -n 's/^compose_plugin_sha256_x86_64=//p' "$src/install.sh")
compose_pin_aarch64=$(sed -n 's/^compose_plugin_sha256_aarch64=//p' "$src/install.sh")
# The asset and checksum install.sh prints on this machine.
case $(uname -m) in
	aarch64 | arm64)
		compose_arch=aarch64
		compose_pin_sha256=$compose_pin_aarch64
		;;
	*)
		compose_arch=x86_64
		compose_pin_sha256=$compose_pin_x86_64
		;;
esac

. "$src/tests/lib.sh"

make_release() {
	release=/stub/releases/server-v$1
	mkdir -p "$release"
	sed -e "s/^installer_version=unreleased\$/installer_version=$1/" \
		-e "s/^docker_script_sha256=[0-9a-f]*\$/docker_script_sha256=$docker_stub_sha256/" \
		"$src/install.sh" >"$release/install.sh"
	sed -E "s#^([[:space:]]*image:[[:space:]]*)ghcr\\.io/oleafly/oleafly-server:[^[:space:]]+[[:space:]]*\$#\\1ghcr.io/oleafly/oleafly-server:$1#" "$src/docker-compose.yml" >"$release/docker-compose.yml"
	cp "$src/Caddyfile" "$release/Caddyfile"
	cp "$src/.env.example" "$release/env.example"
	cp "$src/litestream.yml" "$release/litestream.yml"
	(cd "$release" && sha256sum install.sh docker-compose.yml Caddyfile env.example litestream.yml >SHA256SUMS)
	cp "$release/install.sh" "/stub/install-$1.sh"
	chmod 644 "/stub/install-$1.sh"
}

setup_stubs() {
	rm -rf /stub
	mkdir -p /stub/bin /stub/late /stub/releases
	for tool in curl systemctl service getent hostname ss sleep ip; do
		cp "$src/tests/stubs/$tool" "/stub/bin/$tool"
	done
	for tool in install cp mv; do
		cp "$src/tests/stubs/file-tool" "/stub/bin/$tool"
	done
	cp "$src/tests/stubs/docker" /stub/bin/docker.real
	cp "$src/tests/stubs/get-docker.sh" /stub/get-docker.sh
	chmod 755 /stub/bin/* /stub/get-docker.sh
	docker_stub_sha256=$(sha256sum /stub/get-docker.sh | awk '{ print $1 }')
	make_release 0.1.0
	make_release 0.1.1
	cp -R /stub/releases/server-v0.1.1 /stub/releases/latest
	echo 0.1.1 >/stub/releases/latest-version
	cp "$src/install.sh" /stub/install-unreleased.sh
	chmod 755 /stub /stub/releases
	chmod 644 /stub/install-unreleased.sh
}

os_release() {
	printf 'PRETTY_NAME="%s"\nID=%s\nID_LIKE="%s"\nVERSION_ID="%s"\n' "$4" "$1" "$2" "$3" >/stub/sys/etc/os-release
}

default_sys() {
	rm -rf /stub/sys
	mkdir -p /stub/sys/etc /stub/sys/proc/net /stub/sys/proc/sys/kernel
	os_release ubuntu debian 24.04 'Ubuntu 24.04.3 LTS'
	printf 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n' >/stub/sys/proc/net/route
	printf 'eth0\t00000000\t0100000A\t0003\t0\t0\t0\t00000000\t0\t0\t0\n' >>/stub/sys/proc/net/route
	printf 'eth0\t0000000A\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0\n' >>/stub/sys/proc/net/route
	echo 6.8.0-45-generic >/stub/sys/proc/sys/kernel/osrelease
	echo '00000000000000000000000000000001 01 80 10 80       lo' >/stub/sys/proc/net/if_inet6
	chmod -R a+rX /stub/sys
}

begin() {
	scenario=$1
	scenario_failed=0
	rm -rf /stub/state "$install_dir" "$out" "$typescript" "$exit_file"
	mkdir -p /stub/state
	: >/stub/log
	rm -f /stub/late/docker
	default_sys
}

docker_present() {
	cp /stub/bin/docker.real /stub/late/docker
	chmod 755 /stub/late/docker
	touch /stub/state/docker-running
}

all_good() {
	docker_present
	touch /stub/state/https-ok
	echo 203.0.113.10 >/stub/state/dns
	echo '10.0.0.5 203.0.113.10 ' >/stub/state/local-ips
}

run() {
	env -i PATH="$stub_path" HOME=/root OLEAFLY_DIR="$install_dir" OLEAFLY_TEST_SYSROOT=/stub/sys "$@" >"$out" 2>&1
	status=$?
}

run_full() {
	run OLEAFLY_DOMAIN=collab.example.org \
		OLEAFLY_SERVER_NAME='Smith Lab' \
		OLEAFLY_GITHUB_CLIENT_ID=Ov23liExample \
		OLEAFLY_GITHUB_CLIENT_SECRET="gh-secret-\$abc" \
		"$@"
}

terminal() {
	command_line="env -i PATH=$stub_path HOME=/root TERM=dumb OLEAFLY_DIR=$install_dir OLEAFLY_TEST_SYSROOT=/stub/sys $1"
	shift
	status=$(run_in_terminal "$command_line" "$@")
}

expect() {
	description=$1
	shift
	if ! "$@"; then
		scenario_failed=1
		printf '    expected: %s\n' "$description"
	fi
}

expect_status() {
	expect "exit status $1, got $status" [ "$status" = "$1" ]
}

out_has() {
	grep -qF -- "$1" "$out"
}

out_lacks() {
	! grep -qF -- "$1" "$out"
}

out_line() {
	grep -qxF -- "$1" "$out"
}

not() {
	! "$@"
}

log_order() {
	first=$(grep -nF -- "$1" /stub/log | head -n 1 | cut -d : -f 1)
	second=$(grep -nF -- "$2" /stub/log | head -n 1 | cut -d : -f 1)
	[ -n "$first" ] && [ -n "$second" ] && [ "$first" -lt "$second" ]
}

log_has() {
	grep -qF -- "$1" /stub/log
}

log_lacks() {
	! grep -qF -- "$1" /stub/log
}

env_has() {
	grep -qxF -- "$1" "$install_dir/.env"
}

state_is() {
	[ "$(cat "/stub/state/$1" 2>/dev/null)" = "$2" ]
}

same_file() {
	[ "$(sha256sum <"$1")" = "$(sha256sum <"$2")" ]
}

file_mode() {
	stat -c '%a %u %g' "$1"
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
		sed 's/^/    | /' "$out"
	fi
}

install_packages() {
	if command -v apt-get >/dev/null 2>&1; then
		apt-get update -qq >/dev/null 2>&1
		DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null 2>&1
	elif command -v dnf >/dev/null 2>&1; then
		dnf install -y -q "$@" >/dev/null 2>&1
	fi
}

each_key_once() {
	[ -z "$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$install_dir/.env" | sort | uniq -d)" ]
}

setup_stubs

begin "installs with every setting from the environment when Docker is already running"
all_good
run_full OLEAFLY_DOMAIN=Collab.Example.org \
	OLEAFLY_SMTP_HOST=smtp.example.org OLEAFLY_SMTP_PORT=587 OLEAFLY_SMTP_USER=lab@example.org \
	OLEAFLY_SMTP_PASSWORD='p@ss w0rd/#' OLEAFLY_MAIL_FROM=oleafly@example.org \
	OLEAFLY_BLOB_STORE=s3://lab-bucket/oleafly OLEAFLY_S3_REGION=eu-west-1 \
	OLEAFLY_S3_ACCESS_KEY_ID=AKIAEXAMPLE OLEAFLY_S3_SECRET_ACCESS_KEY=s3-secret-value \
	OLEAFLY_MAX_PROJECT_MB=100 \
	sh /stub/install-0.1.0.sh --yes
expect_status 0
expect ".env is root-only" [ "$(file_mode "$install_dir/.env")" = '600 0 0' ]
expect "the domain is lower case" env_has 'OLEAFLY_DOMAIN=collab.example.org'
expect "the name is quoted" env_has "OLEAFLY_SERVER_NAME='Smith Lab'"
expect "a secret with a dollar sign is single quoted" env_has "OLEAFLY_GITHUB_CLIENT_SECRET='gh-secret-\$abc'"
expect "the SMTP address is built and encoded" env_has 'OLEAFLY_SMTP_URL=smtp://lab%40example.org:p%40ss%20w0rd%2F%23@smtp.example.org:587'
expect "the From address is kept" env_has 'OLEAFLY_MAIL_FROM=oleafly@example.org'
expect "the bucket is set" env_has 'OLEAFLY_BLOB_STORE=s3://lab-bucket/oleafly'
expect "the bucket key is set" env_has 'OLEAFLY_S3_SECRET_ACCESS_KEY=s3-secret-value'
expect "another .env.example setting passes through" env_has 'OLEAFLY_MAX_PROJECT_MB=100'
expect "untouched defaults stay" env_has 'OLEAFLY_LOG_LEVEL=info'
expect "every key appears once" each_key_once
expect "the compose file names release 0.1.0" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.0$' "$install_dir/docker-compose.yml"
expect "the Caddyfile is in place" [ -f "$install_dir/Caddyfile" ]
expect "litestream.yml is in place" [ -f "$install_dir/litestream.yml" ]
expect ".env.example is in place" [ -f "$install_dir/.env.example" ]
expect "the saved installer is stamped and executable" grep -qx 'installer_version=0.1.0' "$install_dir/install.sh"
expect "the saved installer is mode 755" [ "$(file_mode "$install_dir/install.sh")" = '755 0 0' ]
expect "compose runs in the install folder" state_is compose-dir "$install_dir"
expect "compose pulls the release image" grep -qxF 'ghcr.io/oleafly/oleafly-server:0.1.0' /stub/state/pulled
expect "compose doesn't see the installer's environment" sh -c '! grep -q "OLEAFLY_\|gh-secret" /stub/state/compose-env'
expect "the setup code is shown" out_has 'Setup code: ABCD-EFGH-JKMN-PQRS'
expect "HTTPS is confirmed on this machine" out_has 'https://collab.example.org answers on this machine with a valid certificate.'
expect "it says how to check from outside" out_has 'open https://collab.example.org/healthz on a phone or from another network'
expect "the next steps say to add people" out_has '4. Add people under Manage server.'
expect "the next steps say how to see the code again" out_has "To see the current one, run: sudo sh $install_dir/install.sh status"
expect "DNS is confirmed" out_has 'collab.example.org points to this machine (203.0.113.10).'
expect "the client secret isn't printed" out_lacks 'gh-secret'
expect "the SMTP password isn't printed" out_lacks 'w0rd'
expect "the bucket secret isn't printed" out_lacks 's3-secret-value'
expect "next steps name Add server" out_has 'choose Add server and enter https://collab.example.org'
finish

begin "asks every question in a terminal and keeps the client secret hidden"
all_good
terminal "$installer_shell /stub/install-0.1.0.sh" \
	"Domain: " "collab.example.org" \
	"Server name [Oleafly Server]: " "O'Brien Lab" \
	"Choose 1 or 2: " "3" \
	"Choose 1 or 2: " "1" \
	"Client ID: " "Ov23liTerminal" \
	"Client secret (hidden): " "hidden-secret-123" \
	"Set up email now? [y/N] " "" \
	"Keep files in an S3 bucket? [y/N] " "" \
	"Go ahead? [Y/n] " ""
expect_status 0
expect "a name with an apostrophe is double quoted" env_has "OLEAFLY_SERVER_NAME=\"O'Brien Lab\""
expect "the client ID is saved" env_has 'OLEAFLY_GITHUB_CLIENT_ID=Ov23liTerminal'
expect "the client secret is saved" env_has 'OLEAFLY_GITHUB_CLIENT_SECRET=hidden-secret-123'
expect "the typed secret isn't echoed" out_lacks 'hidden-secret-123'
expect "a wrong menu answer is explained" out_has 'Type 1 or 2.'
expect "the GitHub callback address is shown" out_has 'https://collab.example.org/auth/callback/github'
expect "email stays off" env_has 'OLEAFLY_SMTP_URL='
expect "files stay on this machine" env_has 'OLEAFLY_BLOB_STORE=fs'
expect "the setup code is shown" out_has 'Setup code: ABCD-EFGH-JKMN-PQRS'
finish

begin "asks for OpenID Connect, email and a bucket in a terminal"
all_good
terminal "$installer_shell /stub/install-0.1.0.sh" \
	"Domain: " "https://collab.example.org/" \
	"Server name [Oleafly Server]: " "" \
	"Choose 1 or 2: " "2" \
	"Short name [university]: " "GitLab" \
	"Issuer address, such as https://gitlab.com: " "https://gitlab.com/" \
	"Client ID: " "gitlab-client" \
	"Client secret (hidden): " "gitlab-secret" \
	"Text on the sign-in button [Gitlab]: " "GitLab" \
	"Set up email now? [y/N] " "y" \
	"Mail server, such as smtp.example.org: " "smtp.example.org" \
	"Port [465]: " "" \
	"User name: " "oleafly" \
	"Password (hidden): " "mail-pass" \
	"Send from this address, such as oleafly@example.org: " "not an address" \
	"Send from this address, such as oleafly@example.org: " "oleafly@example.org" \
	"Keep files in an S3 bucket? [y/N] " "y" \
	"Bucket, with an optional folder, such as lab-bucket/oleafly: " "s3://lab-bucket/oleafly/" \
	"Region [us-east-1]: " "auto" \
	"Endpoint, only for a store other than Amazon S3 [none]: " "https://account.r2.cloudflarestorage.com" \
	"Access key ID: " "r2-key" \
	"Secret access key (hidden): " "r2-secret" \
	"Go ahead? [Y/n] " "y"
expect_status 0
expect "a pasted https:// address becomes a domain" env_has 'OLEAFLY_DOMAIN=collab.example.org'
expect "the default name is used" env_has "OLEAFLY_SERVER_NAME='Oleafly Server'"
expect "the issuer is saved without a trailing slash" env_has 'OLEAFLY_OIDC_GITLAB_ISSUER=https://gitlab.com'
expect "the client ID is saved" env_has 'OLEAFLY_OIDC_GITLAB_CLIENT_ID=gitlab-client'
expect "the client secret is saved" env_has 'OLEAFLY_OIDC_GITLAB_CLIENT_SECRET=gitlab-secret'
expect "the label is saved" env_has 'OLEAFLY_OIDC_GITLAB_LABEL=GitLab'
expect "the callback uses the lower-case name" out_has 'https://collab.example.org/auth/callback/gitlab'
expect "port 465 means smtps" env_has 'OLEAFLY_SMTP_URL=smtps://oleafly:mail-pass@smtp.example.org:465'
expect "the From address carries the server name" env_has "OLEAFLY_MAIL_FROM='Oleafly Server <oleafly@example.org>'"
expect "a bad address is explained" out_has 'Enter an email address, such as oleafly@example.org.'
expect "the bucket is saved" env_has 'OLEAFLY_BLOB_STORE=s3://lab-bucket/oleafly'
expect "the region is saved" env_has 'OLEAFLY_S3_REGION=auto'
expect "the endpoint is saved" env_has 'OLEAFLY_S3_ENDPOINT=https://account.r2.cloudflarestorage.com'
expect "secrets aren't echoed" sh -c "! grep -q 'gitlab-secret\|mail-pass\|r2-secret' $out"
expect "the summary names the provider" out_has 'Sign-in: OpenID Connect (gitlab)'
finish

begin "stops and prints Docker's install command when Docker is missing and the answer is no"
terminal "$installer_shell /stub/install-0.1.0.sh" "Install Docker now? [y/N] " "n"
expect_status 1
expect "the exact command is shown" out_has 'curl -fsSL https://get.docker.com | sudo sh'
expect "Docker's script wasn't downloaded" log_lacks 'docker-install'
expect "Docker's script didn't run" log_lacks 'docker install script ran'
expect "nothing was installed" [ ! -e "$install_dir" ]
finish

begin "refuses to run Docker's script when it doesn't match the pinned checksum"
echo 'echo tampered' >>/stub/get-docker.sh
run_full OLEAFLY_INSTALL_DOCKER=yes "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the pinned copy was downloaded" log_has "$docker_pin_url"
expect "the refusal says why" out_has "Docker's install script doesn't match the checksum this installer expects, so the installer won't run it. Nothing was changed."
expect "Docker's script didn't run" log_lacks 'docker install script ran'
expect "Docker isn't installed" [ ! -e /stub/late/docker ]
expect "no release was downloaded" log_lacks 'SHA256SUMS'
expect "nothing was installed" [ ! -e "$install_dir" ]
finish

begin "refuses to run Docker's script when it doesn't match the pinned checksum, after yes in a terminal"
terminal "$installer_shell /stub/install-0.1.0.sh" "Install Docker now? [y/N] " "y"
expect_status 1
expect "the refusal says why" out_has "so the installer won't run it. Nothing was changed."
expect "Docker's script didn't run" log_lacks 'docker install script ran'
expect "Docker isn't installed" [ ! -e /stub/late/docker ]
expect "nothing was installed" [ ! -e "$install_dir" ]
cp "$src/tests/stubs/get-docker.sh" /stub/get-docker.sh
chmod 755 /stub/get-docker.sh
finish

begin "installs Docker with Docker's script when Docker is missing and the answer is yes"
touch /stub/state/https-ok
terminal "$installer_shell /stub/install-0.1.0.sh" \
	"Install Docker now? [y/N] " "y" \
	"Domain: " "collab.example.org" \
	"Server name [Oleafly Server]: " "" \
	"Choose 1 or 2: " "1" \
	"Client ID: " "Ov23liTerminal" \
	"Client secret (hidden): " "secret" \
	"Set up email now? [y/N] " "n" \
	"Keep files in an S3 bucket? [y/N] " "n" \
	"Go ahead? [Y/n] " "y"
expect_status 0
expect "the pinned copy was downloaded" log_has "$docker_pin_url"
expect "get.docker.com wasn't asked" log_lacks 'https://get.docker.com'
expect "Docker's script ran and was told its commit" log_has "docker install script ran, commit $docker_pin"
expect "Docker was started" log_has 'systemctl enable --now docker'
expect "the server was started" [ -f /stub/state/up ]
finish

begin "with --yes and no Docker, stops with the exact command"
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the exact command is shown" out_has 'curl -fsSL https://get.docker.com | sudo sh'
expect "the opt-in is named" out_has 'OLEAFLY_INSTALL_DOCKER=yes'
expect "Docker's script wasn't downloaded" log_lacks 'docker-install'
expect "Docker's script didn't run" log_lacks 'docker install script ran'
finish

begin "with --yes and OLEAFLY_INSTALL_DOCKER=yes, installs Docker"
touch /stub/state/https-ok
run_full OLEAFLY_INSTALL_DOCKER=yes "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "the pinned copy was downloaded" log_has "$docker_pin_url"
expect "Docker's script ran and was told its commit" log_has "docker install script ran, commit $docker_pin"
expect "the server was started" [ -f /stub/state/up ]
finish

begin "with --yes, a missing domain stops before anything is written"
all_good
run OLEAFLY_GITHUB_CLIENT_ID=id OLEAFLY_GITHUB_CLIENT_SECRET=secret "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the variable is named" out_has 'OLEAFLY_DOMAIN is not set.'
expect "nothing was written" [ ! -e "$install_dir" ]
expect "nothing was pulled" log_lacks 'compose pull'
finish

begin "with OLEAFLY_NONINTERACTIVE=1, a missing sign-in provider stops"
all_good
run OLEAFLY_NONINTERACTIVE=1 OLEAFLY_DOMAIN=collab.example.org "$installer_shell" /stub/install-0.1.0.sh
expect_status 1
expect "the providers are named" out_has 'No sign-in provider is set.'
expect "nothing was written" [ ! -e "$install_dir/.env" ]
finish

begin "with --yes, half a GitHub app stops"
all_good
run OLEAFLY_DOMAIN=collab.example.org OLEAFLY_GITHUB_CLIENT_ID=id "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the missing half is named" out_has "OLEAFLY_GITHUB_CLIENT_ID is set, but OLEAFLY_GITHUB_CLIENT_SECRET isn't. Set both."
finish

begin "with --yes, an OpenID Connect block from the environment is used"
all_good
run OLEAFLY_DOMAIN=collab.example.org OLEAFLY_OIDC_UNI_ISSUER=https://sso.example.edu/realms/lab \
	OLEAFLY_OIDC_UNI_CLIENT_ID=lab OLEAFLY_OIDC_UNI_CLIENT_SECRET=oidc-secret \
	sh /stub/install-0.1.0.sh --yes
expect_status 0
expect "the issuer is saved" env_has 'OLEAFLY_OIDC_UNI_ISSUER=https://sso.example.edu/realms/lab'
expect "the secret is saved" env_has 'OLEAFLY_OIDC_UNI_CLIENT_SECRET=oidc-secret'
expect "the summary names it" out_has 'Sign-in: OpenID Connect (uni)'
expect "the secret isn't printed" out_lacks 'oidc-secret'
finish

begin "reads settings by name without eval and keeps odd values exactly as given"
all_good
odd_secret="p\$ss; \`touch /stub/state/ran-backtick\` \"q\" \$(touch /stub/state/ran-dollar) \$HOME"
odd_label="O'Brien Lab; SSO for everyone"
odd_github_label="Sign in; \"GitHub\" \$HOME \`touch /stub/state/ran-label\`"
run OLEAFLY_DOMAIN=collab.example.org OLEAFLY_OIDC_LAB_ISSUER=https://sso.example.edu/realms/lab \
	OLEAFLY_OIDC_LAB_CLIENT_ID='lab client' OLEAFLY_OIDC_LAB_CLIENT_SECRET="$odd_secret" \
	OLEAFLY_OIDC_LAB_LABEL="$odd_label" OLEAFLY_GITHUB_LABEL="$odd_github_label" \
	"$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "install.sh has no eval" sh -c "! grep -nw eval '$src/install.sh'"
expect "the client ID with a space is kept" env_has "OLEAFLY_OIDC_LAB_CLIENT_ID='lab client'"
expect "the secret is kept character for character" env_has "OLEAFLY_OIDC_LAB_CLIENT_SECRET='$odd_secret'"
expect "the label with an apostrophe is kept" env_has "OLEAFLY_OIDC_LAB_LABEL=\"$odd_label\""
expect "a passed-through setting is kept character for character" env_has "OLEAFLY_GITHUB_LABEL='$odd_github_label'"
expect "nothing in a backtick ran" [ ! -e /stub/state/ran-backtick ]
expect "nothing in a dollar sign ran" [ ! -e /stub/state/ran-dollar ]
expect "nothing in the passed-through setting ran" [ ! -e /stub/state/ran-label ]
expect "the summary names it" out_has 'Sign-in: OpenID Connect (lab)'
expect "the secret isn't printed" out_lacks "p\$ss"
finish

begin "without a terminal and without --yes, says how to run it unattended"
all_good
run "$installer_shell" /stub/install-0.1.0.sh
expect_status 1
expect "the problem is named" out_has "There's no terminal to answer questions on."
finish

begin "a second install keeps .env and refreshes the release files"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
echo 'OLEAFLY_LOG_LEVEL=debug' >>"$install_dir/.env"
before=$(sha256sum "$install_dir/.env")
echo 'edited' >>"$install_dir/Caddyfile"
rm -f /stub/state/up
run OLEAFLY_DOMAIN=other.example.org "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect ".env didn't change" [ "$(sha256sum "$install_dir/.env")" = "$before" ]
expect "the Caddyfile is the release's again" same_file "$install_dir/Caddyfile" /stub/releases/server-v0.1.0/Caddyfile
expect "it says it found the server" out_has "Found a server in $install_dir."
expect "it uses the domain from .env" out_has 'https://collab.example.org answers on this machine'
expect "the server was started again" [ -f /stub/state/up ]
finish

begin "update moves to the installer's release, keeps .env and restarts"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
before=$(sha256sum "$install_dir/.env")
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 0
expect "the compose file names 0.1.1" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.1$' "$install_dir/docker-compose.yml"
expect "compose started 0.1.1" state_is running-image 'ghcr.io/oleafly/oleafly-server:0.1.1'
expect ".env didn't change" [ "$(sha256sum "$install_dir/.env")" = "$before" ]
expect "it says what changed" out_has 'Updated from 0.1.0 to 0.1.1'
touch /stub/state/latest-unreachable
run "$installer_shell" /stub/install-0.1.0.sh update
expect "an older release is refused" [ "$status" = 1 ]
expect "the refusal says why" out_has 'This server runs 0.1.1, which is newer than this release (0.1.0). Nothing was changed.'
expect "the compose file still names 0.1.1" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.1$' "$install_dir/docker-compose.yml"
rm -f /stub/state/latest-unreachable
run "$installer_shell" /stub/install-0.1.1.sh update
expect "the same release again is fine" [ "$status" = 0 ]
expect "it says it's up to date" out_has 'Oleafly Server 0.1.1 is up to date'
finish

begin "update without an install says how to install"
all_good
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 1
expect "the folder is named" out_has "There's no Oleafly Server in $install_dir."
finish

begin "a file that doesn't match SHA256SUMS stops the install before anything changes"
all_good
echo 'tampered' >>/stub/releases/server-v0.1.0/Caddyfile
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the file is named" out_has "Caddyfile doesn't match its checksum in SHA256SUMS, so the installer won't use it. Nothing was changed."
expect "nothing was written" [ ! -e "$install_dir" ]
expect "compose never ran" log_lacks 'compose pull'
make_release 0.1.0
finish

begin "a file that doesn't match SHA256SUMS stops an update and keeps the running release"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
sed -i 's/oleafly-server:0.1.1/evil\/image:latest/' /stub/releases/server-v0.1.1/docker-compose.yml
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 1
expect "the file is named" out_has "docker-compose.yml doesn't match its checksum"
expect "the compose file still names 0.1.0" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.0$' "$install_dir/docker-compose.yml"
make_release 0.1.1
finish

begin "busy ports stop the install and name the program"
all_good
cat >/stub/state/listening <<'EOF'
LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=812,fd=6))
LISTEN 0      511             [::]:443          [::]:*    users:(("nginx",pid=812,fd=7))
LISTEN 0      4096       127.0.0.1:8080      0.0.0.0:*    users:(("python3",pid=900,fd=3))
EOF
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "port 80 is named" out_has 'Port 80 is in use by nginx.'
expect "port 443 is named" out_has 'Port 443 is in use by nginx.'
expect "other ports don't matter" out_lacks '8080'
expect "Docker wasn't touched" log_lacks 'docker '
finish

begin "free ports with other listeners carry on"
all_good
echo 'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))' >/stub/state/listening
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "the ports are free" out_has 'Ports 80 and 443 are free.'
finish

begin "starts Docker when it is installed but stopped"
all_good
rm -f /stub/state/docker-running
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "it says it's starting Docker" out_has 'Docker is installed but not running. Starting it.'
expect "systemctl started it" log_has 'systemctl enable --now docker'
finish

begin "explains when Docker won't start"
all_good
rm -f /stub/state/docker-running
touch /stub/state/docker-start-fails
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the problem is named" out_has "Docker didn't start."
expect "the start command is shown" out_has 'sudo systemctl start docker'
expect "service was tried as well" log_has 'service docker start'
finish

begin "says how to add the Compose plugin when it is missing"
all_good
touch /stub/state/compose-missing
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "Ubuntu's package is named" out_has 'sudo apt-get install docker-compose-v2'
expect "Docker's package isn't offered without Docker's repository" out_lacks 'docker-compose-plugin'
finish

begin "keeps going with a clear note when HTTPS doesn't answer yet"
all_good
rm -f /stub/state/https-ok
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "the note is shown" out_has "The server is running, but https://collab.example.org doesn't answer yet."
expect "the status command is shown" out_has "sudo sh $install_dir/install.sh status"
expect "the setup code is still shown" out_has 'Setup code: ABCD-EFGH-JKMN-PQRS'
expect "it says the code changes on restart" out_has 'The code is new each time the server starts'
expect "it names firewalls and security groups" out_has 'Check that TCP ports 80 and 443 and UDP port 443 are open in any firewall or cloud security group'
expect "a direct DNS match doesn't mention port forwarding" out_lacks 'Forward TCP ports 80 and 443'
finish

begin "reports the server's own reason when it can't start"
all_good
echo 'restarting none 3' >/stub/state/container-state
echo 'Oleafly Server cannot start. OLEAFLY_SMTP_URL must look like smtps://user:password@smtp.example.edu:465.' >/stub/state/server-log
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the reason is shown" out_has 'It said: Oleafly Server cannot start. OLEAFLY_SMTP_URL must look like'
expect "the fix is named" out_has "Fix the setting in $install_dir/.env"
finish

begin "gives up after three minutes when the server never gets ready"
all_good
echo 'running starting 0' >/stub/state/container-state
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the timeout is named" out_has "The server didn't become ready within 3 minutes."
finish

begin "says when the registry refuses the image, and when the network fails"
all_good
touch /stub/state/pull-fails
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "Docker's message is shown" out_has 'pull access denied'
expect "the image is named" out_has "Docker couldn't get ghcr.io/oleafly/oleafly-server:0.1.0 from the registry."
expect "the network isn't blamed" out_lacks "Check this machine's network connection"
expect "the issues page is named" out_has 'https://github.com/Oleafly/oleafly-server/issues'
rm -rf "$install_dir"
echo 'Error response from daemon: Get "https://ghcr.io/v2/": dial tcp: lookup ghcr.io: no such host' >/stub/state/pull-fails
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "a network failure fails too" [ "$status" = 1 ]
expect "the network failure is named" out_has "Docker couldn't download the images."
expect "the network advice stays" out_has "Check this machine's network connection"
finish

begin "warns without stopping when the domain points somewhere else"
all_good
echo 198.51.100.7 >/stub/state/dns
echo 203.0.113.10 >/stub/state/public-ip4
echo '10.0.0.5 ' >/stub/state/local-ips
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "the mismatch is explained" out_has 'collab.example.org points to 198.51.100.7, and this machine is 10.0.0.5 203.0.113.10.'
finish

begin "warns without stopping when the domain has no DNS record"
all_good
rm -f /stub/state/dns
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "the missing record is explained" out_has "collab.example.org doesn't have a DNS record yet."
finish

begin "finds this machine through its public address behind NAT"
all_good
echo '10.0.0.5 ' >/stub/state/local-ips
echo 203.0.113.10 >/stub/state/public-ip4
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "the match is confirmed" out_has 'collab.example.org points to this machine (203.0.113.10).'
expect "ifconfig.me was asked" log_has 'https://ifconfig.me/ip'
finish

begin "refuses domains Caddy can't get a certificate for"
all_good
for bad in 'collab' '203.0.113.10' 'collab.example.org/path' 'collab.example.org:8443' 'collab_lab.example.org' 'oleafly.localhost' '-bad.example.org'; do
	run OLEAFLY_DOMAIN="$bad" OLEAFLY_GITHUB_CLIENT_ID=id OLEAFLY_GITHUB_CLIENT_SECRET=secret "$installer_shell" /stub/install-0.1.0.sh --yes
	expect "$bad is refused" [ "$status" = 1 ]
	expect "$bad is explained" out_has "OLEAFLY_DOMAIN is $bad."
done
finish

begin "refuses a server name that .env can't hold"
all_good
run_full OLEAFLY_SERVER_NAME="O'Brien \$Lab" "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the reason is shown" out_has "The name can't mix quotes with"
finish

begin "status reports a healthy server and HTTPS"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
run "$installer_shell" /stub/install-0.1.0.sh status
expect_status 0
expect "the version is shown" out_has "Oleafly Server 0.1.0 in $install_dir"
expect "the containers are listed" out_has 'oleafly-server: Up 2 minutes (healthy)'
expect "the server is ready" out_has 'The server is running and ready.'
expect "HTTPS answers" out_has 'https://collab.example.org answers on this machine with a valid certificate.'
expect "no secret is shown" out_lacks 'gh-secret'
rm -f /stub/state/https-ok
run "$installer_shell" /stub/install-0.1.0.sh status
expect "status fails when HTTPS doesn't answer" [ "$status" = 1 ]
finish

begin "uninstall with --yes removes the containers and keeps the data"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
run "$installer_shell" /stub/install-0.1.0.sh uninstall --yes
expect_status 0
expect "compose down ran" log_has 'compose down --remove-orphans'
expect "the volumes stay" [ ! -f /stub/state/volumes-removed ]
expect ".env stays" [ -f "$install_dir/.env" ]
expect "the data folder is shown" out_has '/var/lib/docker/volumes/oleafly-server_oleafly-data/_data'
finish

begin "uninstall in a terminal keeps the data when Enter is pressed"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
terminal "$installer_shell /stub/install-0.1.0.sh uninstall" \
	"Stop and remove the containers? [y/N] " "y" \
	"To delete the data and settings, type delete. To keep them, press Enter: " ""
expect_status 0
expect "the containers are gone" [ -f /stub/state/down ]
expect "the volumes stay" [ ! -f /stub/state/volumes-removed ]
expect ".env stays" [ -f "$install_dir/.env" ]
expect "it says so" out_has 'Kept the data and settings.'
finish

begin "uninstall in a terminal deletes the data only after delete is typed"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
mkdir -p "$install_dir/secrets"
terminal "$installer_shell /stub/install-0.1.0.sh uninstall" \
	"Stop and remove the containers? [y/N] " "y" \
	"To delete the data and settings, type delete. To keep them, press Enter: " "delete"
expect_status 0
expect "the data volume is removed" [ -f /stub/state/data-volume-removed ]
expect "Caddy's volumes stay" [ ! -f /stub/state/volumes-removed ]
expect "it says how to remove Caddy's certificates" out_has 'sudo docker volume rm oleafly-server_caddy-data oleafly-server_caddy-config'
expect ".env is gone" [ ! -e "$install_dir/.env" ]
expect "files the installer doesn't know stay" [ -d "$install_dir/secrets" ]
expect "it says the folder stays" out_has 'still holds files you added'
finish

begin "uninstall in a terminal changes nothing when the first answer is no"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
terminal "$installer_shell /stub/install-0.1.0.sh uninstall" "Stop and remove the containers? [y/N] " ""
expect_status 1
expect "compose down didn't run" [ ! -f /stub/state/down ]
finish

begin "doesn't show a setup code once the server has an admin"
all_good
touch /stub/state/has-admin
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "it says there's an admin" out_has 'This server already has an admin.'
expect "no code is shown" out_lacks 'ABCD-EFGH'
finish

begin "shows help, the version, and refuses unknown options"
run "$installer_shell" /stub/install-0.1.0.sh --help
expect_status 0
expect "help lists the Docker opt-in" out_has 'OLEAFLY_INSTALL_DOCKER=yes'
expect "help lists the commands" out_has 'uninstall'
run "$installer_shell" /stub/install-0.1.0.sh --version
expect "the version is stamped" out_has 'Oleafly Server installer 0.1.0'
run "$installer_shell" /stub/install-unreleased.sh --version
expect "an unstamped copy says so" out_has 'Oleafly Server installer unreleased copy, installs the latest release'
run "$installer_shell" /stub/install-0.1.0.sh --bogus
expect "an unknown option fails" [ "$status" = 1 ]
expect "an unknown option is named" out_has 'The installer doesn'"'"'t know "--bogus".'
finish

begin "an unreleased copy installs the latest release"
all_good
run_full "$installer_shell" /stub/install-unreleased.sh --yes
expect_status 0
expect "it downloads from latest" log_has 'releases/latest/download/SHA256SUMS'
expect "the compose file names the latest release" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.1$' "$install_dir/docker-compose.yml"
finish

begin "works when piped to sh"
all_good
dd if=/stub/install-0.1.0.sh bs=512 2>/dev/null | env -i PATH="$stub_path" HOME=/root OLEAFLY_DIR="$install_dir" OLEAFLY_TEST_SYSROOT=/stub/sys \
	OLEAFLY_DOMAIN=collab.example.org OLEAFLY_GITHUB_CLIENT_ID=id OLEAFLY_GITHUB_CLIENT_SECRET=secret \
	"$installer_shell" -s -- --yes >"$out" 2>&1
status=$?
expect_status 0
expect "the server was started" [ -f /stub/state/up ]
expect "it ran to the end" out_has 'Update: curl -fsSL https://oleafly.com/server/install.sh | sudo sh -s update'
finish

begin "reads the release from OLEAFLY_RELEASE_URL and refuses plain http"
all_good
run_full OLEAFLY_RELEASE_URL=file:///stub/releases/server-v0.1.1/ "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "the file:// release was used" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.1$' "$install_dir/docker-compose.yml"
rm -rf "$install_dir"
run_full OLEAFLY_RELEASE_URL=http://mirror.example.org/ "$installer_shell" /stub/install-0.1.0.sh --yes
expect "plain http fails" [ "$status" = 1 ]
expect "the rule is explained" out_has 'OLEAFLY_RELEASE_URL has to start with https:// or file://.'
finish

begin "needs root or sudo"
all_good
setpriv --reuid=65534 --regid=65534 --clear-groups env -i PATH="$stub_path" HOME=/tmp OLEAFLY_DIR="$install_dir" OLEAFLY_TEST_SYSROOT=/stub/sys \
	OLEAFLY_DOMAIN=collab.example.org "$installer_shell" /stub/install-0.1.0.sh --yes >"$out" 2>&1
status=$?
expect_status 1
expect "root is asked for" out_has 'Run it as root, or install sudo first.'
finish

begin "a normal user with sudo can install, and secrets stay out of the output"
all_good
command -v sudo >/dev/null 2>&1 || install_packages sudo
id labadmin >/dev/null 2>&1 || useradd -m labadmin
printf 'Defaults secure_path="%s"\nlabadmin ALL=(ALL) NOPASSWD: ALL\n' "$stub_path" >/etc/sudoers.d/labadmin
chmod 440 /etc/sudoers.d/labadmin
chmod 777 /stub/state
chmod 666 /stub/log
uid=$(id -u labadmin)
gid=$(id -g labadmin)
setpriv --reuid="$uid" --regid="$gid" --init-groups env -i PATH="$stub_path" HOME=/home/labadmin OLEAFLY_DIR="$install_dir" OLEAFLY_TEST_SYSROOT=/stub/sys \
	OLEAFLY_DOMAIN=collab.example.org OLEAFLY_GITHUB_CLIENT_ID=id OLEAFLY_GITHUB_CLIENT_SECRET=user-secret \
	"$installer_shell" /stub/install-0.1.0.sh --yes >"$out" 2>&1
status=$?
expect_status 0
expect ".env is still root-only" [ "$(file_mode "$install_dir/.env")" = '600 0 0' ]
expect "the release files belong to root" [ "$(stat -c %u "$install_dir/docker-compose.yml")" = 0 ]
expect "compose ran as root" state_is compose-uid 0
expect "the secret isn't printed" out_lacks 'user-secret'
setpriv --reuid="$uid" --regid="$gid" --init-groups env -i PATH="$stub_path" HOME=/home/labadmin OLEAFLY_DIR="$install_dir" OLEAFLY_TEST_SYSROOT=/stub/sys \
	"$installer_shell" /stub/install-0.1.0.sh status >"$out" 2>&1
status=$?
expect "status works through sudo, got $status" [ "$status" = 0 ]
rm -f /etc/sudoers.d/labadmin
finish

begin "compares prerelease versions the way SemVer does"
sed -n '/^version_gt() {$/,/^}$/p' "$src/install.sh" >/stub/version_gt.sh
# shellcheck source=/dev/null
. /stub/version_gt.sh
for pair in '0.2.0-rc.10 0.2.0-rc.9' '0.2.0-rc.10 0.2.0-rc.2' '0.2.0-rc.1 0.2.0-beta.1' '0.2.0 0.2.0-rc.1' \
	'0.1.10 0.1.9' '0.2.0-rc.1.1 0.2.0-rc.1' '0.2.0-rc.1 0.2.0-1' '1.0.0 0.9.9' '0.2.0-rc-2.1 0.2.0-rc-1.9'; do
	newer=${pair% *}
	older=${pair#* }
	expect "$newer is newer than $older" version_gt "$newer" "$older"
	expect "$older isn't newer than $newer" not version_gt "$older" "$newer"
done
expect "a version isn't newer than itself" not version_gt 0.2.0-rc.1 0.2.0-rc.1
finish

begin "update moves from rc.9 to rc.10 and refuses to go back"
all_good
make_release 0.2.0-rc.9
make_release 0.2.0-rc.10
run_full "$installer_shell" /stub/install-0.2.0-rc.9.sh --yes
run "$installer_shell" /stub/install-0.2.0-rc.10.sh update
expect_status 0
expect "it says what changed" out_has 'Updated from 0.2.0-rc.9 to 0.2.0-rc.10'
run "$installer_shell" /stub/install-0.2.0-rc.9.sh update
expect "going back is refused" [ "$status" = 1 ]
expect "the refusal names both" out_has 'This server runs 0.2.0-rc.10, which is newer than this release (0.2.0-rc.9).'
finish

begin "a failed download during an update changes nothing"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
touch /stub/state/pull-fails
: >/stub/log
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 1
expect "it says nothing changed" out_has 'Nothing was changed.'
expect "the compose file still names 0.1.0" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.0$' "$install_dir/docker-compose.yml"
expect "the saved installer is still 0.1.0" grep -qx 'installer_version=0.1.0' "$install_dir/install.sh"
expect "the running server is still 0.1.0" state_is running-image 'ghcr.io/oleafly/oleafly-server:0.1.0'
expect "the server wasn't stopped" log_lacks 'compose stop'
expect "nothing was copied" [ ! -e "$install_dir/backups" ]
rm -f /stub/state/pull-fails
run "$installer_shell" /stub/install-0.1.0.sh status
expect "status still names 0.1.0" out_has "Oleafly Server 0.1.0 in $install_dir"
finish

begin "update copies the data before the new version starts, and keeps the previous files"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
mkdir -p "$install_dir/backups"
for stamp in 20260101T000000Z 20260201T000000Z 20260301T000000Z 20260401T000000Z; do
	echo old >"$install_dir/backups/oleafly-data-$stamp-0.0.9.tar.gz"
done
: >/stub/log
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 0
expect "an archive named after 0.1.0 was made" sh -c "ls '$install_dir/backups' | grep -q -- '-0.1.0.tar.gz\$'"
expect "the backups folder is root-only" [ "$(file_mode "$install_dir/backups")" = '700 0 0' ]
expect "only the three newest archives are kept" [ "$(find "$install_dir/backups" -type f | wc -l)" = 3 ]
expect "the oldest archives are gone" [ ! -e "$install_dir/backups/oleafly-data-20260201T000000Z-0.0.9.tar.gz" ]
expect "the new images were pulled before anything stopped" log_order 'release/docker-compose.yml pull' 'compose stop'
expect "the server was stopped before the copy" log_order 'compose stop' 'docker run --rm -v oleafly-server_oleafly-data:/data:ro'
expect "the copy came before the new version started" log_order 'docker run --rm -v oleafly-server_oleafly-data:/data:ro' 'compose up'
expect "the copy used the release's Caddy image" log_has '--entrypoint tar caddy:2.11.7 -czf'
expect "the previous compose file is kept" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.0$' "$install_dir/docker-compose.yml.previous"
expect "the previous installer is kept" grep -qx 'installer_version=0.1.0' "$install_dir/install.sh.previous"
expect "it says where the copy is" out_has "Copied the data to $install_dir/backups/oleafly-data-"
expect "it says what changed" out_has 'Updated from 0.1.0 to 0.1.1'
: >/stub/log
run "$installer_shell" /stub/install-0.1.1.sh update
expect "the same version again makes no copy" log_lacks 'docker run'
expect "the same version again keeps the previous files" grep -q 'oleafly-server:0.1.0$' "$install_dir/docker-compose.yml.previous"
finish

begin "a new release that doesn't start prints the way back"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
echo 'restarting none 1' >/stub/state/container-state
echo '2026-10-14T10:00:00.000000Z ERROR the database schema version 9 is newer than this Oleafly Server understands (7). Install a newer Oleafly Server or restore a backup.' >/stub/state/server-log
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 1
expect "it says the server stopped" out_has 'The server stopped right after it started.'
expect "the server's error is shown without its timestamp" out_has 'It said: the database schema version 9 is newer'
expect "an error that isn't a setting doesn't blame .env" out_lacks 'Fix the setting in'
expect "the way back is named" out_has 'To go back to 0.1.0 with the data from before this update, run:'
expect "the way back restores the archive" out_has "find /data -mindepth 1 -delete && tar -xzf /backup/oleafly-data-"
expect "the way back restores the compose file" out_has 'sudo cp docker-compose.yml.previous docker-compose.yml'
finish

begin "a release file that can't be written after the copy starts the old server again"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
echo Caddyfile >/stub/state/install-fails
: >/stub/log
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 1
expect "the data was copied first" log_order 'compose stop' 'docker run --rm -v oleafly-server_oleafly-data:/data:ro'
expect "the old server was started again" log_order 'docker run --rm -v oleafly-server_oleafly-data:/data:ro' 'compose start'
expect "the server is up" [ -f /stub/state/up ]
expect "no new version was started" log_lacks 'compose up'
expect "it says nothing was replaced" out_has 'None of the installed files changed. The server runs 0.1.0 again.'
expect "it says to run the installer again" out_has 'Free some disk space, then run the installer again.'
expect "it doesn't offer a data restore nobody needs" out_lacks 'To go back to 0.1.0 with the data'
expect "the compose file is still the old release's" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.0$' "$install_dir/docker-compose.yml"
expect "no staging folder is left" [ ! -e "$install_dir/.release-incoming" ]
rm -f /stub/state/install-fails
: >/stub/log
run "$installer_shell" /stub/install-0.1.1.sh update
expect "the next update works" [ "$status" = 0 ]
expect "the next update still copies the data first" log_has 'docker run --rm -v oleafly-server_oleafly-data:/data:ro'
expect "the next update says what changed" out_has 'Updated from 0.1.0 to 0.1.1'
rm -rf "$install_dir"
echo Caddyfile >/stub/state/install-fails
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "a new install stops with a reason" [ "$status" = 1 ]
expect "a new install says what failed" out_has "Couldn't put the release files in $install_dir."
finish

begin "a release file that can't be moved into place puts the previous files back"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
echo install.sh >/stub/state/mv-fails
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 1
expect "it says the previous files are back" out_has 'The installer put the previous files back. The server runs 0.1.0 again.'
expect "the compose file is the old release's again" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.0$' "$install_dir/docker-compose.yml"
expect "the Caddyfile was kept too" [ -f "$install_dir/Caddyfile.previous" ]
expect "the server is up" [ -f /stub/state/up ]
finish

begin "a copy of the old files that can't be written stops the update before the server stops"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
echo docker-compose.yml.previous >/stub/state/cp-fails
: >/stub/log
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 1
expect "it says what it couldn't copy" out_has "Couldn't keep a copy of $install_dir/docker-compose.yml before the update. Nothing was changed."
expect "the server was never stopped" log_lacks 'compose stop'
expect "the server still runs" [ -f /stub/state/up ]
expect "the release files are the old ones" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.0$' "$install_dir/docker-compose.yml"
finish

begin "an update also pulls the images docker-compose.override.yml names"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
printf 'services:\n  caddy:\n    image: example.org/caddy-with-plugins:2.11.7\n' >"$install_dir/docker-compose.override.yml"
: >/stub/log
: >/stub/state/pulled
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 0
expect "the override is read with the release file" log_has "-f $install_dir/docker-compose.override.yml pull"
expect "its image was pulled before the update" grep -qx 'example.org/caddy-with-plugins:2.11.7' /stub/state/pulled
expect "the release's server image was pulled too" grep -qx 'ghcr.io/oleafly/oleafly-server:0.1.1' /stub/state/pulled
expect "a service the override builds is skipped" log_has 'pull --quiet --ignore-buildable'
echo 'Error response from daemon: pull access denied for example.org/caddy-with-plugins' >/stub/state/pull-fails
run "$installer_shell" /stub/install-0.1.1.sh update
expect "a refused pull fails" [ "$status" = 1 ]
expect "the override's image is named" out_has 'or one that docker-compose.override.yml names (example.org/caddy-with-plugins:2.11.7)'
finish

begin "a failed copy before an update keeps the running release"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
touch /stub/state/backup-fails
run "$installer_shell" /stub/install-0.1.1.sh update
expect_status 1
expect "it says the copy failed" out_has "Couldn't copy the data before the update."
expect "the compose file still names 0.1.0" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.0$' "$install_dir/docker-compose.yml"
expect "the server was started again" log_has 'compose start'
expect "no half-written archive is left" [ -z "$(ls -A "$install_dir/backups")" ]
finish

begin "a server Docker restarted once still counts as ready on the next run"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
echo 'running healthy 1' >/stub/state/container-state
run "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "it says the server is running" out_has 'The server is running.'
finish

begin "a server that restarts while the installer waits is reported"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
printf 'running healthy 1\nrunning starting 1\nrunning healthy 2\n' >/stub/state/container-states
run "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "it says the server stopped" out_has 'The server stopped right after it started.'
finish

begin "the saved installer says when a newer release is out"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
run "$installer_shell" "$install_dir/install.sh" update
expect_status 1
expect "the newer release is named" out_has 'Oleafly Server 0.1.1 is out, and this installer is for 0.1.0. Nothing was changed.'
expect "the update command is shown" out_has 'Update with: curl -fsSL https://oleafly.com/server/install.sh | sudo sh -s update'
expect "it doesn't claim to be up to date" out_lacks 'up to date'
expect "the compose file still names 0.1.0" grep -q 'oleafly-server:0.1.0$' "$install_dir/docker-compose.yml"
touch /stub/state/latest-unreachable
run "$installer_shell" "$install_dir/install.sh" update
expect "without the check it still repairs in place" [ "$status" = 0 ]
expect "it says it couldn't check" out_has "The installer couldn't check for a newer release."
expect "it doesn't claim to be up to date when it couldn't check" out_lacks 'up to date'
rm -f /stub/state/latest-unreachable
run OLEAFLY_RELEASE_URL=file:///stub/releases/server-v0.1.0 "$installer_shell" "$install_dir/install.sh" update
expect "a release from OLEAFLY_RELEASE_URL is put in place" [ "$status" = 0 ]
expect "it says it didn't look" out_has "It came from OLEAFLY_RELEASE_URL, so the installer didn't look for a newer release."
finish

begin "on Amazon Linux, prints Amazon's Docker steps instead of offering Docker's script"
os_release amzn fedora 2023 'Amazon Linux 2023.8.20250915'
terminal "$installer_shell /stub/install-0.1.0.sh"
expect_status 1
expect "the distribution is named" out_has "Docker's install script doesn't support Amazon Linux 2023.8.20250915."
expect "Amazon's package is used" out_has 'install -y docker'
expect "Docker is turned on" out_has 'sudo systemctl enable --now docker'
expect "the Compose plugin comes from the pinned release" out_has "releases/download/$compose_pin/docker-compose-linux-$compose_arch"
expect "the plugin is checked against the pinned checksum" out_has "echo '$compose_pin_sha256  docker-compose-linux-$compose_arch' | sha256sum -c"
expect "the plugin goes where Docker finds it" out_has '/usr/local/lib/docker/cli-plugins/docker-compose'
expect "Docker's script isn't offered" out_lacks 'Install Docker now?'
expect "Docker's script wasn't downloaded" log_lacks 'docker-install'
finish

begin "on AlmaLinux and Oracle Linux, prints the steps for Docker's CentOS packages"
for distro in 'almalinux|rhel centos fedora|9.6|AlmaLinux 9.6 (Sage Margay)' 'ol|fedora|9.6|Oracle Linux Server 9.6'; do
	IFS='|' read -r id like version name <<EOF
$distro
EOF
	os_release "$id" "$like" "$version" "$name"
	run_full "$installer_shell" /stub/install-0.1.0.sh --yes
	expect "$id stops" [ "$status" = 1 ]
	expect "$id is named" out_has "Docker's install script doesn't support $name."
	expect "$id gets Docker's CentOS repository" out_has 'sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo'
	expect "$id gets the Compose plugin package" out_has 'docker-ce docker-ce-cli containerd.io docker-compose-plugin'
	expect "$id isn't sent to Docker's script" out_lacks 'get.docker.com'
done
finish

begin "on an unknown distribution, points to Docker's instructions"
os_release arch '' '' 'Arch Linux'
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the distribution is named" out_has "Docker's install script doesn't support Arch Linux."
expect "Docker's instructions are linked" out_has 'https://docs.docker.com/engine/install/'
finish

begin "Debian and Ubuntu derivatives still get Docker's script"
touch /stub/state/https-ok
os_release linuxmint 'ubuntu debian' 22 'Linux Mint 22'
run_full OLEAFLY_INSTALL_DOCKER=yes "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "Docker's script ran" log_has 'docker install script ran'
finish

begin "names the Compose package that exists on each distribution"
all_good
touch /stub/state/compose-missing
os_release debian '' 12 'Debian GNU/Linux 12 (bookworm)'
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "Debian 12 stops" [ "$status" = 1 ]
expect "Debian 12 gets the plugin from Docker's releases" out_has "releases/download/$compose_pin/docker-compose-linux-"
expect "Debian 12 isn't offered a package it doesn't have" out_lacks 'apt-get install'
os_release debian '' 13 'Debian GNU/Linux 13 (trixie)'
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "Debian 13 gets its own package" out_line '  sudo apt-get install docker-compose'
expect "Debian 13 isn't sent to Docker's releases" out_lacks 'sha256sum -c'
os_release fedora '' 42 'Fedora Linux 42 (Server Edition)'
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "Fedora gets its own package" out_line '  sudo dnf install docker-compose'
os_release amzn fedora 2023 'Amazon Linux 2023'
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "Amazon Linux gets the plugin from Docker's releases" out_has '/usr/local/lib/docker/cli-plugins/docker-compose'
os_release ubuntu debian 24.04 'Ubuntu 24.04.3 LTS'
cat >/stub/bin/dpkg <<'EOF'
#!/bin/sh
echo 'Package: docker-ce-cli'
echo 'Status: install ok installed'
EOF
chmod 755 /stub/bin/dpkg
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
rm -f /stub/bin/dpkg
expect "Docker's own packages get Docker's plugin" out_line '  sudo apt-get install docker-compose-plugin'
finish

begin "behind NAT, the HTTPS note says to forward the ports or use a tunnel"
all_good
rm -f /stub/state/https-ok
echo '10.0.0.5 ' >/stub/state/local-ips
echo 203.0.113.10 >/stub/state/public-ip4
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "the firewall line is shown" out_has 'Check that TCP ports 80 and 443 and UDP port 443 are open'
expect "port forwarding is named" out_has 'Forward TCP ports 80 and 443 to it'
expect "the tunnel guide is linked" out_has 'https://oleafly.com/docs/collaboration/server/#without-a-public-address'
finish

begin "reads settings from OLEAFLY_ANSWERS_FILE without eval, and the environment comes first"
all_good
odd_secret="p\$ss \`touch /stub/state/ran-answers\` \$(touch /stub/state/ran-answers) \"q\" x"
cat >/stub/answers.env <<EOF
# answers for the lab server
OLEAFLY_DOMAIN=collab.example.org
  OLEAFLY_SERVER_NAME='Smith Lab'
export OLEAFLY_GITHUB_CLIENT_ID=Ov23liAnswers
OLEAFLY_GITHUB_CLIENT_SECRET='$odd_secret'
OLEAFLY_MAX_PROJECT_MB=150

EOF
printf 'OLEAFLY_MAX_FILE_MB=40\r\n' >>/stub/answers.env
run OLEAFLY_ANSWERS_FILE=/stub/answers.env OLEAFLY_MAX_PROJECT_MB=120 "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "the domain is read" env_has 'OLEAFLY_DOMAIN=collab.example.org'
expect "a quoted value is unquoted" env_has "OLEAFLY_SERVER_NAME='Smith Lab'"
expect "an export line is read" env_has 'OLEAFLY_GITHUB_CLIENT_ID=Ov23liAnswers'
expect "the secret is kept character for character" env_has "OLEAFLY_GITHUB_CLIENT_SECRET='$odd_secret'"
expect "nothing in the file ran" [ ! -e /stub/state/ran-answers ]
expect "the environment comes first" env_has 'OLEAFLY_MAX_PROJECT_MB=120'
expect "a Windows line ending is dropped" env_has 'OLEAFLY_MAX_FILE_MB=40'
expect "the secret isn't printed" out_lacks "p\$ss"
finish

begin "refuses an answers file line it can't read, without printing the line"
all_good
printf 'OLEAFLY_DOMAIN=collab.example.org\nthis-is-a-secret-without-a-name\n' >/stub/answers.env
run OLEAFLY_ANSWERS_FILE=/stub/answers.env "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the line number is named" out_has "Line 2 of /stub/answers.env isn't a setting"
expect "the line itself isn't printed" out_lacks 'this-is-a-secret'
printf 'PATH=/tmp/elsewhere\n' >/stub/answers.env
run OLEAFLY_ANSWERS_FILE=/stub/answers.env "$installer_shell" /stub/install-0.1.0.sh --yes
expect "a name the installer doesn't read is refused" [ "$status" = 1 ]
expect "the name is given" out_has "sets PATH, which the installer doesn't read."
run OLEAFLY_ANSWERS_FILE=/stub/missing.env "$installer_shell" /stub/install-0.1.0.sh --yes
expect "a missing file is refused" [ "$status" = 1 ]
expect "the path is named" out_has 'OLEAFLY_ANSWERS_FILE is /stub/missing.env'
finish

begin "deleting the data names the bucket and Litestream copies that stay, and keeps Caddy's certificates"
all_good
run_full OLEAFLY_BLOB_STORE=s3://lab-bucket/oleafly OLEAFLY_S3_ACCESS_KEY_ID=AKIAEXAMPLE OLEAFLY_S3_SECRET_ACCESS_KEY=s3-secret \
	LITESTREAM_REPLICA_URL=s3://lab-backups/oleafly-server "$installer_shell" /stub/install-0.1.0.sh --yes
run "$installer_shell" /stub/install-0.1.1.sh update
expect "the update made a copy to delete later" [ -n "$(ls -A "$install_dir/backups")" ]
: >/stub/log
terminal "$installer_shell /stub/install-0.1.1.sh uninstall" \
	"Stop and remove the containers? [y/N] " "y" \
	"To delete the data and settings, type delete. To keep them, press Enter: " "delete"
expect_status 0
expect "the bucket is named before the question" out_has 'Files and snapshots in s3://lab-bucket/oleafly stay. Delete them in your storage provider.'
expect "the Litestream copies are named" out_has 'The database copies in s3://lab-backups/oleafly-server stay.'
expect "only the data volume was removed" log_has 'volume rm oleafly-server_oleafly-data'
expect "compose didn't remove every volume" log_lacks 'down --volumes'
expect "the copies made before updates are gone" [ ! -e "$install_dir/backups" ]
expect "the previous files are gone" [ ! -e "$install_dir/docker-compose.yml.previous" ]
expect "the folder is gone" [ ! -e "$install_dir" ]
expect "Caddy's certificates are kept" out_has "Caddy's certificates stay in the Docker volumes"
finish

begin "stops early on a machine without IPv4, unless DNS64 reaches GitHub"
all_good
printf 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n' >/stub/sys/proc/net/route
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the problem is named" out_has 'This machine has no IPv4 connection.'
expect "nothing was downloaded" log_lacks 'SHA256SUMS'
expect "nothing was installed" [ ! -e "$install_dir" ]
echo 64:ff9b::8c52:7903 >/stub/state/dns-github.com
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "NAT64 with DNS64 carries on" [ "$status" = 0 ]
finish

begin "refuses WSL with a clear reason"
all_good
echo 5.15.167.4-microsoft-standard-WSL2 >/stub/sys/proc/sys/kernel/osrelease
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "WSL is named" out_has 'This is WSL on Windows.'
expect "the docs are linked" out_has '#on-windows-or-macos'
expect "Docker wasn't touched" log_lacks 'docker '
finish

begin "a failed download under sudo mentions proxy settings"
all_good
touch /stub/state/offline
run_full SUDO_USER=labadmin "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "the download failure is named" out_has "Couldn't download SHA256SUMS"
expect "sudo dropping proxies is explained" out_has 'sudo drops proxy settings.'
run_full SUDO_USER=labadmin https_proxy=http://proxy.example.edu:3128 "$installer_shell" /stub/install-0.1.0.sh --yes
expect "with a proxy set, there's no hint" out_lacks 'sudo drops proxy settings.'
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "without sudo, there's no hint" out_lacks 'sudo drops proxy settings.'
finish

begin "a .env without the other files is repaired, not refused"
all_good
mkdir -p "$install_dir"
printf 'OLEAFLY_DOMAIN=collab.example.org\nOLEAFLY_GITHUB_CLIENT_ID=id\nOLEAFLY_GITHUB_CLIENT_SECRET=secret\n' >"$install_dir/.env"
chmod 600 "$install_dir/.env"
run "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "it says what it found" out_has "Found $install_dir/.env without the other files."
expect "the compose file is in place" grep -q 'oleafly-server:0.1.0$' "$install_dir/docker-compose.yml"
expect ".env is kept" env_has 'OLEAFLY_GITHUB_CLIENT_SECRET=secret'
expect "the server was started" [ -f /stub/state/up ]
rm -rf "$install_dir"
mkdir -p "$install_dir"
printf 'OLEAFLY_GITHUB_CLIENT_ID=id\nOLEAFLY_GITHUB_CLIENT_SECRET=secret' >"$install_dir/.env"
run OLEAFLY_DOMAIN=collab.example.org "$installer_shell" /stub/install-0.1.0.sh --yes
expect "a missing domain comes from the environment" [ "$status" = 0 ]
expect "the domain is added to .env" env_has 'OLEAFLY_DOMAIN=collab.example.org'
expect "the last line stays whole" env_has 'OLEAFLY_GITHUB_CLIENT_SECRET=secret'
finish

begin "the DNS check skips loopback, link-local and Docker addresses"
all_good
echo 127.0.1.1 >/stub/state/dns
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "a loopback answer is explained" out_has '/etc/hosts maps collab.example.org to this machine'
expect "it isn't counted as a match" out_lacks 'points to this machine (127.0.1.1)'
expect "there's no mismatch warning" out_lacks 'points to 127.0.1.1, and this machine is'
rm -rf "$install_dir"
echo 198.51.100.7 >/stub/state/dns
cat >/stub/state/ip-addr <<'EOF'
1: lo    inet 127.0.0.1/8 scope host lo\       valid_lft forever preferred_lft forever
2: eth0    inet 10.0.0.5/24 brd 10.0.0.255 scope global eth0\       valid_lft forever preferred_lft forever
3: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\       valid_lft forever preferred_lft forever
4: br-1a2b3c4d5e6f    inet 172.18.0.1/16 brd 172.18.255.255 scope global br-1a2b3c4d5e6f\       valid_lft forever preferred_lft forever
1: lo    inet6 ::1/128 scope host \       valid_lft forever preferred_lft forever
2: eth0    inet6 fe80::1/64 scope link \       valid_lft forever preferred_lft forever
EOF
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "the note lists only this machine's own address" out_has 'collab.example.org points to 198.51.100.7, and this machine is 10.0.0.5.'
finish

begin "status shows the current setup code until someone finishes setup"
all_good
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
echo '2026-10-14T09:00:00.000000Z  INFO Setup code: WXYZ-WXYZ-WXYZ-WXYZ. This server has no admin yet.' >/stub/state/server-log
run "$installer_shell" /stub/install-0.1.0.sh status
expect_status 0
expect "the newest code is shown" out_has 'Setup code: WXYZ-WXYZ-WXYZ-WXYZ'
expect "it says the code changes" out_has 'The code is new each time the server starts.'
touch /stub/state/has-admin
run "$installer_shell" /stub/install-0.1.0.sh status
expect "no code once there is an admin" out_lacks 'Setup code'
finish

begin "turns on IPv6 for the Compose network with a public IPv6 address and Docker 27 or newer"
all_good
printf '%s\n' '00000000000000000000000000000001 01 80 10 80       lo' '20010db8000000000000000000000010 02 40 00 00     eth0' >/stub/sys/proc/net/if_inet6
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 0
expect "IPv6 is on" env_has 'OLEAFLY_IPV6=true'
expect "the summary says so" out_line '  IPv6: On'
rm -rf "$install_dir"
echo 26.1.5 >/stub/state/docker-version
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "older Docker keeps IPv6 off" env_has 'OLEAFLY_IPV6='
expect "the summary doesn't mention IPv6" out_lacks 'IPv6: On'
rm -rf "$install_dir" /stub/state/docker-version
default_sys
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect "a machine without a public IPv6 address keeps it off" env_has 'OLEAFLY_IPV6='
finish

begin "a network that can't get IPv6 says how to turn IPv6 off"
all_good
printf '%s\n' '20010db8000000000000000000000010 02 40 00 00     eth0' >/stub/sys/proc/net/if_inet6
echo 'Error response from daemon: could not find an available, non-overlapping IPv6 address pool among the defaults to assign to the network' >/stub/state/up-fails
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "it says how to turn IPv6 off" out_has "Set OLEAFLY_IPV6=false in $install_dir/.env, then run the installer again."
rm -rf "$install_dir"
echo 'Error response from daemon: driver failed programming external connectivity: Bind for 0.0.0.0:443 failed: port is already allocated' >/stub/state/up-fails
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "another failure doesn't blame IPv6" out_lacks 'OLEAFLY_IPV6=false'
finish

begin "the pinned commit of Docker's script has the checksum install.sh expects"
expect "the commit is a full git hash, got '$docker_pin'" sh -c "printf '%s\n' '$docker_pin' | grep -Eqx '[0-9a-f]{40}'"
expect "the checksum is a SHA-256, got '$docker_pin_sha256'" sh -c "printf '%s\n' '$docker_pin_sha256' | grep -Eqx '[0-9a-f]{64}'"
command -v curl >/dev/null 2>&1 || install_packages curl ca-certificates
rm -f /stub/docker-install.sh
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o /stub/docker-install.sh "$docker_pin_url" >"$out" 2>&1
status=$?
expect_status 0
expect "the download has the pinned checksum" [ "$(sha256sum /stub/docker-install.sh | awk '{ print $1 }')" = "$docker_pin_sha256" ]
finish

begin "the pinned Compose plugin release has the checksums install.sh expects"
expect "the version is a release tag, got '$compose_pin'" sh -c "printf '%s\n' '$compose_pin' | grep -Eqx 'v[0-9]+[.][0-9]+[.][0-9]+'"
command -v curl >/dev/null 2>&1 || install_packages curl ca-certificates
for pair in "x86_64 $compose_pin_x86_64" "aarch64 $compose_pin_aarch64"; do
	arch=${pair%% *}
	pinned=${pair#* }
	expect "the $arch checksum is a SHA-256, got '$pinned'" sh -c "printf '%s\n' '$pinned' | grep -Eqx '[0-9a-f]{64}'"
	published=$(curl -fsSL --proto '=https' --tlsv1.2 --retry 3 "https://github.com/docker/compose/releases/download/$compose_pin/docker-compose-linux-$arch.sha256" 2>"$out" | awk '{ print $1 }')
	expect "the $arch checksum matches the release's .sha256, got '$published'" [ "$published" = "$pinned" ]
done
finish

printf '\n%s passed, %s failed\n' "$passed" "$failed"
if [ "$failed" -gt 0 ]; then
	printf 'Failed:%s\n' "$failures"
	exit 1
fi
