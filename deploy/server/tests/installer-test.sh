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
	for tool in curl systemctl service getent hostname ss sleep; do
		cp "$src/tests/stubs/$tool" "/stub/bin/$tool"
	done
	cp "$src/tests/stubs/docker" /stub/bin/docker.real
	cp "$src/tests/stubs/get-docker.sh" /stub/get-docker.sh
	chmod 755 /stub/bin/* /stub/get-docker.sh
	docker_stub_sha256=$(sha256sum /stub/get-docker.sh | awk '{ print $1 }')
	make_release 0.1.0
	make_release 0.1.1
	cp -R /stub/releases/server-v0.1.1 /stub/releases/latest
	cp "$src/install.sh" /stub/install-unreleased.sh
	chmod 755 /stub /stub/releases
	chmod 644 /stub/install-unreleased.sh
}

begin() {
	scenario=$1
	scenario_failed=0
	rm -rf /stub/state "$install_dir" "$out" "$typescript" "$exit_file"
	mkdir -p /stub/state
	: >/stub/log
	rm -f /stub/late/docker
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
	env -i PATH="$stub_path" HOME=/root OLEAFLY_DIR="$install_dir" "$@" >"$out" 2>&1
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
	command_line="env -i PATH=$stub_path HOME=/root TERM=dumb OLEAFLY_DIR=$install_dir $1"
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
expect "HTTPS is confirmed" out_has 'https://collab.example.org answers with a valid certificate.'
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
expect "the Caddyfile is the release's again" cmp -s "$install_dir/Caddyfile" /stub/releases/server-v0.1.0/Caddyfile
expect "it says it found the server" out_has "Found a server in $install_dir."
expect "it uses the domain from .env" out_has 'https://collab.example.org answers'
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
run "$installer_shell" /stub/install-0.1.0.sh update
expect "an older release is refused" [ "$status" = 1 ]
expect "the refusal says why" out_has 'This server runs 0.1.1, which is newer than this release (0.1.0). Nothing was changed.'
expect "the compose file still names 0.1.1" grep -q 'image: ghcr.io/oleafly/oleafly-server:0.1.1$' "$install_dir/docker-compose.yml"
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
expect "Docker's package name is shown" out_has 'docker-compose-plugin'
expect "Ubuntu's package name is shown" out_has 'docker-compose-v2'
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

begin "says when Docker can't download the images"
all_good
touch /stub/state/pull-fails
run_full "$installer_shell" /stub/install-0.1.0.sh --yes
expect_status 1
expect "Docker's message is shown" out_has 'pull access denied'
expect "the problem is named" out_has "Docker couldn't download the images."
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
expect "HTTPS answers" out_has 'https://collab.example.org answers with a valid certificate.'
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
expect "the volumes are removed" [ -f /stub/state/volumes-removed ]
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
dd if=/stub/install-0.1.0.sh bs=512 2>/dev/null | env -i PATH="$stub_path" HOME=/root OLEAFLY_DIR="$install_dir" \
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
setpriv --reuid=65534 --regid=65534 --clear-groups env -i PATH="$stub_path" HOME=/tmp OLEAFLY_DIR="$install_dir" \
	OLEAFLY_DOMAIN=collab.example.org "$installer_shell" /stub/install-0.1.0.sh --yes >"$out" 2>&1
status=$?
expect_status 1
expect "root is asked for" out_has 'Run it as root, or install sudo first.'
finish

begin "a normal user with sudo can install, and secrets stay out of the output"
all_good
if ! command -v sudo >/dev/null 2>&1; then
	apt-get update -qq >/dev/null 2>&1
	DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sudo >/dev/null 2>&1
fi
id labadmin >/dev/null 2>&1 || useradd -m labadmin
printf 'Defaults secure_path="%s"\nlabadmin ALL=(ALL) NOPASSWD: ALL\n' "$stub_path" >/etc/sudoers.d/labadmin
chmod 440 /etc/sudoers.d/labadmin
chmod 777 /stub/state
chmod 666 /stub/log
uid=$(id -u labadmin)
gid=$(id -g labadmin)
setpriv --reuid="$uid" --regid="$gid" --init-groups env -i PATH="$stub_path" HOME=/home/labadmin OLEAFLY_DIR="$install_dir" \
	OLEAFLY_DOMAIN=collab.example.org OLEAFLY_GITHUB_CLIENT_ID=id OLEAFLY_GITHUB_CLIENT_SECRET=user-secret \
	"$installer_shell" /stub/install-0.1.0.sh --yes >"$out" 2>&1
status=$?
expect_status 0
expect ".env is still root-only" [ "$(file_mode "$install_dir/.env")" = '600 0 0' ]
expect "the release files belong to root" [ "$(stat -c %u "$install_dir/docker-compose.yml")" = 0 ]
expect "compose ran as root" state_is compose-uid 0
expect "the secret isn't printed" out_lacks 'user-secret'
setpriv --reuid="$uid" --regid="$gid" --init-groups env -i PATH="$stub_path" HOME=/home/labadmin OLEAFLY_DIR="$install_dir" \
	"$installer_shell" /stub/install-0.1.0.sh status >"$out" 2>&1
status=$?
expect "status works through sudo, got $status" [ "$status" = 0 ]
rm -f /etc/sudoers.d/labadmin
finish

begin "the pinned commit of Docker's script has the checksum install.sh expects"
expect "the commit is a full git hash, got '$docker_pin'" sh -c "printf '%s\n' '$docker_pin' | grep -Eqx '[0-9a-f]{40}'"
expect "the checksum is a SHA-256, got '$docker_pin_sha256'" sh -c "printf '%s\n' '$docker_pin_sha256' | grep -Eqx '[0-9a-f]{64}'"
if ! command -v curl >/dev/null 2>&1; then
	apt-get update -qq >/dev/null 2>&1
	DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null 2>&1
fi
rm -f /stub/docker-install.sh
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o /stub/docker-install.sh "$docker_pin_url" >"$out" 2>&1
status=$?
expect_status 0
expect "the download has the pinned checksum" [ "$(sha256sum /stub/docker-install.sh | awk '{ print $1 }')" = "$docker_pin_sha256" ]
finish

printf '\n%s passed, %s failed\n' "$passed" "$failed"
if [ "$failed" -gt 0 ]; then
	printf 'Failed:%s\n' "$failures"
	exit 1
fi
