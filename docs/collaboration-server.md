# Oleafly Server

Oleafly Server lets a group of people work on the same Oleafly projects. One person runs the server. Everyone else adds it in Oleafly and signs in with an account they already have, such as GitHub or a university login. When someone shares a project on the server, the people they add get a full copy that stays in sync while they edit. Everyone still compiles on their own computer and keeps their own git history and checkpoints.

Live collaboration is off by default. To try it, turn on **Live collaboration** in **Settings › Experimentation**, then open **Settings › Collaboration**.

## Who this is for

This page is for the person who runs the server for a lab, a course or a few coauthors. You should be comfortable with a terminal and with editing a configuration file. You don't need to write code.

A person can belong to several servers. Each shared project lives on one server.

## What the server keeps and who can read it

The server keeps everything in one folder, set by `OLEAFLY_DATA_DIR`:

- **Accounts.** Each member's display name, avatar address, verified email addresses, and their user ID and login at the sign-in provider. The server never sees or stores a password.
- **Devices.** Each computer that signed in: its name, operating system, public key, and when it was last seen. Sign-in tokens are stored only as hashes.
- **The security log.** Sign-ins, refused sign-ins, devices added and signed out, members and roles changed, and settings changed, each with the time and the IP address. Entries older than `OLEAFLY_SECURITY_LOG_DAYS` days are deleted.
- **Server settings** that admins change in Oleafly.
- **Shared projects**, once project sharing arrives in a later version. Every file and the full history of changes. When an owner stops sharing a project, the server will keep it read-only for `OLEAFLY_ARCHIVE_DAYS` days and then delete it.

**Projects are not encrypted on the server.** Anyone who can read the data folder, the machine's disk or your backups can read every project stored there. That includes whoever runs the machine and the company that hosts it. Inside Oleafly the rules are stricter: no server role, admin included, can open a project unless the project's owner added them. If you need to keep a project away from the people who run a server, run your own server for it.

Every member's computer also keeps a full copy of each project shared with them. Ask members to turn on disk encryption, such as FileVault on macOS, BitLocker on Windows or LUKS on Linux.

## Before you start

You need:

- A Linux machine that stays on. A small virtual machine is enough to start. Keep an eye on its memory and disk as your projects grow.
- A domain name for the server, such as `collab.example.org`, with a DNS record pointing at the machine. If the machine has no public address, read [Without a public address](#without-a-public-address).
- At least one sign-in provider. Read [Sign-in providers](#sign-in-providers).

Then pick how to run it:

| Option | When to use it |
| --- | --- |
| [Docker Compose](#docker-compose) | Any machine with Docker. Caddy gets the HTTPS certificate for you. |
| [Coolify](#coolify) | You already run a Coolify server. |
| [Linux without Docker](#linux-without-docker) | A university virtual machine where you can't use Docker. |

## Settings

The server reads its settings from environment variables. A variable that is set but empty counts as not set.

| Variable | What it does | Default |
| --- | --- | --- |
| `OLEAFLY_PUBLIC_URL` | The HTTPS address people enter in Oleafly. It can include a path, such as `https://www.cs.example.edu/oleafly`. Required. The Compose and Coolify files set it for you. | None |
| `OLEAFLY_BIND` | The address and port the server listens on. | `0.0.0.0:8080` |
| `OLEAFLY_DATA_DIR` | The folder for the database and stored files. | `/data` |
| `OLEAFLY_SERVER_NAME` | The name people see in Oleafly, such as `Smith Lab`. | `Oleafly Server` |
| `OLEAFLY_SERVER_ICON_URL` | The HTTPS address of a square image shown next to the name. | None |
| `OLEAFLY_SETUP_CODE` | Your own one-time setup code: at least 12 letters or digits, and dashes or spaces if you like. Without it, the server makes one. Read [Become the first admin](#become-the-first-admin). | Generated |
| `OLEAFLY_GITHUB_CLIENT_ID`, `OLEAFLY_GITHUB_CLIENT_SECRET` | Turn on sign-in with GitHub. | Off |
| `OLEAFLY_GITHUB_URL` | The address of a GitHub Enterprise Server. | `https://github.com` |
| `OLEAFLY_GITHUB_API_URL` | The GitHub API address, if yours is unusual. | `https://api.github.com`, or `/api/v3` under `OLEAFLY_GITHUB_URL` |
| `OLEAFLY_GITHUB_LABEL` | The text on the GitHub sign-in button. | `GitHub` |
| `OLEAFLY_OIDC_<NAME>_ISSUER`, `OLEAFLY_OIDC_<NAME>_CLIENT_ID`, `OLEAFLY_OIDC_<NAME>_CLIENT_SECRET` | Turn on an OpenID Connect provider called `<NAME>`. | Off |
| `OLEAFLY_OIDC_<NAME>_LABEL` | The text on its sign-in button, such as `University login`. | `<NAME>` |
| `OLEAFLY_OIDC_<NAME>_TRUST_EMAIL` | Treat every email address from this provider as verified. Read [Email addresses](#email-addresses) first. | `false` |
| `OLEAFLY_SMTP_URL`, `OLEAFLY_MAIL_FROM` | Email. Read [Email](#email). | Off |
| `OLEAFLY_BLOB_STORE` | Where files are stored. Leave it as `fs`, which keeps them in `OLEAFLY_DATA_DIR`. | `fs` |
| `OLEAFLY_MAX_PROJECT_MB` | The largest project the server accepts, in megabytes. | `200` |
| `OLEAFLY_MAX_FILE_MB` | The largest single file, in megabytes. | `50` |
| `OLEAFLY_MAX_MEMBERS_PER_PROJECT` | The most people on one project. | `20` |
| `OLEAFLY_BEHIND_PROXY` | Trust the client address that a proxy in front of the server passes on. Read [Behind a university proxy](#behind-a-university-proxy). The Compose and Coolify files turn it on. | `false` |
| `OLEAFLY_LOG_LEVEL` | How much the server logs: `error`, `warn`, `info`, `debug` or `trace`. | `info` |
| `OLEAFLY_SECURITY_LOG_DAYS` | How many days to keep security log entries. | `365` |
| `OLEAFLY_ARCHIVE_DAYS` | How many days to keep a project after its owner stops sharing it. | `30` |

In the Compose `.env` file, put a value in single quotes if it contains `$` or `#`.

### Keeping secrets in files

Five settings can hold secrets: `OLEAFLY_SETUP_CODE`, `OLEAFLY_GITHUB_CLIENT_SECRET`, `OLEAFLY_OIDC_<NAME>_CLIENT_SECRET`, `OLEAFLY_SMTP_URL` and `OLEAFLY_BLOB_STORE`. Each one also has a `_FILE` version that names a file holding the value, for example `OLEAFLY_GITHUB_CLIENT_SECRET_FILE=/run/secrets/github_client_secret`. Set one of the two, not both. The [Docker Compose](#docker-compose) and [systemd](#run-it-with-systemd) sections show how.

## Docker Compose

This setup runs two containers. `oleafly-server` is the server, and only other containers can reach it. `caddy` gets a certificate from Let's Encrypt, serves HTTPS on ports 80 and 443, and passes requests to the server, WebSocket connections included.

1. Install Docker Engine and the Compose plugin by following [Docker's instructions](https://docs.docker.com/engine/install/).
2. Point your domain's DNS record at the machine. Open TCP ports 80 and 443 and UDP port 443 in any firewall in front of it. Caddy needs port 80 to get the certificate.
3. Get the files and make your settings file:

   ```sh
   git clone https://github.com/Oleafly/Oleafly.git
   cd Oleafly/deploy/server
   cp .env.example .env
   chmod 600 .env
   ```

4. Edit `.env`. Set `OLEAFLY_DOMAIN` to your domain without `https://`, set `OLEAFLY_SERVER_NAME`, and fill in at least one [sign-in provider](#sign-in-providers). Leave the provider lines you don't use empty.
5. Build and start:

   ```sh
   docker compose up -d --build
   ```

   The first build compiles the server and takes several minutes.
6. Check that it answers. This prints `200`:

   ```sh
   curl -sS -o /dev/null -w '%{http_code}\n' https://collab.example.org/healthz
   ```

7. [Become the first admin](#become-the-first-admin). The setup code is in the log:

   ```sh
   docker compose logs oleafly-server | grep 'Setup code'
   ```

Your data lives in the Docker volume `oleafly-server_oleafly-data`. Caddy keeps its certificates in `oleafly-server_caddy-data`.

Docker opens ports 80 and 443 itself, even when a host firewall such as `ufw` is on. That is what you want for Caddy. Don't add a `ports:` entry to the `oleafly-server` service. If you need to reach the server from the machine itself, publish it as `127.0.0.1:8080:8080` so it stays off the network.

If you change the `Caddyfile`, run `docker compose up -d --force-recreate caddy`.

To keep the GitHub client secret out of `.env`, pass it as a Docker secret. Save the secret with your editor in `secrets/github_client_secret` next to `docker-compose.yml`, let the server's user (ID 10001) read it, and delete the `OLEAFLY_GITHUB_CLIENT_SECRET` line from `.env`:

```sh
sudo chown 10001:10001 secrets/github_client_secret
sudo chmod 400 secrets/github_client_secret
```

Then create `docker-compose.override.yml` next to `docker-compose.yml`. Compose reads it automatically.

```yaml
services:
  oleafly-server:
    environment:
      OLEAFLY_GITHUB_CLIENT_SECRET_FILE: /run/secrets/github_client_secret
    secrets:
      - github_client_secret

secrets:
  github_client_secret:
    file: ./secrets/github_client_secret
```

Run `docker compose up -d` again.

## Coolify

Coolify builds the server from the Oleafly repository and puts its own proxy in front, so this setup has no Caddy.

1. In your Coolify project, select **+ New** and choose the public repository `https://github.com/Oleafly/Oleafly` on the branch `main`.
2. Under **General › Build pipeline**, set **Build strategy** to **Compose**, **Base Directory** to `/`, and **Docker Compose Location** to `/deploy/server/docker-compose.coolify.yml`.
3. Under **Advanced › Build**, set **Build arguments** to **Managed manually in Dockerfile**. The server's image needs no build arguments, and this keeps your secrets out of the build.
4. Under **Domains**, add a domain for the `oleafly-server` service: `https://collab.example.org:8080`. The `:8080` tells Coolify's proxy which port the container listens on. People still connect on the normal HTTPS port. Coolify fills in `OLEAFLY_PUBLIC_URL` from this domain.
5. Under **Environment Variables**, set `OLEAFLY_SERVER_NAME` and a [sign-in provider](#sign-in-providers). Leave the ones you don't use empty.
6. Select **Deploy**. When it finishes, look for `Setup code` in the logs of the `oleafly-server` service and [become the first admin](#become-the-first-admin).

The Coolify file has room for GitHub and one OpenID Connect provider named `UNIVERSITY`. Set `OLEAFLY_OIDC_UNIVERSITY_LABEL` to the text people should see, such as `GitLab`. Its callback address ends in `/auth/callback/university`. For more providers, deploy from a fork with your own copy of the file.

The data lives in a Docker volume whose name ends in `oleafly-data`. Find it with `docker volume ls --filter name=oleafly-data`.

## Linux without Docker

On a machine without Docker, the server runs as a single program under systemd, with Caddy in front for HTTPS.

### Build the server

The server builds into one file that needs nothing else installed. These commands are for Ubuntu 24.04 or Debian on an x86-64 machine. On an ARM machine, replace every `x86_64` with `aarch64`.

```sh
sudo apt-get update
sudo apt-get install -y build-essential musl-tools curl git ca-certificates
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
. "$HOME/.cargo/env"
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
rustup toolchain install 1.98.1 --profile minimal --target x86_64-unknown-linux-musl
CC_x86_64_unknown_linux_musl=musl-gcc cargo build --release --locked -p oleafly-server --target x86_64-unknown-linux-musl
sudo install -m 0755 src-tauri/target/x86_64-unknown-linux-musl/release/oleafly-server /usr/local/bin/oleafly-server
oleafly-server --version
```

Compiling needs more memory than running. If the build stops because the machine ran out of memory, build on a larger Linux machine with the same kind of processor and copy the file over, or build on any computer with Docker, from the `Oleafly` folder:

```sh
docker buildx build --platform linux/amd64 --target binary --output type=local,dest=dist -f crates/oleafly-server/Dockerfile .
```

This writes `dist/oleafly-server`. Use `--platform linux/arm64` for an ARM server. Copy the file to `/usr/local/bin/oleafly-server` on the server and make it executable.

### Run it with systemd

1. Create the settings file. Only root can read it:

   ```sh
   sudo install -d -m 0755 /etc/oleafly-server
   sudo install -m 0600 /dev/null /etc/oleafly-server/oleafly-server.env
   sudoedit /etc/oleafly-server/oleafly-server.env
   ```

   Put one setting per line. `OLEAFLY_BIND=127.0.0.1:8080` keeps the server off the network so only Caddy can reach it. Don't set `OLEAFLY_DATA_DIR`, because the unit sets it.

   ```ini
   OLEAFLY_PUBLIC_URL=https://collab.example.org
   OLEAFLY_BIND=127.0.0.1:8080
   OLEAFLY_BEHIND_PROXY=true
   OLEAFLY_SERVER_NAME=Smith Lab
   OLEAFLY_GITHUB_CLIENT_ID=Ov23liExampleClientId
   OLEAFLY_GITHUB_CLIENT_SECRET=example-client-secret
   ```

2. Install and start the unit from the `Oleafly` folder, then find the setup code:

   ```sh
   sudo install -m 0644 deploy/server/oleafly-server.service /etc/systemd/system/oleafly-server.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now oleafly-server
   sudo journalctl -u oleafly-server | grep 'Setup code'
   ```

The unit runs the server as a user that systemd creates for it, with a read-only view of the rest of the system. The only place it can write is `/var/lib/oleafly-server`, where it keeps its data. On disk that folder is `/var/lib/private/oleafly-server`.

To keep the client secret out of the settings file, use a systemd credential. Save the secret in `/etc/oleafly-server/github-client-secret` with mode 600, delete the `OLEAFLY_GITHUB_CLIENT_SECRET` line from the settings file, run `sudo systemctl edit oleafly-server`, and add:

```ini
[Service]
LoadCredential=github-client-secret:/etc/oleafly-server/github-client-secret
Environment=OLEAFLY_GITHUB_CLIENT_SECRET_FILE=%d/github-client-secret
```

Then run `sudo systemctl restart oleafly-server`.

### Put HTTPS in front

Install Caddy with [its instructions for your distribution](https://caddyserver.com/docs/install). Replace `/etc/caddy/Caddyfile` with the lines below and run `sudo systemctl reload caddy`. Caddy gets the certificate and passes WebSocket connections through.

```
collab.example.org {
	reverse_proxy 127.0.0.1:8080
}
```

If your university already runs the web server in front, read the next section instead.

## Behind a university proxy

When your university's web server handles HTTPS and forwards requests to Oleafly Server:

- Run the server where only the proxy can reach it. On the same machine, use `OLEAFLY_BIND=127.0.0.1:8080`.
- Set `OLEAFLY_BEHIND_PROXY=true`. The server then takes the client's address from `X-Forwarded-For`. Turn it on only when every request comes through the proxy. Otherwise anyone can put a fake address in the security log.
- If the server lives under a path, include the path in `OLEAFLY_PUBLIC_URL`, for example `https://www.cs.example.edu/oleafly`, and in the callback addresses you register with sign-in providers. The server answers both with and without that path, so your proxy can pass it on or strip it, whichever suits its configuration.

The proxy has to:

- pass WebSocket upgrades through,
- set `X-Forwarded-For` to the client's address,
- let WebSocket connections stay open for a long time, at least an hour,
- accept requests as large as `OLEAFLY_MAX_PROJECT_MB`.

For nginx, this example keeps the path. Put the `map` block in the `http` section:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

and the `location` block in your `server` block:

```nginx
location /oleafly/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
    client_max_body_size 200m;
}
```

If your university signs its own certificates, for the proxy or for its sign-in service, install its certificate authority on the server's machine (or, with Docker, in the server's image) and on every computer that runs Oleafly. Both trust the operating system's certificates as well as the usual public ones.

## Without a public address

If the machine has no public address, for example a computer in your lab behind the university firewall, Cloudflare Tunnel can make it reachable. You need a Cloudflare account with your domain on it. Cloudflare handles HTTPS for the hostname, so requests are decrypted on Cloudflare's network before they reach your machine. Count Cloudflare among the parties that can read traffic to your server.

1. Follow the [Docker Compose](#docker-compose) steps up to editing `.env`. Set `OLEAFLY_DOMAIN` to the hostname you will use, such as `collab.example.org`.
2. Start only the server. Caddy isn't needed here:

   ```sh
   docker compose up -d --build oleafly-server
   ```

3. In the Cloudflare dashboard, go to **Networking › Tunnels**, select **Create Tunnel**, give it a name, and select **Create Tunnel** again. Copy the token from the install command it shows.
4. Start the tunnel next to the server. The `read` command waits for you to paste the token and doesn't show it:

   ```sh
   read -rs TUNNEL_TOKEN && export TUNNEL_TOKEN
   docker run -d --name oleafly-tunnel --restart unless-stopped --network oleafly-server_default -e TUNNEL_TOKEN cloudflare/cloudflared:2026.10.0 tunnel --no-autoupdate run
   ```

5. Back in the dashboard, open the tunnel. Under **Routes**, select **Add route**, then **Published application**. Under **Hostname**, enter the subdomain and pick your domain. Set **Service URL** to `http://oleafly-server:8080` and select **Add route**.

When you update the server later, name the service so Caddy stays off: `docker compose up -d --build oleafly-server`.

## Sign-in providers

People sign in through providers you configure, so the server never handles passwords. Configure at least one. Each provider sends people back to a callback address on your server:

`https://collab.example.org/auth/callback/<provider>`

If `OLEAFLY_PUBLIC_URL` has a path, so does the callback address, for example `https://www.cs.example.edu/oleafly/auth/callback/github`.

### GitHub

1. On GitHub, click your profile picture, then **Settings › Developer settings › OAuth apps**, and select **New OAuth App**. For an app owned by an organization, use **Developer settings** in the organization's settings instead.
2. Fill in **Application name** (for example `Smith Lab Oleafly`), **Homepage URL** (`https://collab.example.org`) and **Authorization callback URL** (`https://collab.example.org/auth/callback/github`). Leave **Enable Device Flow** off.
3. Select **Register application**. Copy the **Client ID**, then select **Generate a new client secret** and copy the secret.
4. Set `OLEAFLY_GITHUB_CLIENT_ID` and `OLEAFLY_GITHUB_CLIENT_SECRET`, and restart the server.

The server asks GitHub only for the person's profile and email addresses (`read:user` and `user:email`).

For GitHub Enterprise Server, register the app there and also set `OLEAFLY_GITHUB_URL` to its address, such as `https://github.example.edu`.

### OpenID Connect

OpenID Connect covers GitLab, Google, Microsoft Entra ID, Keycloak, Authentik, Okta and most university single sign-on systems. If your university only offers SAML, put Keycloak or Dex in between. This page doesn't cover that setup.

1. Pick a short name made of letters and digits, such as `GITLAB`. It becomes part of the variable names, and in lower case it becomes part of the callback address. In the Compose `.env`, rename the `UNIVERSITY` lines or add a second block.
2. Register an application with your provider. Choose a confidential or web application, set the redirect URI to `https://collab.example.org/auth/callback/gitlab`, and allow the scopes `openid`, `email` and `profile`.
3. Add the provider's details:

   ```ini
   OLEAFLY_OIDC_GITLAB_ISSUER=https://gitlab.com
   OLEAFLY_OIDC_GITLAB_CLIENT_ID=example-client-id
   OLEAFLY_OIDC_GITLAB_CLIENT_SECRET=example-client-secret
   OLEAFLY_OIDC_GITLAB_LABEL=GitLab
   ```

4. Restart the server.

The issuer is the address under which the provider publishes `/.well-known/openid-configuration`. Some common ones:

| Provider | Issuer |
| --- | --- |
| GitLab.com | `https://gitlab.com` |
| Self-managed GitLab | Your GitLab address, such as `https://gitlab.example.edu` |
| Google | `https://accounts.google.com` |
| Microsoft Entra ID | `https://login.microsoftonline.com/` followed by your tenant ID and `/v2.0` |
| Keycloak | `https://sso.example.edu/realms/` followed by the realm name |

### Email addresses

Allowlist entries and domain rules only match verified email addresses. The server counts an address as verified only when the provider says so: GitHub marks it verified, or the OpenID Connect claim `email_verified` is `true`.

Some institutional providers leave that claim out. If yours does, and it only hands out addresses your institution controls, set `OLEAFLY_OIDC_<NAME>_TRUST_EMAIL=true`. Never set it for a provider where people can type in any email address they like, because anyone could then sign in as someone on your allowlist.

## Become the first admin

A new server has no admin. Until someone finishes setup, the server makes a new one-time setup code each time it starts and writes it to its log, and Oleafly sees that the server needs setup.

1. Find the newest line that starts with `Setup code:` in the log:
   - Docker Compose: `docker compose logs oleafly-server | grep 'Setup code'`
   - Coolify: the logs of the `oleafly-server` service
   - systemd: `sudo journalctl -u oleafly-server | grep 'Setup code'`
2. In Oleafly, open **Settings › Collaboration**, select **Add server**, and enter your server's address. Oleafly asks for the setup code.
3. Enter the code and sign in with any provider you configured. You become the server's admin, and the code stops working.

Anyone who has the code before you use it can make themselves admin, so only ever paste it into Oleafly.

If you set `OLEAFLY_SETUP_CODE`, the server never prints your code. The log only says `Setup code: set by OLEAFLY_SETUP_CODE`, and you enter the value you set. Remove it from your settings once setup is done.

Then add people under **Manage server**. Once you've added them, they can add the server in Oleafly.

You can add a person by email address, by GitHub user name, or let everyone with a verified address at your domain in. User names work only for GitHub, because other providers let people choose or change theirs. Someone you remove stays out, even when a domain rule covers their address. To let them back in, add them again by email address or user name.

The server limits how often one address can start a sign-in or open a live connection, so a flood of requests can't fill its database. People signing in normally never reach the limit.

## Email

Email is optional, and everything else works without it. Without email you send people the server's address yourself, and Oleafly lists the projects that have been shared with each person.

To set it up, give the server an SMTP account:

```ini
OLEAFLY_SMTP_URL=smtps://oleafly%40example.org:example-app-password@smtp.example.org:465
OLEAFLY_MAIL_FROM=Smith Lab <oleafly@example.org>
```

Set both lines or neither. Write special characters in the user name and password in URL form, for example `%40` for `@`.

This version checks these settings when it starts, but it doesn't send email yet. Until a version that sends email, Oleafly shows email as off for this server even with these lines set.

## Backups

Everything the server keeps is in its data folder. Back it up regularly and keep the copies private, since they hold every project.

With Docker Compose, the server stops for a few seconds while you copy the volume. Oleafly reconnects by itself.

```sh
cd Oleafly/deploy/server
docker compose stop oleafly-server
docker run --rm -v oleafly-server_oleafly-data:/data:ro -v "$PWD":/backup debian:13.7-slim tar -C /data -czf /backup/oleafly-data-$(date +%F).tar.gz .
docker compose start oleafly-server
```

With systemd:

```sh
sudo systemctl stop oleafly-server
sudo tar -C /var/lib/private/oleafly-server -czf /root/oleafly-data-$(date +%F).tar.gz .
sudo systemctl start oleafly-server
```

Copy the archive to another machine.

### Restore drill

A backup you have never restored is only a hope. This drill starts a second copy of the server from a backup, leaves the running one alone, and checks that both are the same server. Use the date of your own archive in place of `2026-10-11`.

```sh
cd Oleafly/deploy/server
docker volume create oleafly-restore-drill
docker run --rm -v oleafly-restore-drill:/data -v "$PWD":/backup:ro debian:13.7-slim tar -C /data -xzf /backup/oleafly-data-2026-10-11.tar.gz
docker run -d --name oleafly-restore-drill -v oleafly-restore-drill:/data -e OLEAFLY_PUBLIC_URL=https://restore-drill.invalid "$(docker compose images -q oleafly-server)"
docker run --rm --network container:oleafly-restore-drill curlimages/curl:8.22.0 -fsS --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8080/.well-known/oleafly-server
curl -fsS https://collab.example.org/.well-known/oleafly-server
```

The `server_id` in the two answers must match. The drill copy has no sign-in providers and no open port, so nobody can use it. Remove it when you're done:

```sh
docker rm -f oleafly-restore-drill
docker volume rm oleafly-restore-drill
```

### Restore

To restore for real with Docker Compose, stop the server, replace the volume's contents with the archive, and start it again:

```sh
cd Oleafly/deploy/server
docker compose stop oleafly-server
docker run --rm -v oleafly-server_oleafly-data:/data -v "$PWD":/backup:ro debian:13.7-slim sh -c 'find /data -mindepth 1 -delete && tar -C /data -xzf /backup/oleafly-data-2026-10-11.tar.gz'
docker compose start oleafly-server
```

With systemd:

```sh
sudo systemctl stop oleafly-server
sudo find /var/lib/private/oleafly-server -mindepth 1 -delete
sudo tar -C /var/lib/private/oleafly-server -xzf /root/oleafly-data-2026-10-11.tar.gz
sudo systemctl start oleafly-server
```

## Upgrading

Back up first. The server updates its database the first time a new version starts, so going back to an older version means restoring the backup you took before upgrading.

- Docker Compose: run `git pull` in the `Oleafly` folder, then `docker compose up -d --build` in `deploy/server`.
- Coolify: select **Redeploy**.
- systemd: run `git pull` in the `Oleafly` folder, run the `cargo build` and `sudo install` commands from [Build the server](#build-the-server) again, then run `sudo systemctl restart oleafly-server`.

Oleafly checks the server's version every time it connects. If the app and the server can't work together, Oleafly says which one needs an update.

## Roles and permissions

Each person has one server role, given by the server's admins and maintainers. In each project they were added to, they also have a project role, given by that project's owner. This version runs the server roles. Sharing projects comes in a later version, so the project columns, and the rows about projects, the member list and project access logs, describe how that will work. A cell says whether that role on its own allows the action. No server role opens a project by itself: project access comes only from the project's owner.

| Action | Admin | Maintainer | Member | Guest | Owner | Editor | Viewer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Add the server to Oleafly | Yes | Yes | Yes | Yes | n/a | n/a | n/a |
| See the member list | Yes | Yes | Yes, unless the admin hides it | No | n/a | n/a | n/a |
| Share a project | Yes | Yes | Yes | No | n/a | n/a | n/a |
| Add people to a project | No | No | No | No | Yes | No | No |
| Change project roles | No | No | No | No | Yes | No | No |
| Turn on link sharing | No | No | No | No | Yes, if the server allows it | No | No |
| Open a project | No | No | No | No | Yes | Yes | Yes |
| Edit | No | No | No | No | Yes | Yes | No |
| Compile | No | No | No | No | Yes | Yes | Yes |
| Read the project access log | No | No | No | No | Yes, when it is on | No | No |
| Read the security log | Yes | Yes | No | No | Entries about the project | No | No |
| Add members to the server | Yes | Yes | No | No | n/a | n/a | n/a |
| Appoint maintainers | Yes | No | No | No | n/a | n/a | n/a |
| Change server settings | Yes | No | No | No | n/a | n/a | n/a |
| Delete a project | Yes, to free storage | No | No | No | Yes, by stopping sharing | No | No |
| Sign out someone's device | Yes | Yes | Own devices only | Own devices only | n/a | n/a | n/a |
| Read stored projects with direct server access | Not in the app | Not in the app | Not in the app | Not in the app | n/a | n/a | n/a |

The last row matters most. Projects are not encrypted on the server, so whoever runs the machine can read every stored project, whatever their role. Oleafly gives no role, admin included, a way to do it from the app. When an admin deletes a project to free storage, its owner and members are told, and their own copies stay on their computers.

## Checking the server

- `https://collab.example.org/healthz` answers `200` while the server runs. `/readyz` answers `200` once its database is ready.
- The Docker image checks `/healthz` by itself, so `docker ps` and Coolify show whether the server is healthy.
- In Oleafly, **Test connection** under **Settings › Collaboration** checks the address, HTTPS, the version, WebSocket connections, sign-in providers and the server's clock, and names the first problem it finds.
- A certificate error from Oleafly or in the server's log usually means a certificate authority that the machine doesn't trust yet. Read the end of [Behind a university proxy](#behind-a-university-proxy).
