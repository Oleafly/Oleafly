#!/bin/sh
set -eu

installer_version=unreleased
release_repo=Oleafly/oleafly-server
release_files='install.sh docker-compose.yml Caddyfile env.example litestream.yml'
install_url=https://oleafly.com/server/install.sh
docs_url=https://oleafly.com/docs/collaboration/server/
operations_url=https://oleafly.com/docs/collaboration/server-operations/
issues_url=https://github.com/Oleafly/oleafly-server/issues
docker_script_commit=ada7a567e59b3935bd601bb21e422da50e80e376
docker_script_sha256=2b102d809152ea157a59f171319f489d971273b2d26dd7e9a6d1d737ce89289d
docker_script_url=https://raw.githubusercontent.com/docker/docker-install/$docker_script_commit/install.sh
# The Compose plugin release the printed steps download, with the checksums
# from that release's .sha256 files.
compose_plugin_version=v5.5.1
compose_plugin_sha256_x86_64=db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576
compose_plugin_sha256_aarch64=732e3a84c1a0f67256ce80bc2598a24546b10ca05f9faa97efceb1171ece2ef7

dir=${OLEAFLY_DIR:-/opt/oleafly-server}
data_volume=oleafly-server_oleafly-data
sysroot=${OLEAFLY_TEST_SYSROOT:-}
noninteractive=0
test_local_tls=0
sudo_cmd=
tmp=
tty_state=
tty_known=
command_name=install
https_ok=0
domain=
dns_via=
server_name=
github_on=0
oidc_list=
email_summary=Off
files_summary='On this machine'
engine=
before=
release_version=
latest_checked=0
container_before=
restarts_before=0
rollback=
ipv6_on=0
stopped_for_backup=0

print_help() {
	cat <<EOF
Oleafly Server installer

Sets up Oleafly Server with Docker, with Caddy in front for HTTPS.

Usage:
  curl -fsSL $install_url | sudo sh
  curl -fsSL $install_url | sudo sh -s -- [command] [--yes]
  sudo sh $dir/install.sh [command] [--yes]

Commands:
  install     Set up the server, or repair an existing setup. This is the default.
  update      Get this release's files and image, keep .env, and restart.
              When the version changes, it copies the data to backups first.
  status      Show whether the server is running and answers over HTTPS,
              and the setup code until someone finishes setup.
  uninstall   Stop and remove the containers. Data stays unless you confirm deleting it.

Options:
  -y, --yes   Don't ask questions. Read the settings from environment variables
              or from OLEAFLY_ANSWERS_FILE.
  --version   Show the installer version.
  --help      Show this help.

Settings for --yes:
  OLEAFLY_DOMAIN                     The domain people enter in Oleafly, such as
                                     collab.example.org. Required.
  OLEAFLY_SERVER_NAME                The name people see in Oleafly.
                                     Default: Oleafly Server
  OLEAFLY_GITHUB_CLIENT_ID           Sign-in with GitHub: the OAuth app's client ID
  OLEAFLY_GITHUB_CLIENT_SECRET       and its client secret.
  OLEAFLY_OIDC_<NAME>_ISSUER         Sign-in with OpenID Connect, for example
  OLEAFLY_OIDC_<NAME>_CLIENT_ID      OLEAFLY_OIDC_UNIVERSITY_ISSUER. NAME is letters
  OLEAFLY_OIDC_<NAME>_CLIENT_SECRET  and digits. The label is the text on the
  OLEAFLY_OIDC_<NAME>_LABEL          sign-in button and is optional.
  OLEAFLY_SMTP_HOST                  Email, optional: the mail server,
  OLEAFLY_SMTP_PORT                  its port (default 465),
  OLEAFLY_SMTP_USER                  the user name,
  OLEAFLY_SMTP_PASSWORD              the password,
  OLEAFLY_MAIL_FROM                  and the From address.
  OLEAFLY_SMTP_URL                   A full smtps:// or smtp:// address, in place of
                                     the host, port, user and password.
  OLEAFLY_BLOB_STORE                 Files in a bucket, optional: s3://bucket or
                                     s3://bucket/folder. Needs OLEAFLY_S3_ACCESS_KEY_ID
                                     and OLEAFLY_S3_SECRET_ACCESS_KEY, and takes
                                     OLEAFLY_S3_REGION and OLEAFLY_S3_ENDPOINT.

  Set at least one sign-in provider. Any other setting in .env.example can be
  set the same way. Settings found in the environment are used without asking,
  with or without --yes.

Installer settings:
  OLEAFLY_DIR                The folder to install into. Default: /opt/oleafly-server
  OLEAFLY_NONINTERACTIVE=1   The same as --yes.
  OLEAFLY_INSTALL_DOCKER=yes With --yes, install Docker with Docker's own script
                             if it's missing.
  OLEAFLY_RELEASE_URL        Download the release files from this https:// or
                             file:// address instead of GitHub.
  OLEAFLY_ANSWERS_FILE       Read settings from this file, one KEY=VALUE per
                             line. Settings in the environment come first.
                             Secrets on a sudo command line end up in the
                             system log, and a file keeps them out of it.

More help: $docs_url
EOF
}

version_label() {
	if [ "$installer_version" = unreleased ]; then
		printf '%s' 'unreleased copy, installs the latest release'
	else
		printf '%s' "$installer_version"
	fi
}

say() {
	printf '%s\n' "$*"
}

heading() {
	printf '\n%s\n' "$*"
}

item() {
	printf '  %s\n' "$*"
}

note() {
	printf '  Note: %s\n' "$*"
}

fail() {
	printf '\n%s\n' "$1" >&2
	shift
	for line in "$@"; do
		printf '%s\n' "$line" >&2
	done
	exit 1
}

cleanup() {
	if [ -n "$tty_state" ]; then
		stty "$tty_state" </dev/tty 2>/dev/null || true
	fi
	if [ -n "$tmp" ] && [ -d "$tmp" ]; then
		rm -rf "$tmp"
	fi
}

have_tty() {
	if [ -z "$tty_known" ]; then
		if (: </dev/tty) 2>/dev/null; then
			tty_known=yes
		else
			tty_known=no
		fi
	fi
	[ "$tty_known" = yes ]
}

need_input() {
	if [ "$noninteractive" = 1 ]; then
		fail "$1 is not set." "With --yes, the installer reads its settings from environment variables. Run it with --help to see them."
	fi
	have_tty || fail "There's no terminal to answer questions on." "Run it again with --yes and the settings as environment variables. Run it with --help to see them."
}

ask() {
	printf '%s' "$1" >/dev/tty
	reply=
	IFS= read -r reply </dev/tty || [ -n "$reply" ] || fail "No answer came in, so the installer stopped."
}

ask_secret() {
	reply=
	tty_state=$(stty -g </dev/tty 2>/dev/null) || tty_state=
	stty -echo </dev/tty 2>/dev/null || true
	printf '%s' "$1" >/dev/tty
	IFS= read -r reply </dev/tty || [ -n "$reply" ] || fail "No answer came in, so the installer stopped."
	if [ -n "$tty_state" ]; then
		stty "$tty_state" </dev/tty 2>/dev/null || true
		tty_state=
	fi
	printf '\n' >/dev/tty
}

confirm() {
	while :; do
		ask "$1"
		case $reply in
			[Yy] | [Yy][Ee][Ss]) return 0 ;;
			[Nn] | [Nn][Oo]) return 1 ;;
			'') [ "$2" = y ] && return 0 || return 1 ;;
		esac
		printf '  Answer y or n.\n' >/dev/tty
	done
}

tell() {
	printf '  %s\n' "$*" >/dev/tty
}

as_root() {
	if [ -n "$sudo_cmd" ]; then
		sudo "$@"
	else
		"$@"
	fi
}

docker_cmd() {
	as_root env -i PATH="$PATH" HOME=/root ${DOCKER_HOST:+"DOCKER_HOST=$DOCKER_HOST"} docker "$@" </dev/null
}

compose() {
	(cd "$dir" && docker_cmd compose "$@")
}

has_space() {
	case $1 in
		*' '* | *'	'*) return 0 ;;
	esac
	return 1
}

env_quote() {
	case $1 in
		*[!A-Za-z0-9._:/@+,=%-]* | '') ;;
		*)
			printf '%s' "$1"
			return 0
			;;
	esac
	case $1 in
		*\'*)
			case $1 in
				*[\"\\\$\`]*) return 1 ;;
			esac
			printf '"%s"' "$1"
			;;
		*) printf "'%s'" "$1" ;;
	esac
}

env_unquote() {
	sed -e "s/^'\\(.*\\)'\$/\\1/" -e 's/^"\(.*\)"$/\1/'
}

add_setting() {
	quoted=$(env_quote "$2") || fail "The value for $1 can't be written to .env, because it mixes quotes with \$, \\ or \` characters." "Use a value without those characters."
	printf '%s=%s\n' "$1" "$quoted" >>"$tmp/settings"
}

urlencode() {
	printf '%s' "$1" | od -An -v -tx1 | awk '{
		for (i = 1; i <= NF; i++) {
			h = toupper($i)
			d = index("0123456789ABCDEF", substr(h, 1, 1)) * 16 + index("0123456789ABCDEF", substr(h, 2, 1)) - 17
			if ((d >= 48 && d <= 57) || (d >= 65 && d <= 90) || (d >= 97 && d <= 122) || d == 45 || d == 46 || d == 95 || d == 126)
				printf "%c", d
			else
				printf "%%%s", h
		}
	}'
}

lower() {
	printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

upper() {
	printf '%s' "$1" | tr '[:lower:]' '[:upper:]'
}

version_gt() {
	awk -v a="$1" -v b="$2" 'BEGIN {
		na = index(a, "-")
		nb = index(b, "-")
		split(na ? substr(a, 1, na - 1) : a, p, ".")
		split(nb ? substr(b, 1, nb - 1) : b, q, ".")
		for (i = 1; i <= 3; i++) {
			if (p[i] + 0 > q[i] + 0) exit 0
			if (p[i] + 0 < q[i] + 0) exit 1
		}
		if (!na || !nb) exit (!na && nb ? 0 : 1)
		np = split(substr(a, na + 1), pa, ".")
		nq = split(substr(b, nb + 1), pb, ".")
		for (i = 1; i <= np && i <= nq; i++) {
			an = pa[i] ~ /^[0-9]+$/
			bn = pb[i] ~ /^[0-9]+$/
			if (an && bn) {
				if (pa[i] + 0 != pb[i] + 0) exit (pa[i] + 0 > pb[i] + 0 ? 0 : 1)
			} else if (an != bn) {
				exit (an ? 1 : 0)
			} else if (pa[i] != pb[i]) {
				exit (pa[i] > pb[i] ? 0 : 1)
			}
		}
		exit (np > nq ? 0 : 1)
	}'
}

valid_version() {
	case $1 in
		*[!0-9A-Za-z.-]* | '') return 1 ;;
		[0-9]*.[0-9]*.[0-9]*) return 0 ;;
	esac
	return 1
}

compose_version() {
	sed -n 's|^[[:space:]]*image:[[:space:]]*[^[:space:]]*/oleafly-server:\([^[:space:]]*\)[[:space:]]*$|\1|p' "$1" 2>/dev/null | head -n 1
}

read_env_value() {
	as_root sed -n "s/^$1=//p" "$dir/.env" 2>/dev/null | tail -n 1 | env_unquote
}

os_value() {
	for file in "$sysroot/etc/os-release" "$sysroot/usr/lib/os-release"; do
		if [ -r "$file" ]; then
			sed -n "s/^$1=//p" "$file" | tail -n 1 | env_unquote
			return 0
		fi
	done
}

read_distro() {
	distro_id=$(os_value ID)
	distro_like=$(os_value ID_LIKE)
	distro_version=$(os_value VERSION_ID)
	distro_name=$(os_value PRETTY_NAME)
	[ -n "$distro_name" ] || distro_name=${distro_id:-this Linux distribution}
}

is_wsl() {
	grep -qi microsoft "$sysroot/proc/sys/kernel/osrelease" 2>/dev/null
}

has_ipv4_route() {
	[ -r "$sysroot/proc/net/route" ] || return 0
	awk 'NR > 1 && $2 == "00000000" { found = 1 } END { exit !found }' "$sysroot/proc/net/route"
}

check_ipv4() {
	has_ipv4_route && return 0
	if resolve_domain github.com | grep -q ':'; then
		return 0
	fi
	fail "This machine has no IPv4 connection. GitHub, where the release files and the server image live, only works over IPv4." "Give this machine an IPv4 address, or use NAT64 with DNS64, then run the installer again."
}

check_platform() {
	heading "Checking this machine"
	os=$(uname -s)
	[ "$os" = Linux ] || fail "Oleafly Server runs on Linux, and this machine runs $os." "Use a Linux server or virtual machine, such as one with Ubuntu 24.04 or Debian 13. Read ${docs_url}#on-windows-or-macos"
	if is_wsl; then
		fail "This is WSL on Windows. It stops when Windows sleeps, and other computers can't reach it." "Run the server on a Linux server or virtual machine. Read ${docs_url}#on-windows-or-macos"
	fi
	arch=$(uname -m)
	case $arch in
		x86_64 | amd64) arch=x86_64 ;;
		aarch64 | arm64) arch=aarch64 ;;
		*) fail "Oleafly Server runs on x86-64 and ARM (aarch64) machines. This one is $arch." ;;
	esac
	for tool in curl awk sed od tr mktemp sha256sum install printenv; do
		command -v "$tool" >/dev/null 2>&1 || fail "This installer needs $tool, which isn't installed." "Install it with your package manager and run the installer again."
	done
	check_ipv4
	item "Linux on $arch."
}

check_root() {
	if [ "$(id -u)" = 0 ]; then
		return 0
	fi
	command -v sudo >/dev/null 2>&1 || fail "The installer needs root to set up Docker and write to $dir." "Run it as root, or install sudo first."
	if [ "$noninteractive" = 1 ]; then
		sudo -n true 2>/dev/null || fail "The installer needs root. sudo asks for a password, and --yes can't give one." "Run it as root, or pipe it to sudo: curl -fsSL $install_url | sudo sh -s -- --yes"
	else
		item "Some steps need root. sudo may ask for your password."
		sudo -v || fail "The installer needs root, and sudo didn't allow it." "Run it as root, or as a user who can use sudo."
	fi
	sudo_cmd=sudo
}

busy_ports() {
	if command -v ss >/dev/null 2>&1; then
		as_root ss -ltnp 2>/dev/null | awk '$1 == "LISTEN" {
			n = split($4, a, ":")
			p = a[n]
			if (p == "80" || p == "443") {
				who = ""
				if (match($0, /users:\(\("[^"]+"/)) who = substr($0, RSTART + 9, RLENGTH - 10)
				print p " " who
			}
		}' | sort -u
	else
		cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4 == "0A" {
			split($2, a, ":")
			if (a[2] == "0050") print "80"
			if (a[2] == "01BB") print "443"
		}' | sort -u
	fi
}

check_ports() {
	busy=$(busy_ports) || busy=
	if [ -z "$busy" ]; then
		item "Ports 80 and 443 are free."
		return 0
	fi
	lines=$(printf '%s\n' "$busy" | awk '{
		if ($2 != "") print "  Port " $1 " is in use by " $2 "."
		else print "  Port " $1 " is in use."
	}')
	fail "Caddy needs ports 80 and 443 to get a certificate and serve HTTPS, but they aren't free." "$lines" "Stop the program that uses them, or use another machine, then run the installer again."
}

docker_ready() {
	docker_cmd info >/dev/null 2>&1
}

docker_script_supports() {
	case " $distro_id $distro_like " in
		*' ubuntu '* | *' debian '* | *' raspbian '*) return 0 ;;
	esac
	case $distro_id in
		centos | rhel | rocky | fedora | fedora-asahi-remix) return 0 ;;
	esac
	return 1
}

package_manager() {
	if command -v dnf >/dev/null 2>&1; then
		printf dnf
	else
		printf yum
	fi
}

compose_plugin_steps() {
	case $(uname -m) in
		aarch64 | arm64)
			compose_asset=docker-compose-linux-aarch64
			compose_sha256=$compose_plugin_sha256_aarch64
			;;
		*)
			compose_asset=docker-compose-linux-x86_64
			compose_sha256=$compose_plugin_sha256_x86_64
			;;
	esac
	printf '%s\n' "  curl -fLO https://github.com/docker/compose/releases/download/$compose_plugin_version/$compose_asset" \
		"  echo '$compose_sha256  $compose_asset' | sha256sum -c" \
		"  sudo install -D -m 755 $compose_asset /usr/local/lib/docker/cli-plugins/docker-compose"
}

docker_steps() {
	case " $distro_id $distro_like " in
		*' amzn '*)
			printf '%s\n' "  sudo $(package_manager) install -y docker" "  sudo systemctl enable --now docker"
			compose_plugin_steps
			;;
		*' rhel '* | *' centos '* | *' ol '*)
			printf '%s\n' "  sudo dnf install -y dnf-plugins-core" \
				"  sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo" \
				"  sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin" \
				"  sudo systemctl enable --now docker"
			;;
		*) return 1 ;;
	esac
}

compose_steps() {
	read_distro
	if dpkg -s docker-ce-cli 2>/dev/null | grep -q '^Status: install ok installed'; then
		printf '%s\n' "  sudo apt-get install docker-compose-plugin"
	elif rpm -q docker-ce-cli >/dev/null 2>&1; then
		printf '%s\n' "  sudo $(package_manager) install docker-compose-plugin"
	else
		case $distro_id in
			ubuntu) printf '%s\n' "  sudo apt-get install docker-compose-v2" ;;
			fedora) printf '%s\n' "  sudo dnf install docker-compose" ;;
			debian)
				case $distro_version in
					'' | 1[3-9]* | [2-9][0-9]*) printf '%s\n' "  sudo apt-get install docker-compose" ;;
					*) compose_plugin_steps ;;
				esac
				;;
			*) compose_plugin_steps ;;
		esac
	fi
}

install_docker() {
	read_distro
	if ! docker_script_supports; then
		if steps=$(docker_steps); then
			fail "Docker isn't installed, and Docker's install script doesn't support $distro_name." "Install Docker and its Compose plugin with these commands, then run the installer again:" "$steps"
		fi
		fail "Docker isn't installed, and Docker's install script doesn't support $distro_name." "Install Docker Engine and its Compose plugin with your distribution's packages, or follow https://docs.docker.com/engine/install/" "Then run the installer again."
	fi
	if [ "$noninteractive" = 1 ]; then
		case ${OLEAFLY_INSTALL_DOCKER:-} in
			yes | 1 | true) ;;
			*)
				fail "Docker isn't installed, and the server runs in Docker." "Install it with Docker's script, then run the installer again:" "  curl -fsSL https://get.docker.com | sudo sh" "Or set OLEAFLY_INSTALL_DOCKER=yes to let the installer run that script."
				;;
		esac
	else
		have_tty || fail "Docker isn't installed, and there's no terminal to ask about installing it." "Install it with: curl -fsSL https://get.docker.com | sudo sh" "Then run the installer again."
		tell "Docker isn't installed, and the server runs in Docker."
		tell "The installer can install it with Docker's own install script."
		tell "It downloads a known version of that script and checks it before running it."
		if ! confirm "  Install Docker now? [y/N] " n; then
			fail "Docker is needed. Install it with Docker's script, then run the installer again:" "  curl -fsSL https://get.docker.com | sudo sh" "Docker's other ways to install: https://docs.docker.com/engine/install/"
		fi
	fi
	item "Installing Docker with Docker's script. This takes a few minutes."
	if ! fetch "$docker_script_url" "$tmp/get-docker.sh"; then
		hint=$(proxy_hint)
		fail "Couldn't download Docker's install script from $docker_script_url." "Check this machine's network connection and try again. Nothing was changed." ${hint:+"$hint"}
	fi
	actual=$(sha256sum "$tmp/get-docker.sh" | awk '{ print $1 }')
	if [ "$actual" != "$docker_script_sha256" ]; then
		fail "Docker's install script doesn't match the checksum this installer expects, so the installer won't run it. Nothing was changed." "Try again in a few minutes. If it happens again, report it at $issues_url" "Docker's other ways to install: https://docs.docker.com/engine/install/"
	fi
	as_root env LOAD_SCRIPT_COMMIT_SHA="$docker_script_commit" sh "$tmp/get-docker.sh" </dev/null || fail "Docker's install script stopped with an error. Its output is above." "Docker's instructions for this system: https://docs.docker.com/engine/install/"
	command -v docker >/dev/null 2>&1 || fail "Docker's install script finished, but the docker command isn't there." "Docker's instructions for this system: https://docs.docker.com/engine/install/"
}

start_docker() {
	item "Docker is installed but not running. Starting it."
	if command -v systemctl >/dev/null 2>&1; then
		as_root systemctl enable --now docker >/dev/null 2>&1 || true
	fi
	if ! docker_ready && command -v service >/dev/null 2>&1; then
		as_root service docker start >/dev/null 2>&1 || true
	fi
	tries=0
	until docker_ready; do
		tries=$((tries + 1))
		if [ "$tries" -ge 30 ]; then
			fail "Docker didn't start." "See why with: sudo journalctl -u docker --no-pager -n 30" "Start it with: sudo systemctl start docker" "Then run the installer again."
		fi
		sleep 2
	done
}

ensure_docker() {
	if ! command -v docker >/dev/null 2>&1; then
		if [ "$1" = may_install ]; then
			install_docker
		else
			fail "Docker isn't installed on this machine, so there's no server to manage here."
		fi
	fi
	docker_ready || start_docker
	if ! docker_cmd compose version >/dev/null 2>&1; then
		fail "Docker is running, but the Docker Compose plugin isn't installed." "Install it with:" "$(compose_steps)" "Then run the installer again."
	fi
	engine=$(docker_cmd version --format '{{.Server.Version}}' 2>/dev/null) || engine=
	plugin=$(docker_cmd compose version --short 2>/dev/null) || plugin=
	item "Docker ${engine:-is running} with Compose ${plugin:-installed}."
	if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
		enabled=$(systemctl is-enabled docker 2>/dev/null || true)
		if [ -n "$enabled" ] && [ "$enabled" != enabled ]; then
			note "Docker doesn't start when this machine boots, so neither will the server. Turn that on with: sudo systemctl enable docker"
		fi
	fi
}

release_base() {
	if [ -n "${OLEAFLY_RELEASE_URL:-}" ]; then
		printf '%s' "${OLEAFLY_RELEASE_URL%/}"
	elif [ "$installer_version" = unreleased ]; then
		printf 'https://github.com/%s/releases/latest/download' "$release_repo"
	else
		printf 'https://github.com/%s/releases/download/server-v%s' "$release_repo" "$installer_version"
	fi
}

proxy_hint() {
	if [ -n "${SUDO_USER:-}" ] && [ -z "${https_proxy:-}${HTTPS_PROXY:-}" ]; then
		printf '%s' "sudo drops proxy settings. If this network needs a proxy, run the installer with: curl -fsSL $install_url | sudo https_proxy=\"\$https_proxy\" sh"
	fi
}

fetch() {
	case $1 in
		https://*) curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --connect-timeout 20 -o "$2" "$1" ;;
		file://*) curl -fsSL -o "$2" "$1" ;;
		*) return 1 ;;
	esac
}

download_release() {
	base=$(release_base)
	case $base in
		https://* | file://*) ;;
		*) fail "OLEAFLY_RELEASE_URL has to start with https:// or file://." ;;
	esac
	if [ "$installer_version" = unreleased ] && [ -z "${OLEAFLY_RELEASE_URL:-}" ]; then
		heading "Downloading the latest release"
	else
		heading "Downloading release ${installer_version#unreleased}"
	fi
	rm -rf "$tmp/release"
	mkdir "$tmp/release"
	for file in SHA256SUMS $release_files; do
		if ! fetch "$base/$file" "$tmp/release/$file"; then
			hint=$(proxy_hint)
			fail "Couldn't download $file from $base." "Check this machine's network connection and try again. Nothing was changed." ${hint:+"$hint"}
		fi
	done
	for file in $release_files; do
		expected=$(awk -v name="$file" '{ n = $2; sub(/^\*/, "", n); if (n == name) { print $1; exit } }' "$tmp/release/SHA256SUMS")
		[ -n "$expected" ] || fail "SHA256SUMS has no line for $file, so it can't be checked. Nothing was changed." "Report this at $issues_url"
		actual=$(sha256sum "$tmp/release/$file" | awk '{ print $1 }')
		if [ "$expected" != "$actual" ]; then
			fail "$file doesn't match its checksum in SHA256SUMS, so the installer won't use it. Nothing was changed." "Try again in a few minutes. If it happens again, report it at $issues_url"
		fi
	done
	release_version=$(compose_version "$tmp/release/docker-compose.yml")
	[ -n "$release_version" ] || fail "The release's docker-compose.yml doesn't name a server image. Nothing was changed." "Report this at $issues_url"
	item "Oleafly Server $release_version. All files match SHA256SUMS."
}

# Copies every release file to a folder inside the install first, and moves
# them into place only when all of them are there, so a full disk can't leave
# a truncated docker-compose.yml or files from two releases. placed is 1 once
# a file was replaced. set -e doesn't stop a function its caller tests with
# if or ||, so each step returns 1 itself.
place_release_files() {
	placed=0
	as_root mkdir -p "$dir" || return 1
	as_root chmod 755 "$dir" || return 1
	incoming=$dir/.release-incoming
	as_root rm -rf "$incoming" || return 1
	as_root mkdir -m 700 "$incoming" || return 1
	if ! stage_release_files "$incoming"; then
		as_root rm -rf "$incoming"
		return 1
	fi
	for file in docker-compose.yml Caddyfile litestream.yml .env.example install.sh; do
		as_root mv -f "$incoming/$file" "$dir/$file" || return 1
		placed=1
	done
	as_root rmdir "$incoming" || true
}

stage_release_files() {
	for file in docker-compose.yml Caddyfile litestream.yml; do
		as_root install -m 644 "$tmp/release/$file" "$1/$file" || return 1
	done
	as_root install -m 644 "$tmp/release/env.example" "$1/.env.example" || return 1
	as_root install -m 755 "$tmp/release/install.sh" "$1/install.sh" || return 1
}

# The files the update keeps as name.previous before it stops the server.
previous_files='docker-compose.yml Caddyfile litestream.yml install.sh'

restore_previous_files() {
	for file in $previous_files; do
		if [ -f "$dir/$file.previous" ]; then
			as_root cp -p "$dir/$file.previous" "$dir/$file" || return 1
		fi
	done
}

check_not_older() {
	installed=$(compose_version "$dir/docker-compose.yml") || installed=
	if [ -n "$installed" ] && version_gt "$installed" "$release_version"; then
		fail "This server runs $installed, which is newer than this release ($release_version). Nothing was changed." "Get the newest installer with: curl -fsSL $install_url | sudo sh -s update"
	fi
}

valid_domain() {
	candidate=$(lower "$1")
	candidate=${candidate#https://}
	candidate=${candidate#http://}
	candidate=${candidate%/}
	domain_problem=
	case $candidate in
		'') domain_problem='Enter a domain, such as collab.example.org.' ;;
		*/*) domain_problem='Enter only the domain, without a path, such as collab.example.org.' ;;
		*:*) domain_problem="Enter the domain without a port. Caddy serves it on ports 80 and 443." ;;
		*[!a-z0-9.-]*) domain_problem='A domain can only have letters, digits, dots and dashes.' ;;
		*[!0-9.]*) ;;
		*) domain_problem='Enter a domain name, not an IP address. Caddy needs a name to get a certificate.' ;;
	esac
	if [ -z "$domain_problem" ]; then
		case $candidate in
			localhost | *.localhost)
				if [ "$test_local_tls" != 1 ]; then
					domain_problem="Enter a public domain. Caddy can't get a public certificate for $candidate."
				fi
				;;
			*.*)
				if ! printf '%s' "$candidate" | awk -F. 'length($0) > 253 { exit 1 } {
					for (i = 1; i <= NF; i++) if ($i == "" || length($i) > 63 || $i ~ /^-/ || $i ~ /-$/) exit 1
					if ($NF ~ /^[0-9]+$/) exit 1
				}'; then
					domain_problem="$candidate isn't a valid domain."
				fi
				;;
			*) domain_problem='Enter a full domain with a dot in it, such as collab.example.org.' ;;
		esac
	fi
	[ -z "$domain_problem" ]
}

resolve_domain() {
	if command -v getent >/dev/null 2>&1; then
		getent ahosts "$1" 2>/dev/null | awk '{ print $1 }' | sort -u
	elif command -v host >/dev/null 2>&1; then
		host "$1" 2>/dev/null | awk '/has (IPv6 )?address/ { print $NF }' | sort -u
	fi
}

outside_addresses() {
	grep -Eiv '^(127\.|169\.254\.|0\.0\.0\.0$|::1?$|::ffff:127\.|fe[89ab][0-9a-f]:)' | sed '/^$/d' | sort -u
}

local_addresses() {
	found=$(ip -o addr show 2>/dev/null | awk '$2 != "lo" && $2 !~ /^(docker|br-|veth|virbr)/ && $0 !~ / scope (host|link) / {
		sub(/\/.*/, "", $4)
		print $4
	}') || found=
	if [ -z "$found" ]; then
		found=$(hostname -I 2>/dev/null | tr ' ' '\n') || found=
	fi
	printf '%s\n' "$found" | outside_addresses
}

public_addresses() {
	{
		curl -4 -fsS --max-time 5 https://ifconfig.me/ip 2>/dev/null && echo
		curl -6 -fsS --max-time 5 https://ifconfig.me/ip 2>/dev/null && echo
	} | sed '/^$/d' | sort -u
}

any_shared() {
	for address in $1; do
		if printf '%s\n' "$2" | grep -Fqx "$address"; then
			matched=$address
			return 0
		fi
	done
	return 1
}

check_dns() {
	case $domain in
		localhost | *.localhost)
			item "Skipping the DNS check for the local test domain $domain."
			return 0
			;;
	esac
	answers=$(resolve_domain "$domain") || answers=
	if [ -z "$answers" ]; then
		note "$domain doesn't have a DNS record yet. Caddy can't get a certificate until it points to this machine. The install carries on, and Caddy keeps trying."
		return 0
	fi
	resolved=$(printf '%s\n' "$answers" | outside_addresses)
	if [ -z "$resolved" ]; then
		note "/etc/hosts maps $domain to this machine, so the installer can't check its public DNS record. Make sure that record points here. The install carries on."
		return 0
	fi
	mine=$(local_addresses) || mine=
	if any_shared "$resolved" "$mine"; then
		item "$domain points to this machine ($matched)."
		return 0
	fi
	item "Asking ifconfig.me for this machine's public address."
	public=$(public_addresses | outside_addresses) || public=
	if any_shared "$resolved" "$public"; then
		dns_via=public
		item "$domain points to this machine ($matched)."
		return 0
	fi
	shown=$(printf '%s\n' "$resolved" | paste -sd ' ' -)
	here=$(printf '%s\n' "$public" "$mine" | sed '/^$/d' | sort -u | paste -sd ' ' -)
	[ -n "$here" ] || here="at an address the installer couldn't find"
	note "$domain points to $shown, and this machine is $here. Caddy can't get a certificate until the domain points here. The install carries on, and Caddy keeps trying."
}

read_domain() {
	if [ -n "${OLEAFLY_DOMAIN:-}" ]; then
		valid_domain "$OLEAFLY_DOMAIN" || fail "OLEAFLY_DOMAIN is $OLEAFLY_DOMAIN. $domain_problem"
		domain=$candidate
	else
		need_input OLEAFLY_DOMAIN
		heading "Domain"
		tell "The address people enter in Oleafly, without https://."
		tell "Its DNS record should point to this machine."
		while :; do
			ask "  Domain: "
			if valid_domain "$reply"; then
				domain=$candidate
				break
			fi
			tell "$domain_problem"
		done
	fi
	check_dns
}

valid_name() {
	name_problem=
	if [ -z "$1" ]; then
		name_problem='Enter a name.'
	elif [ "$(printf '%s' "$1" | wc -m)" -gt 80 ]; then
		name_problem='The name can be at most 80 characters.'
	elif ! env_quote "$1" >/dev/null; then
		name_problem="The name can't mix quotes with \$, \\ or \` characters."
	fi
	[ -z "$name_problem" ]
}

read_server_name() {
	if [ -n "${OLEAFLY_SERVER_NAME:-}" ]; then
		valid_name "$OLEAFLY_SERVER_NAME" || fail "OLEAFLY_SERVER_NAME is not usable. $name_problem"
		server_name=$OLEAFLY_SERVER_NAME
	elif [ "$noninteractive" = 1 ]; then
		server_name='Oleafly Server'
	else
		heading "Server name"
		tell "The name people see in Oleafly, such as Smith Lab."
		while :; do
			ask "  Server name [Oleafly Server]: "
			[ -n "$reply" ] || reply='Oleafly Server'
			if valid_name "$reply"; then
				server_name=$reply
				break
			fi
			tell "$name_problem"
		done
	fi
	add_setting OLEAFLY_SERVER_NAME "$server_name"
}

ask_required() {
	while :; do
		ask "$1"
		if [ -n "$reply" ] && ! has_space "$reply"; then
			return 0
		fi
		tell "$2"
	done
}

ask_required_secret() {
	while :; do
		ask_secret "$1"
		if [ -n "$reply" ]; then
			return 0
		fi
		tell "$2"
	done
}

ask_github() {
	heading "GitHub sign-in"
	tell "Create an OAuth app at https://github.com/settings/applications/new with:"
	tell "  Homepage URL: https://$domain"
	tell "  Authorization callback URL: https://$domain/auth/callback/github"
	tell "Leave Enable Device Flow off. Then copy the client ID and generate a client secret."
	ask_required "  Client ID: " 'Paste the client ID from the OAuth app page.'
	add_setting OLEAFLY_GITHUB_CLIENT_ID "$reply"
	ask_required_secret "  Client secret (hidden): " 'Paste the client secret from the OAuth app page.'
	add_setting OLEAFLY_GITHUB_CLIENT_SECRET "$reply"
	github_on=1
}

ask_oidc() {
	heading "OpenID Connect sign-in"
	tell "Give this login a short name made of letters and digits, such as university or gitlab."
	tell "It becomes part of the address your provider sends people back to."
	while :; do
		ask "  Short name [university]: "
		[ -n "$reply" ] || reply=university
		case $reply in
			*[!A-Za-z0-9]*) tell 'Use only letters and digits.' ;;
			*) break ;;
		esac
	done
	oidc_id=$(lower "$reply")
	oidc_var=$(upper "$reply")
	tell "Register an app with your provider. Make it a confidential or web app,"
	tell "allow the scopes openid, email and profile, and set its redirect URI to:"
	tell "  https://$domain/auth/callback/$oidc_id"
	while :; do
		ask "  Issuer address, such as https://gitlab.com: "
		case $reply in
			https://*) has_space "$reply" || break ;;
		esac
		tell 'Enter the https:// address where the provider publishes /.well-known/openid-configuration.'
	done
	add_setting "OLEAFLY_OIDC_${oidc_var}_ISSUER" "${reply%/}"
	ask_required "  Client ID: " "Paste the client ID your provider gave you."
	add_setting "OLEAFLY_OIDC_${oidc_var}_CLIENT_ID" "$reply"
	ask_required_secret "  Client secret (hidden): " "Paste the client secret your provider gave you."
	add_setting "OLEAFLY_OIDC_${oidc_var}_CLIENT_SECRET" "$reply"
	if [ "$oidc_id" = university ]; then
		default_label='University login'
	else
		default_label=$(printf '%s' "$oidc_id" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')
	fi
	while :; do
		ask "  Text on the sign-in button [$default_label]: "
		[ -n "$reply" ] || reply=$default_label
		valid_name "$reply" && break
		tell "$name_problem"
	done
	add_setting "OLEAFLY_OIDC_${oidc_var}_LABEL" "$reply"
	oidc_list=$oidc_id
}

env_sign_in() {
	if [ -n "${OLEAFLY_GITHUB_CLIENT_ID:-}${OLEAFLY_GITHUB_CLIENT_SECRET:-}" ]; then
		[ -n "${OLEAFLY_GITHUB_CLIENT_ID:-}" ] || fail "OLEAFLY_GITHUB_CLIENT_SECRET is set, but OLEAFLY_GITHUB_CLIENT_ID isn't. Set both."
		[ -n "${OLEAFLY_GITHUB_CLIENT_SECRET:-}" ] || fail "OLEAFLY_GITHUB_CLIENT_ID is set, but OLEAFLY_GITHUB_CLIENT_SECRET isn't. Set both."
		add_setting OLEAFLY_GITHUB_CLIENT_ID "$OLEAFLY_GITHUB_CLIENT_ID"
		add_setting OLEAFLY_GITHUB_CLIENT_SECRET "$OLEAFLY_GITHUB_CLIENT_SECRET"
		github_on=1
	fi
	names=$(env | sed -n 's/^OLEAFLY_OIDC_\([A-Za-z0-9][A-Za-z0-9]*\)_ISSUER=..*/\1/p' | sort -u)
	for name in $names; do
		issuer=$(printenv "OLEAFLY_OIDC_${name}_ISSUER") || issuer=
		client_id=$(printenv "OLEAFLY_OIDC_${name}_CLIENT_ID") || client_id=
		client_secret=$(printenv "OLEAFLY_OIDC_${name}_CLIENT_SECRET") || client_secret=
		label=$(printenv "OLEAFLY_OIDC_${name}_LABEL") || label=
		case $issuer in
			https://*) ;;
			*) fail "OLEAFLY_OIDC_${name}_ISSUER has to be an https:// address." ;;
		esac
		[ -n "$client_id" ] || fail "OLEAFLY_OIDC_${name}_ISSUER is set, but OLEAFLY_OIDC_${name}_CLIENT_ID isn't."
		[ -n "$client_secret" ] || fail "OLEAFLY_OIDC_${name}_ISSUER is set, but OLEAFLY_OIDC_${name}_CLIENT_SECRET isn't."
		add_setting "OLEAFLY_OIDC_${name}_ISSUER" "$issuer"
		add_setting "OLEAFLY_OIDC_${name}_CLIENT_ID" "$client_id"
		add_setting "OLEAFLY_OIDC_${name}_CLIENT_SECRET" "$client_secret"
		[ -z "$label" ] || add_setting "OLEAFLY_OIDC_${name}_LABEL" "$label"
		oidc_list="${oidc_list:+$oidc_list, }$(lower "$name")"
	done
}

read_sign_in() {
	env_sign_in
	if [ "$github_on" = 1 ] || [ -n "$oidc_list" ]; then
		return 0
	fi
	if [ "$noninteractive" = 1 ]; then
		fail "No sign-in provider is set." "With --yes, set OLEAFLY_GITHUB_CLIENT_ID and OLEAFLY_GITHUB_CLIENT_SECRET, or an OpenID Connect block such as OLEAFLY_OIDC_UNIVERSITY_ISSUER, OLEAFLY_OIDC_UNIVERSITY_CLIENT_ID and OLEAFLY_OIDC_UNIVERSITY_CLIENT_SECRET."
	fi
	need_input OLEAFLY_GITHUB_CLIENT_ID
	heading "Sign-in"
	tell "People sign in with an account they already have. The server never sees their password."
	tell "1) GitHub"
	tell "2) OpenID Connect, such as a university login, GitLab, Google or Microsoft"
	while :; do
		ask "  Choose 1 or 2: "
		case $reply in
			1)
				ask_github
				break
				;;
			2)
				ask_oidc
				break
				;;
		esac
		tell 'Type 1 or 2.'
	done
}

valid_email() {
	case $1 in
		*[!A-Za-z0-9._%+@-]* | *@*@* | @* | *@ | *@.* | *.) return 1 ;;
		*@*.*) return 0 ;;
	esac
	return 1
}

valid_host() {
	case $1 in
		'' | *[!A-Za-z0-9.-]* | .* | -*) return 1 ;;
	esac
	return 0
}

build_smtp_url() {
	smtp_port=${3:-465}
	if [ "$smtp_port" = 465 ]; then
		scheme=smtps
	else
		scheme=smtp
	fi
	credentials=
	if [ -n "$4" ]; then
		credentials=$(urlencode "$4")
		if [ -n "$5" ]; then
			credentials="$credentials:$(urlencode "$5")"
		fi
		credentials="$credentials@"
	fi
	smtp_url="$scheme://$credentials$2:$smtp_port"
}

mail_from_value() {
	case $server_name in
		*[!A-Za-z0-9\ ]*) printf '%s' "$1" ;;
		*) printf '%s <%s>' "$server_name" "$1" ;;
	esac
}

read_email() {
	if [ -n "${OLEAFLY_SMTP_URL:-}" ] && [ -n "${OLEAFLY_SMTP_HOST:-}" ]; then
		fail "Set OLEAFLY_SMTP_URL or OLEAFLY_SMTP_HOST, not both."
	fi
	if [ -n "${OLEAFLY_SMTP_URL:-}${OLEAFLY_SMTP_HOST:-}" ]; then
		[ -n "${OLEAFLY_MAIL_FROM:-}" ] || fail "Email needs OLEAFLY_MAIL_FROM, the address the server sends from."
		if [ -n "${OLEAFLY_SMTP_HOST:-}" ]; then
			valid_host "$OLEAFLY_SMTP_HOST" || fail "OLEAFLY_SMTP_HOST has to be a host name, such as smtp.example.org."
			case ${OLEAFLY_SMTP_PORT:-465} in
				*[!0-9]* | '') fail "OLEAFLY_SMTP_PORT has to be a number, such as 465 or 587." ;;
			esac
			build_smtp_url "" "$OLEAFLY_SMTP_HOST" "${OLEAFLY_SMTP_PORT:-465}" "${OLEAFLY_SMTP_USER:-}" "${OLEAFLY_SMTP_PASSWORD:-}"
			add_setting OLEAFLY_SMTP_URL "$smtp_url"
			email_summary=$OLEAFLY_SMTP_HOST
		else
			case $OLEAFLY_SMTP_URL in
				smtp://* | smtps://*) ;;
				*) fail "OLEAFLY_SMTP_URL has to start with smtps:// or smtp://." ;;
			esac
			add_setting OLEAFLY_SMTP_URL "$OLEAFLY_SMTP_URL"
			email_summary=On
		fi
		add_setting OLEAFLY_MAIL_FROM "$OLEAFLY_MAIL_FROM"
		return 0
	fi
	[ "$noninteractive" = 0 ] || return 0
	heading "Email (optional)"
	tell "With email, the server can send project invitations and alerts about new sign-ins."
	tell "Once you turn it on in the admin console, people can also sign in with an emailed link."
	confirm "  Set up email now? [y/N] " n || return 0
	while :; do
		ask "  Mail server, such as smtp.example.org: "
		valid_host "$reply" && break
		tell 'Enter a host name, such as smtp.example.org.'
	done
	smtp_host=$reply
	while :; do
		ask "  Port [465]: "
		[ -n "$reply" ] || reply=465
		case $reply in
			*[!0-9]*) tell 'Enter a number, such as 465 or 587.' ;;
			*)
				if [ "$reply" -ge 1 ] && [ "$reply" -le 65535 ]; then
					break
				fi
				tell 'Enter a number from 1 to 65535.'
				;;
		esac
	done
	smtp_port=$reply
	ask "  User name: "
	smtp_user=$reply
	smtp_password=
	if [ -n "$smtp_user" ]; then
		ask_secret "  Password (hidden): "
		smtp_password=$reply
	fi
	while :; do
		ask "  Send from this address, such as oleafly@example.org: "
		valid_email "$reply" && break
		tell 'Enter an email address, such as oleafly@example.org.'
	done
	build_smtp_url "" "$smtp_host" "$smtp_port" "$smtp_user" "$smtp_password"
	add_setting OLEAFLY_SMTP_URL "$smtp_url"
	add_setting OLEAFLY_MAIL_FROM "$(mail_from_value "$reply")"
	email_summary=$smtp_host
}

valid_bucket() {
	bucket=${1#s3://}
	bucket=${bucket%%/*}
	[ "${#bucket}" -ge 3 ] && [ "${#bucket}" -le 63 ] || return 1
	case $bucket in
		*[!a-z0-9.-]* | [.-]* | *[.-]) return 1 ;;
	esac
	return 0
}

read_storage() {
	store=${OLEAFLY_BLOB_STORE:-}
	case $store in
		'' | fs | FS) ;;
		s3://*)
			valid_bucket "$store" || fail "The bucket in OLEAFLY_BLOB_STORE has to be 3 to 63 lowercase letters, digits, dots and dashes."
			[ -n "${OLEAFLY_S3_ACCESS_KEY_ID:-}" ] || fail "OLEAFLY_BLOB_STORE is a bucket, so OLEAFLY_S3_ACCESS_KEY_ID is needed too."
			[ -n "${OLEAFLY_S3_SECRET_ACCESS_KEY:-}" ] || fail "OLEAFLY_BLOB_STORE is a bucket, so OLEAFLY_S3_SECRET_ACCESS_KEY is needed too."
			files_summary=$store
			return 0
			;;
		*) fail "OLEAFLY_BLOB_STORE has to be fs or an s3:// address, such as s3://lab-bucket." ;;
	esac
	[ "$noninteractive" = 0 ] || return 0
	heading "File storage (optional)"
	tell "Files such as figures and PDFs stay on this machine unless you choose a bucket."
	tell "Any S3-compatible store works, such as Amazon S3, Cloudflare R2 or MinIO."
	confirm "  Keep files in an S3 bucket? [y/N] " n || return 0
	while :; do
		ask "  Bucket, with an optional folder, such as lab-bucket/oleafly: "
		reply=${reply#s3://}
		reply=${reply%/}
		valid_bucket "$reply" && ! has_space "$reply" && break
		tell 'A bucket name has 3 to 63 lowercase letters, digits, dots and dashes.'
	done
	add_setting OLEAFLY_BLOB_STORE "s3://$reply"
	files_summary="s3://$reply"
	ask "  Region [us-east-1]: "
	[ -z "$reply" ] || add_setting OLEAFLY_S3_REGION "$reply"
	while :; do
		ask "  Endpoint, only for a store other than Amazon S3 [none]: "
		case $reply in
			'') break ;;
			https://* | http://*) has_space "$reply" || break ;;
		esac
		tell 'Enter an address that starts with https://, or leave it empty for Amazon S3.'
	done
	[ -z "$reply" ] || add_setting OLEAFLY_S3_ENDPOINT "${reply%/}"
	ask_required "  Access key ID: " 'Paste the access key ID for the bucket.'
	add_setting OLEAFLY_S3_ACCESS_KEY_ID "$reply"
	ask_required_secret "  Secret access key (hidden): " 'Paste the secret access key for the bucket.'
	add_setting OLEAFLY_S3_SECRET_ACCESS_KEY "$reply"
}

env_passthrough() {
	keys=$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$tmp/release/env.example")
	for key in $keys; do
		case $key in
			OLEAFLY_DOMAIN | OLEAFLY_SERVER_NAME | OLEAFLY_GITHUB_CLIENT_ID | OLEAFLY_GITHUB_CLIENT_SECRET | OLEAFLY_SMTP_URL | OLEAFLY_MAIL_FROM) continue ;;
		esac
		value=$(printenv "$key") || value=
		if [ -n "$value" ]; then
			case $value in
				*'
'*) fail "$key has more than one line, and .env can't hold that." ;;
			esac
			add_setting "$key" "$value"
		fi
	done
}

host_has_ipv6() {
	awk '$4 == "00" && $6 != "lo" && $6 !~ /^(docker|br-|veth|virbr)/ { found = 1 } END { exit !found }' "$sysroot/proc/net/if_inet6" 2>/dev/null
}

read_ipv6() {
	if [ -n "${OLEAFLY_IPV6:-}" ]; then
		[ "$(lower "$OLEAFLY_IPV6")" != true ] || ipv6_on=1
		return 0
	fi
	host_has_ipv6 || return 0
	case ${engine%%.*} in
		'' | *[!0-9]*) return 0 ;;
	esac
	if [ "${engine%%.*}" -ge 27 ]; then
		add_setting OLEAFLY_IPV6 true
		ipv6_on=1
	fi
}

sign_in_summary() {
	if [ "$github_on" = 1 ] && [ -n "$oidc_list" ]; then
		printf 'GitHub and OpenID Connect (%s)' "$oidc_list"
	elif [ "$github_on" = 1 ]; then
		printf 'GitHub'
	else
		printf 'OpenID Connect (%s)' "$oidc_list"
	fi
}

collect_settings() {
	: >"$tmp/settings"
	env_passthrough
	read_domain
	add_setting OLEAFLY_DOMAIN "$domain"
	read_server_name
	read_sign_in
	read_email
	read_storage
	read_ipv6
	heading "Ready to install"
	item "Folder: $dir"
	item "Domain: $domain"
	item "Server name: $server_name"
	item "Sign-in: $(sign_in_summary)"
	item "Email: $email_summary"
	item "Files: $files_summary"
	[ "$ipv6_on" = 0 ] || item "IPv6: On"
	if [ "$noninteractive" = 0 ]; then
		confirm "  Go ahead? [Y/n] " y || fail "Stopped. Nothing was changed."
	fi
}

write_env() {
	awk 'NR == FNR {
		k = substr($0, 1, index($0, "=") - 1)
		if (!(k in v)) order[++n] = k
		v[k] = $0
		next
	}
	/^[A-Za-z_][A-Za-z0-9_]*=/ {
		k = substr($0, 1, index($0, "=") - 1)
		if (k in v) {
			print v[k]
			done[k] = 1
			next
		}
	}
	{ print }
	END {
		for (i = 1; i <= n; i++) if (!(order[i] in done)) print v[order[i]]
	}' "$tmp/settings" "$tmp/release/env.example" >"$tmp/env"
	if [ -e "$dir/.env" ]; then
		fail "$dir/.env appeared while the installer was running. It wasn't changed." "Run the installer again to use it."
	fi
	as_root install -m 600 -o 0 -g 0 "$tmp/env" "$dir/.env"
	item "Wrote the settings to $dir/.env. Only root can read it."
}

server_image_in() {
	sed -n 's|^[[:space:]]*image:[[:space:]]*\([^[:space:]]*/oleafly-server:[^[:space:]]*\)[[:space:]]*$|\1|p' "$1" 2>/dev/null | head -n 1
}

caddy_image_in() {
	sed -n 's|^[[:space:]]*image:[[:space:]]*\(caddy:[^[:space:]]*\)[[:space:]]*$|\1|p' "$1" 2>/dev/null | head -n 1
}

pull_images() {
	item "Downloading the container images. This can take a minute."
	# Naming a file with -f stops Compose from reading the admin's
	# docker-compose.override.yml by itself, so name that file too: an image
	# it swaps in is pulled before anything stops. A service the override
	# builds from source has nothing to pull.
	override=
	[ ! -f "$dir/docker-compose.override.yml" ] || override=$dir/docker-compose.override.yml
	if compose --project-directory "$dir" -f "$1" ${override:+-f "$override"} pull --quiet ${override:+--ignore-buildable} >"$tmp/compose.log" 2>&1; then
		return 0
	fi
	tail -n 20 "$tmp/compose.log" >&2
	if grep -Eqi 'denied|unauthorized|manifest unknown|not found: manifest|manifest for .* not found' "$tmp/compose.log"; then
		images=$(server_image_in "$1")
		override_images=
		[ -z "$override" ] || override_images=$(sed -n 's/^[[:space:]]*image:[[:space:]]*\([^[:space:]]*\).*$/\1/p' "$override" | tr '\n' ' ')
		[ -z "$override_images" ] || images="$images, or one that docker-compose.override.yml names (${override_images% }),"
		fail "Docker couldn't get $images from the registry. Its message is above.${2:+ $2}" "The registry refused the download or doesn't have the image, so this machine's network isn't the problem. Report it at $issues_url"
	fi
	fail "Docker couldn't download the images. Its message is above.${2:+ $2}" "Check this machine's network connection, then run the installer again."
}

start_server() {
	container_before=$(compose ps -q oleafly-server 2>/dev/null) || container_before=
	restarts_before=0
	if [ -n "$container_before" ]; then
		restarts_before=$(docker_cmd inspect --format '{{.RestartCount}}' "$container_before" 2>/dev/null) || restarts_before=0
		case $restarts_before in
			'' | *[!0-9]*) restarts_before=0 ;;
		esac
	fi
	if ! compose up -d --remove-orphans >"$tmp/compose.log" 2>&1; then
		tail -n 20 "$tmp/compose.log" >&2
		ipv6=$(read_env_value OLEAFLY_IPV6) || ipv6=
		if [ "$(lower "$ipv6")" = true ] && grep -Eqi 'ip6tables|ipv6|address pool' "$tmp/compose.log"; then
			fail "Docker couldn't start the containers. Its message is above." "Docker couldn't set up IPv6 for the server's network. Set OLEAFLY_IPV6=false in $dir/.env, then run the installer again." ${rollback:+"$rollback"}
		fi
		fail "Docker couldn't start the containers. Its message is above." "Fix the problem, then run the installer again." ${rollback:+"$rollback"}
	fi
}

server_failed() {
	log=$(compose logs --no-color --no-log-prefix --tail 100 oleafly-server 2>/dev/null) || log=
	reason=$(printf '%s\n' "$log" | grep 'cannot start' | tail -n 1)
	if [ -n "$reason" ]; then
		fail "The server stopped right after it started." "It said: $reason" "Fix the setting in $dir/.env, then run: sudo sh $dir/install.sh" "To see the whole log: cd $dir && sudo docker compose logs oleafly-server" ${rollback:+"$rollback"}
	fi
	reason=$(printf '%s\n' "$log" | grep '[[:space:]]ERROR[[:space:]]' | tail -n 1 | sed 's/^.*[[:space:]]ERROR[[:space:]]*//')
	fail "The server stopped right after it started." ${reason:+"It said: $reason"} "To see the whole log: cd $dir && sudo docker compose logs oleafly-server" ${rollback:+"$rollback"}
}

wait_for_server() {
	item "Waiting for the server to be ready."
	container=$(compose ps -q oleafly-server 2>/dev/null) || container=
	[ -n "$container" ] || server_failed
	allowed=0
	if [ "$container" = "$container_before" ]; then
		allowed=$restarts_before
	fi
	tries=0
	while :; do
		state=$(docker_cmd inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$container" 2>/dev/null) || state=missing
		case $state in
			running\ *) ;;
			*) server_failed ;;
		esac
		restarts=${state##* }
		case $restarts in
			'' | *[!0-9]*) restarts=0 ;;
		esac
		[ "$restarts" -le "$allowed" ] || server_failed
		case $state in
			'running healthy '*)
				item "The server is running."
				return 0
				;;
		esac
		tries=$((tries + 1))
		if [ "$tries" -ge 90 ]; then
			fail "The server didn't become ready within 3 minutes." "See its log with: cd $dir && sudo docker compose logs oleafly-server" ${rollback:+"$rollback"}
		fi
		sleep 2
	done
}

back_up_data() {
	heading "Copying the data before the update"
	caddy_image=$(caddy_image_in "$tmp/release/docker-compose.yml")
	[ -n "$caddy_image" ] || fail "The release's docker-compose.yml doesn't name a Caddy image, which the backup uses. Nothing was changed." "Report this at $issues_url"
	backup_name=oleafly-data-$(date -u +%Y%m%dT%H%M%SZ)-$before.tar.gz
	as_root install -d -m 700 "$dir/backups" || fail "Couldn't make $dir/backups for the copy of the data. Nothing was changed." "Check that the disk isn't full, then run the installer again."
	# These copies come before the stop, so a full disk ends the update while
	# the server still runs.
	for file in $previous_files; do
		if [ -f "$dir/$file" ]; then
			as_root cp -p "$dir/$file" "$dir/$file.previous" || fail "Couldn't keep a copy of $dir/$file before the update. Nothing was changed." "Check that the disk isn't full, then run the installer again."
		fi
	done
	item "Stopping the server to copy its data."
	if ! compose stop >"$tmp/compose.log" 2>&1; then
		tail -n 20 "$tmp/compose.log" >&2
		compose start >/dev/null 2>&1 || true
		fail "Docker couldn't stop the server to copy its data. Its message is above. Nothing was changed."
	fi
	stopped_for_backup=1
	if ! docker_cmd run --rm -v "$data_volume:/data:ro" -v "$dir/backups:/backup" --entrypoint tar "$caddy_image" -czf "/backup/$backup_name" -C /data . >"$tmp/compose.log" 2>&1; then
		tail -n 20 "$tmp/compose.log" >&2
		as_root rm -f "$dir/backups/$backup_name"
		compose start >/dev/null 2>&1 || true
		fail "Couldn't copy the data before the update. Its message is above." "The server runs $before again, and nothing else was changed. Check that this machine has free disk space, then run the installer again."
	fi
	item "Copied the data to $dir/backups/$backup_name"
	# An old copy that can't be removed doesn't stop the update.
	for old in $(as_root ls -1 "$dir/backups" | grep '^oleafly-data-.*\.tar\.gz$' | sort -r | tail -n +4); do
		as_root rm -f "$dir/backups/$old" || note "Couldn't remove the old copy $dir/backups/$old."
	done
	rollback="To go back to $before with the data from before this update, run:
  cd $dir
  sudo docker compose down
  sudo docker run --rm -v $data_volume:/data -v $dir/backups:/backup:ro --entrypoint sh $caddy_image -c 'find /data -mindepth 1 -delete && tar -xzf /backup/$backup_name -C /data'
  sudo cp docker-compose.yml.previous docker-compose.yml
  sudo cp Caddyfile.previous Caddyfile
  sudo cp litestream.yml.previous litestream.yml
  sudo cp install.sh.previous install.sh
  sudo docker compose up -d"
}

https_get() {
	if [ "$test_local_tls" = 1 ]; then
		if [ ! -s "$tmp/local-ca.crt" ]; then
			compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt >"$tmp/local-ca.crt" 2>/dev/null || true
		fi
		curl -fsS --max-time 5 --cacert "$tmp/local-ca.crt" --resolve "$domain:443:127.0.0.1" -o "$2" "https://$domain$1" 2>/dev/null
	else
		curl -fsS --max-time 5 --resolve "$domain:443:127.0.0.1" -o "$2" "https://$domain$1" 2>/dev/null
	fi
}

check_https() {
	heading "Checking https://$domain"
	https_ok=0
	tries=0
	while :; do
		if https_get /healthz /dev/null; then
			https_ok=1
			item "https://$domain answers on this machine with a valid certificate."
			item "To check it from outside, open https://$domain/healthz on a phone or from another network."
			return 0
		fi
		tries=$((tries + 1))
		[ "$tries" -lt "$1" ] || break
		sleep 3
	done
	note "The server is running, but https://$domain doesn't answer yet."
	item "Caddy may still be getting the certificate, or the domain may not point here yet."
	item "Check that TCP ports 80 and 443 and UDP port 443 are open in any firewall or cloud security group in front of this machine."
	if [ "$dns_via" = public ]; then
		item "This machine has a private address behind a router or NAT. Forward TCP ports 80 and 443 to it, or follow ${docs_url}#without-a-public-address"
	fi
	item "Caddy keeps trying by itself. Check again in a few minutes with:"
	item "  sudo sh $dir/install.sh status"
	item "Caddy's log says what it's waiting for: cd $dir && sudo docker compose logs caddy"
}

read_setup_state() {
	needs_setup=unknown
	if [ "$https_ok" = 1 ] && https_get /.well-known/oleafly-server "$tmp/manifest.json"; then
		if grep -q '"needs_setup": *false' "$tmp/manifest.json"; then
			needs_setup=no
		elif grep -q '"needs_setup": *true' "$tmp/manifest.json"; then
			needs_setup=yes
		fi
	fi
	code=
	preset=0
	if [ "$needs_setup" != no ]; then
		line=$(compose logs --no-color --no-log-prefix oleafly-server 2>/dev/null | grep 'Setup code: ' | tail -n 1) || line=
		case $line in
			*'set by OLEAFLY_SETUP_CODE'*) preset=1 ;;
			?*) code=$(printf '%s\n' "$line" | sed -n 's/.*Setup code: \([A-Z0-9][A-Z0-9-]*\)\..*/\1/p') ;;
		esac
	fi
}

show_setup_code() {
	if [ -n "$code" ]; then
		item "Setup code: $code"
	elif [ "$preset" = 1 ]; then
		item "Setup code: the one you set in OLEAFLY_SETUP_CODE"
	else
		item "Find the setup code with: cd $dir && sudo docker compose logs oleafly-server | grep 'Setup code'"
	fi
}

show_result() {
	read_setup_state
	heading "Oleafly Server is running"
	item "Address: https://$domain"
	if [ "$needs_setup" = no ]; then
		item "This server already has an admin. Sign in to it from Oleafly."
	else
		show_setup_code
		heading "Next steps"
		item "1. Open Oleafly. Turn on Live collaboration in Settings > Experimentation."
		item "2. In Settings > Collaboration, choose Add server and enter https://$domain"
		item "3. Enter the setup code and sign in. You become the server's admin, and the code stops working."
		item "4. Add people under Manage server. Nobody else can sign in until you add them."
		item "Only paste the setup code into Oleafly. Whoever uses it first becomes the admin."
		item "The code is new each time the server starts, until someone finishes setup. To see the current one, run: sudo sh $dir/install.sh status"
	fi
	heading "For later"
	item "Settings: $dir/.env"
	item "Data: the Docker volume $data_volume. Backups: $operations_url"
	item "Status: sudo sh $dir/install.sh status"
	item "Update: curl -fsSL $install_url | sudo sh -s update"
	item "Each update copies the data to $dir/backups before a new version starts."
}

refresh_install() {
	download_release
	check_not_older
	pull_images "$tmp/release/docker-compose.yml" "Nothing was changed."
	if [ -n "$before" ] && [ "$before" != "$release_version" ]; then
		back_up_data
	fi
	if ! place_release_files; then
		if [ "$stopped_for_backup" = 1 ]; then
			# The new release never started, so the data is as it was. Only
			# files to put back, if some were already replaced.
			files_now="None of the installed files changed."
			if [ "$placed" = 1 ]; then
				if ! restore_previous_files; then
					fail "Couldn't put the new release's files in $dir, or the previous ones back. Its message is above." "To put the previous files back, run:
  cd $dir
  for file in $previous_files; do sudo cp \$file.previous \$file; done
  sudo docker compose start"
				fi
				files_now="The installer put the previous files back."
			fi
			if compose start >/dev/null 2>&1; then
				again="The server runs $before again."
			else
				again="Docker couldn't start the server again. Start it with: cd $dir && sudo docker compose start"
			fi
			fail "Couldn't put the new release's files in $dir. Its message is above." "$files_now $again" "Free some disk space, then run the installer again."
		fi
		fail "Couldn't put the release files in $dir. Its message is above." "Check that the disk isn't full, then run the installer again."
	fi
	heading "Starting the server"
	start_server
	wait_for_server
	check_https "$1"
}

read_installed_domain() {
	domain=$(read_env_value OLEAFLY_DOMAIN) || domain=
	[ -z "$domain" ] || return 0
	if [ -f "$dir/docker-compose.yml" ]; then
		fail "$dir/.env doesn't set OLEAFLY_DOMAIN. Add it, then run the installer again."
	fi
	read_domain
	printf '\nOLEAFLY_DOMAIN=%s\n' "$domain" | as_root tee -a "$dir/.env" >/dev/null
	item "Added OLEAFLY_DOMAIN=$domain to $dir/.env."
}

require_install() {
	if [ ! -f "$dir/.env" ] || [ ! -f "$dir/docker-compose.yml" ]; then
		fail "There's no Oleafly Server in $dir." "Install it with: curl -fsSL $install_url | sudo sh" "If it's in another folder, set OLEAFLY_DIR to that folder."
	fi
	read_installed_domain
}

check_newer_release() {
	latest_checked=0
	[ -z "${OLEAFLY_RELEASE_URL:-}" ] || return 0
	if [ "$installer_version" = unreleased ]; then
		latest_checked=1
		return 0
	fi
	url=$(curl -fsSIL --proto '=https' --proto-redir '=https' --tlsv1.2 --max-time 20 -o /dev/null -w '%{url_effective}' "https://github.com/$release_repo/releases/latest" 2>/dev/null) || return 0
	latest=${url##*/tag/server-v}
	valid_version "$latest" || return 0
	if version_gt "$latest" "$installer_version"; then
		fail "Oleafly Server $latest is out, and this installer is for $installer_version. Nothing was changed." "Update with: curl -fsSL $install_url | sudo sh -s update"
	fi
	latest_checked=1
}

cmd_install() {
	check_platform
	check_root
	if [ -f "$dir/.env" ]; then
		if [ -f "$dir/docker-compose.yml" ]; then
			item "Found a server in $dir. Its settings in .env stay as they are."
		else
			item "Found $dir/.env without the other files. The installer keeps .env and puts the other files back."
		fi
		read_installed_domain
		before=$(compose_version "$dir/docker-compose.yml") || before=
		ensure_docker may_install
		refresh_install 40
		show_result
		return 0
	fi
	check_ports
	ensure_docker may_install
	download_release
	collect_settings
	heading "Installing"
	place_release_files || fail "Couldn't put the release files in $dir. Its message is above." "Check that the disk isn't full, then run the installer again."
	write_env
	heading "Starting the server"
	pull_images "$dir/docker-compose.yml"
	start_server
	wait_for_server
	check_https 40
	show_result
}

cmd_update() {
	check_platform
	check_root
	require_install
	before=$(compose_version "$dir/docker-compose.yml") || before=
	check_newer_release
	ensure_docker no_install
	refresh_install 40
	if [ -n "$before" ] && [ "$before" != "$release_version" ]; then
		heading "Updated from $before to $release_version"
	elif [ "$latest_checked" = 1 ]; then
		heading "Oleafly Server $release_version is up to date"
	elif [ -n "${OLEAFLY_RELEASE_URL:-}" ]; then
		heading "Oleafly Server $release_version is in place"
		item "It came from OLEAFLY_RELEASE_URL, so the installer didn't look for a newer release."
	else
		heading "Oleafly Server $release_version is in place"
		item "The installer couldn't check for a newer release."
	fi
	item "Your settings in $dir/.env didn't change."
}

cmd_status() {
	check_root
	require_install
	ensure_docker no_install
	version=$(compose_version "$dir/docker-compose.yml") || version=
	heading "Oleafly Server ${version:-} in $dir"
	compose ps --all --format '{{.Service}}: {{.Status}}' 2>/dev/null | sed 's/^/  /' || true
	healthy=0
	container=$(compose ps -q oleafly-server 2>/dev/null) || container=
	if [ -n "$container" ]; then
		state=$(docker_cmd inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null) || state=
		[ "$state" != 'running healthy' ] || healthy=1
	fi
	if [ "$healthy" = 1 ]; then
		item "The server is running and ready."
	else
		item "The server isn't ready. See why with: cd $dir && sudo docker compose logs oleafly-server"
	fi
	if https_get /healthz /dev/null; then
		item "https://$domain answers on this machine with a valid certificate."
		https_ok=1
	else
		item "https://$domain doesn't answer on this machine. See Caddy's log with: cd $dir && sudo docker compose logs caddy"
	fi
	if [ "$healthy" = 1 ]; then
		read_setup_state
		case $needs_setup in
			yes)
				show_setup_code
				item "Nobody has finished setup yet. The code is new each time the server starts."
				;;
			unknown)
				if [ -n "$code" ]; then
					item "Setup code, if nobody has finished setup yet: $code"
					item "The code is new each time the server starts."
				fi
				;;
		esac
	fi
	[ "$healthy" = 1 ] && [ "$https_ok" = 1 ]
}

storage_location() {
	printf '%s' "$1" | sed 's#^\([A-Za-z][A-Za-z0-9+.-]*://\)[^/@]*@#\1#'
}

cmd_uninstall() {
	check_root
	require_install
	ensure_docker no_install
	blob_store=$(read_env_value OLEAFLY_BLOB_STORE) || blob_store=
	case $blob_store in
		[Ss]3://*) blob_store=$(storage_location "$blob_store") ;;
		*) blob_store= ;;
	esac
	replica=$(read_env_value LITESTREAM_REPLICA_URL) || replica=
	[ -z "$replica" ] || replica=$(storage_location "$replica")
	heading "Uninstall"
	item "This stops and removes the Oleafly Server containers."
	item "Your data and settings stay unless you choose to delete them next."
	if [ "$noninteractive" = 0 ]; then
		need_input OLEAFLY_NONINTERACTIVE
		confirm "  Stop and remove the containers? [y/N] " n || fail "Stopped. Nothing was changed."
	fi
	compose down --remove-orphans >"$tmp/compose.log" 2>&1 || {
		tail -n 20 "$tmp/compose.log" >&2
		fail "Docker couldn't remove the containers. Its message is above."
	}
	item "The containers are gone."
	mountpoint=$(docker_cmd volume inspect --format '{{.Mountpoint}}' "$data_volume" 2>/dev/null) || mountpoint=
	heading "Your data"
	if [ -n "$mountpoint" ]; then
		item "Projects, accounts and the security log are in the Docker volume $data_volume, at $mountpoint"
	fi
	[ -z "$blob_store" ] || item "Files and project snapshots are in $blob_store."
	[ -z "$replica" ] || item "Litestream's copies of the database are in $replica."
	item "Settings are in $dir/.env"
	if [ "$noninteractive" = 1 ]; then
		item "To delete them too, run the uninstall again without --yes."
		return 0
	fi
	tell ""
	tell "Deleting the data removes every shared project on this server, every account, the security log and the copies in $dir/backups."
	[ -z "$blob_store" ] || tell "Files and snapshots in $blob_store stay. Delete them in your storage provider."
	[ -z "$replica" ] || tell "The database copies in $replica stay. Delete them in your storage provider."
	tell "It can't be undone. People keep their own copies of projects on their computers."
	ask "  To delete the data and settings, type delete. To keep them, press Enter: "
	if [ "$reply" != delete ]; then
		item "Kept the data and settings. Install again later to use them."
		return 0
	fi
	if ! docker_cmd volume rm "$data_volume" >"$tmp/compose.log" 2>&1 && docker_cmd volume inspect "$data_volume" >/dev/null 2>&1; then
		tail -n 20 "$tmp/compose.log" >&2
		fail "Docker couldn't delete the data volume $data_volume. Its message is above."
	fi
	as_root rm -rf "$dir/.release-incoming"
	for file in .env .env.example install.sh install.sh.previous docker-compose.yml docker-compose.yml.previous Caddyfile Caddyfile.previous litestream.yml litestream.yml.previous; do
		as_root rm -f "$dir/$file"
	done
	if [ -d "$dir/backups" ]; then
		for old in $(as_root ls -1 "$dir/backups" | grep '^oleafly-data-.*\.tar\.gz$'); do
			as_root rm -f "$dir/backups/$old"
		done
		as_root rmdir "$dir/backups" 2>/dev/null || true
	fi
	if as_root rmdir "$dir" 2>/dev/null; then
		item "Deleted the data, the settings and $dir."
	else
		item "Deleted the data and the settings. $dir still holds files you added, so it stays."
	fi
	[ -z "$blob_store" ] || item "Files and snapshots in $blob_store are still there. Delete them in your storage provider."
	[ -z "$replica" ] || item "The database copies in $replica are still there. Delete them in your storage provider."
	item "Caddy's certificates stay in the Docker volumes oleafly-server_caddy-data and oleafly-server_caddy-config, so a new install doesn't ask Let's Encrypt for new ones. To delete them too, run: sudo docker volume rm oleafly-server_caddy-data oleafly-server_caddy-config"
}

load_answers() {
	answers=${OLEAFLY_ANSWERS_FILE:-}
	[ -n "$answers" ] || return 0
	if [ ! -f "$answers" ] || [ ! -r "$answers" ]; then
		fail "OLEAFLY_ANSWERS_FILE is $answers, which the installer can't read." "Check the path, and run the installer as root, for example through sudo."
	fi
	entries=$(awk '{
		sub(/\r$/, "")
		sub(/^[ \t]+/, "")
		sub(/^export[ \t]+/, "")
		if ($0 == "" || substr($0, 1, 1) == "#") next
		print NR ":" $0
	}' "$answers")
	while IFS= read -r entry; do
		[ -n "$entry" ] || continue
		number=${entry%%:*}
		line=${entry#*:}
		key=${line%%=*}
		case $key in
			"$line" | '' | *[!A-Za-z0-9_]*) fail "Line $number of $answers isn't a setting such as OLEAFLY_DOMAIN=collab.example.org." ;;
			OLEAFLY_* | LITESTREAM_*) ;;
			*) fail "Line $number of $answers sets $key, which the installer doesn't read." "Use the names in .env.example, which start with OLEAFLY_ or LITESTREAM_." ;;
		esac
		value=${line#*=}
		case $value in
			\'*\')
				value=${value#\'}
				value=${value%\'}
				;;
			\"*\")
				value=${value#\"}
				value=${value%\"}
				;;
		esac
		if ! printenv "$key" >/dev/null 2>&1; then
			export "$key=$value"
		fi
	done <<EOF
$entries
EOF
	dir=${OLEAFLY_DIR:-/opt/oleafly-server}
}

main() {
	for argument in "$@"; do
		case $argument in
			install | update | status | uninstall) command_name=$argument ;;
			-y | --yes) noninteractive=1 ;;
			-h | --help | help)
				print_help
				return 0
				;;
			-V | --version | version)
				say "Oleafly Server installer $(version_label)"
				return 0
				;;
			*) fail "The installer doesn't know \"$argument\". Run it with --help to see what it can do." ;;
		esac
	done
	load_answers
	case ${OLEAFLY_NONINTERACTIVE:-} in
		1 | yes | true) noninteractive=1 ;;
	esac
	case ${OLEAFLY_TEST_LOCAL_TLS:-} in
		1 | yes | true) test_local_tls=1 ;;
	esac
	trap cleanup EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM
	umask 077
	tmp=$(mktemp -d "${TMPDIR:-/tmp}/oleafly-install.XXXXXX")
	say "Oleafly Server installer $(version_label)"
	case $command_name in
		install) cmd_install ;;
		update) cmd_update ;;
		status) cmd_status ;;
		uninstall) cmd_uninstall ;;
	esac
}

main "$@"
