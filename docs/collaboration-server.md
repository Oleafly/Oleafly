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
- **The security log.** Sign-ins and refused sign-ins, devices added and signed out, changes to members, roles and settings, projects shared, archived and restored, changes to who can open a project, and guest invitations, each with the time and the IP address. Entries older than `OLEAFLY_SECURITY_LOG_DAYS` days are deleted.
- **Server settings** that admins change in Oleafly.
- **Project access logs**, for projects whose owner turns one on: who opened the project, joined it or downloaded a copy, with the device name and the time. Only the project's owner can read it. Entries older than `OLEAFLY_SECURITY_LOG_DAYS` days are deleted, as in the security log.
- **Guest invitations**: the invited email address, the project, the role and who sent it. Answered and expired invitations are deleted `OLEAFLY_SECURITY_LOG_DAYS` days after they were answered or expired.
- **Shared projects.** Every file and the full history of changes. Files a project no longer uses, such as the old copy of a figure someone replaced, are deleted 30 days after the project last used them. A file uploaded for a change that hasn't reached the server yet is kept for those 30 days as well. When an owner stops sharing a project, the server keeps it read-only for `OLEAFLY_ARCHIVE_DAYS` days and then deletes it. In that time only the owner and any admins in the project can download it.

**Projects are not encrypted on the server.** Anyone who can read the data folder, the machine's disk or your backups can read every project stored there. That includes whoever runs the machine and the company that hosts it. Inside Oleafly the rules are stricter: no server role, admin included, can open a project unless the project's owner added them. If you need to keep a project away from the people who run a server, run your own server for it.

Every member's computer also keeps a full copy of each project shared with them. Ask members to turn on disk encryption, such as FileVault on macOS, BitLocker on Windows or LUKS on Linux.

## Before you start

You need:

- A Linux machine that stays on, or an account with a hosting service such as Render or Railway. A small virtual machine is enough to start. Keep an eye on its memory and disk as your projects grow. The machine needs an IPv4 connection, or NAT64, because GitHub, where the releases and the server image live, only works over IPv4. On a Windows PC or a Mac, read [On Windows or macOS](#on-windows-or-macos).
- A domain name for the server, such as `collab.example.org`, with a DNS record pointing at the machine. Render and Railway give you an address if you don't have one. If the machine has no public address, read [Without a public address](#without-a-public-address).
- A way for people to sign in: GitHub, or an OpenID Connect login such as your university's. The server won't start without one. Email is optional. Read [Sign-in providers](#sign-in-providers).

Then pick how to run it:

| Option | When to use it |
| --- | --- |
| [One command](#install-with-one-command) | A Linux machine of your own with a public address. The installer asks a few questions and sets up Docker Compose for you. |
| [Docker Compose](#docker-compose) | Any machine with Docker. Caddy gets the HTTPS certificate for you. |
| [Coolify](#coolify) | You already run a Coolify server. |
| [Render](#render) or [Railway](#railway) | You'd rather pay a hosting service than look after a machine. |
| [Linux without Docker](#linux-without-docker) | A university virtual machine where you can't use Docker. |

The server runs on x86-64 and ARM machines. Each release is published as a container image, `ghcr.io/oleafly/oleafly-server`, and as a single Linux program on the [releases page](https://github.com/Oleafly/Oleafly/releases). The installer and its Compose files are also on the releases page of [Oleafly/oleafly-server](https://github.com/Oleafly/oleafly-server/releases).

### On Windows or macOS

The server runs on Linux. From a Windows PC or a Mac, the simplest way is to rent a small Linux virtual machine from a hosting company and run the [one command](#install-with-one-command) there over SSH. A Linux machine in your lab works too, with [Cloudflare Tunnel](#without-a-public-address) if it has no public address. Docker Desktop on Windows or macOS is only good for trying the server on your own computer, because it stops whenever the computer sleeps. The installer refuses to run in WSL: other computers can't reach a server there, and it stops when Windows sleeps.

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
| `OLEAFLY_BLOB_STORE` | Where files such as figures and PDFs are stored. `fs` keeps them in `OLEAFLY_DATA_DIR`. An address such as `s3://lab-bucket` or `s3://lab-bucket/oleafly` keeps them in a bucket. Read [Files in a bucket](#files-in-a-bucket). | `fs` |
| `OLEAFLY_S3_ENDPOINT` | The address of an S3-compatible store other than Amazon S3, such as MinIO or Cloudflare R2. Leave it empty for Amazon S3. | Amazon S3 |
| `OLEAFLY_S3_REGION` | The bucket's region. | `us-east-1` |
| `OLEAFLY_S3_ACCESS_KEY_ID`, `OLEAFLY_S3_SECRET_ACCESS_KEY` | The key the server uses for the bucket. Required with an `s3://` address. | None |
| `OLEAFLY_MAX_PROJECT_MB` | The largest project the server accepts, in megabytes. | `200` |
| `OLEAFLY_MAX_FILE_MB` | The largest single file, in megabytes. | `50` |
| `OLEAFLY_MAX_MEMBERS_PER_PROJECT` | The most people on one project. | `20` |
| `OLEAFLY_SIGN_IN_BURST` | How many sign-in requests one network address can make in a burst. A sign-in takes about six, so the default covers 50 people at one address signing in at the same time. | `300` |
| `OLEAFLY_SIGN_IN_PER_MINUTE` | How many sign-in requests one network address gets back each minute after the burst. | `120` |
| `OLEAFLY_EMAIL_LINKS_PER_IP` | How many sign-in emails the server sends to people at one network address in 15 minutes. | `100` |
| `OLEAFLY_EMAIL_LINKS_PER_ADDRESS` | How many sign-in emails one email address can get in 15 minutes. It can't be more than `OLEAFLY_EMAIL_LINKS_PER_IP`. | `3` |
| `OLEAFLY_EMAIL_LINKS_PER_HOUR` | How many sign-in emails the whole server sends in an hour, all addresses together. A flood of requests from many addresses stops there instead of at your mail provider's limit. | `300` |
| `OLEAFLY_DEVICE_CODES_PER_IP` | How many sign-in codes people at one network address can ask for in 10 minutes. Read [Sign in with a code](#sign-in-with-a-code). | `100` |
| `OLEAFLY_SNAPSHOT_MEMORY_MB` | How much memory, in megabytes, the server may use to build project snapshots. A project that needs more keeps all its changes until you raise it. Read [Files in a bucket](#files-in-a-bucket). | Half of the smallest of the container's memory limit, the service's cgroup limit and the machine's memory |
| `OLEAFLY_BEHIND_PROXY` | Take each person's address from the `X-Forwarded-For` header your proxy adds. Read [What OLEAFLY_BEHIND_PROXY changes](#what-oleafly_behind_proxy-changes). The Compose, Coolify and Render files turn it on. | `false` |
| `OLEAFLY_PROXY_HOPS` | How many proxies every request passes through before it reaches the server. It needs `OLEAFLY_BEHIND_PROXY=true`. With more than one proxy, `OLEAFLY_TRUSTED_PROXIES` is safer. | `1` |
| `OLEAFLY_TRUSTED_PROXIES` | Your proxies' IP addresses and CIDR ranges, separated by commas. The server then uses `X-Forwarded-For` only on connections from them, and skips the trusted entries from the right to find the visitor. It needs `OLEAFLY_BEHIND_PROXY=true` and can't be combined with `OLEAFLY_PROXY_HOPS`. | None |
| `OLEAFLY_LOG_LEVEL` | How much the server logs: `error`, `warn`, `info`, `debug` or `trace`. Libraries the server uses only log warnings unless you pick `debug` or `trace`. | `info` |
| `OLEAFLY_SECURITY_LOG_DAYS` | How many days to keep security log entries, project access log entries and answered or expired guest invitations. | `365` |
| `OLEAFLY_ARCHIVE_DAYS` | How many days to keep a project after its owner stops sharing it. | `30` |
| `OLEAFLY_POLL_HOLD_SECONDS` | How long the server keeps a long-polling request open when no edits are waiting, from 1 to 40 seconds. Keep it a few seconds under the idle timeout of any proxy in front of the server. Read [When WebSocket connections are blocked](#when-websocket-connections-are-blocked). | `25` |

In the Compose `.env` file, put a value in single quotes if it contains `$` or `#`.

When the server starts, it warns about every variable whose name starts with `OLEAFLY_` but that it doesn't know, and suggests the closest name it does know. A typo such as `OLEAFLY_PROXY_HOP` then shows up in the log instead of being ignored.

### Keeping secrets in files

Seven settings can hold secrets: `OLEAFLY_SETUP_CODE`, `OLEAFLY_GITHUB_CLIENT_SECRET`, `OLEAFLY_OIDC_<NAME>_CLIENT_SECRET`, `OLEAFLY_SMTP_URL`, `OLEAFLY_BLOB_STORE`, `OLEAFLY_S3_ACCESS_KEY_ID` and `OLEAFLY_S3_SECRET_ACCESS_KEY`. Each one also has a `_FILE` version that names a file holding the value, for example `OLEAFLY_GITHUB_CLIENT_SECRET_FILE=/run/secrets/github_client_secret`. Set one of the two, not both. The server trims spaces and line breaks around the value in the file, the same as for a plain variable. The [Docker Compose](#docker-compose) and [systemd](#run-it-with-systemd) sections show how.

### Files in a bucket

By default the server keeps files in `OLEAFLY_DATA_DIR`. It can keep them in Amazon S3 instead, or in another store with an S3-compatible API, such as MinIO or Cloudflare R2. Project snapshots are stored in the same place as files. The database stays in `OLEAFLY_DATA_DIR` either way, so the server still needs its data folder.

1. Create a bucket and block public access to it.
2. Create a key that can read, write and delete objects in that bucket and nothing else. On Amazon S3 that means `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on `arn:aws:s3:::lab-bucket/*`, or on `arn:aws:s3:::lab-bucket/oleafly/*` if you use a folder.
3. Set the variables, for example in `.env`:

   ```sh
   OLEAFLY_BLOB_STORE=s3://lab-bucket/oleafly
   OLEAFLY_S3_REGION=eu-west-1
   OLEAFLY_S3_ACCESS_KEY_ID=your-access-key-id
   OLEAFLY_S3_SECRET_ACCESS_KEY=your-secret-access-key
   ```

For a store other than Amazon S3, also set `OLEAFLY_S3_ENDPOINT` to its address, such as `https://minio.example.org:9000` or `https://<account-id>.r2.cloudflarestorage.com`, and set `OLEAFLY_S3_REGION` to the region it expects (`auto` for R2). The server then puts the bucket name in the path of each request rather than in the host name. Plain `http://` works too, but use it only when the store sits on the same private network as the server.

The part after the bucket name is an optional folder. Each file is named after its SHA-256 hash and sits under the first two characters of that hash, so a file whose hash starts with `3f9a` is stored as `oleafly/3f/3f9a...`. When the server reads a file back, it checks the bytes against the hash and refuses a file that doesn't match.

Project snapshots have their own `snapshots` folder with a folder for each project, so a snapshot is stored as `oleafly/snapshots/<project id>/<hash>`. The server checks a snapshot against its hash when it reads it, the same as a file. Without a bucket, the same layout is in the `blobs` folder inside `OLEAFLY_DATA_DIR`.

When a project is shared, the owner's app uploads its first snapshot and signs it with that device's key. From then on the server builds every snapshot itself. It starts from the previous snapshot and adds the changes people sent since. A new snapshot is built once a project has 1,000 changes past the last one. The server always keeps at least the last 2,000 changes, so a device that was away for a short time catches up from those changes and doesn't download the whole project again. Old snapshots that nothing needs are removed as soon as a newer one is stored.

Building a snapshot needs about ten times the size of the previous snapshot plus the changes since it. The server only starts a build that fits in `OLEAFLY_SNAPSHOT_MEMORY_MB`, and builds running at the same time share that amount. If a build doesn't fit, the server skips it, logs how much memory it needs, and keeps all the project's changes. Devices then catch up from those changes a few megabytes at a time. Raise the setting and the next snapshot gets built. The server also won't store a snapshot larger than `OLEAFLY_MAX_PROJECT_MB`.

Every change records which internal writer ids it adds text under. The server ties each writer id to the first device that used it. It refuses a change that adds text under a writer id another device already used, and it refuses anything that isn't a valid document change. Apps check the same rule before they apply a change. They also read the list of writer ids from `GET /api/v1/projects/{id}/peers` to tell who wrote each comment.

If a setting is missing or malformed, the server doesn't start and says which one. If the bucket refuses a request, that upload or download fails and the server log shows what the bucket said, such as `403 Forbidden (AccessDenied)`. A server error, a timeout or a dropped connection is different: the server tries the request up to three times, with a short random pause in between. A download gives up when the bucket hasn't started answering after 10 seconds, or when the whole object takes longer than 30 seconds plus one second for every 256 KB. If the server can't delete an object, it writes that down and tries again at each maintenance pass, every 6 hours, so an outage doesn't leave objects behind.

## Install with one command

On a Linux machine with a public address, one command does the [Docker Compose](#docker-compose) setup for you:

```sh
curl -fsSL https://oleafly.com/server/install.sh | sudo sh
```

Point your domain's DNS record at the machine first. The installer then:

1. Checks that the machine runs Linux on x86-64 or ARM and that ports 80 and 443 are free.
2. Uses Docker if it's there. If it isn't, it asks before it installs Docker with Docker's own install script. It downloads a fixed version of that script and checks it against a known SHA-256 first, and won't run a copy that doesn't match. That script works on Ubuntu, Debian, Raspberry Pi OS, Fedora, CentOS, RHEL and Rocky Linux. On Amazon Linux, AlmaLinux and Oracle Linux, the installer prints the commands that install Docker and its Compose plugin there instead, and stops so you can run them.
3. Asks for the domain, the server's name and a sign-in provider. It shows the callback address for GitHub or OpenID Connect before it asks for the client ID, so you can create the app while it waits. It can also set up [email](#email) and a [bucket for files](#files-in-a-bucket).
4. Checks that the domain points to this machine. If it doesn't yet, the installer says so and carries on, and Caddy keeps trying to get the certificate. To find the machine's public address, it may ask `ifconfig.me`.
5. Downloads the release's `docker-compose.yml`, `Caddyfile`, `litestream.yml` and `.env.example` into `/opt/oleafly-server`, and checks each one against the release's `SHA256SUMS`.
6. Writes your settings to `/opt/oleafly-server/.env`, which only root can read, then pulls the server image and starts it.
7. Waits until `https://<your domain>/healthz` answers on the machine itself, then prints the setup code and the next steps. Open that address on a phone or from another network to check that other people can reach it too. If it doesn't answer, check that TCP ports 80 and 443 and UDP port 443 are open in any firewall or cloud security group in front of the machine.

Sign-in by email link is off until an admin turns it on, so the first admin signs in with GitHub or OpenID Connect. Email set up by the installer works for invitations and alerts straight away.

Run it again at any time. When `/opt/oleafly-server/.env` exists, the installer keeps it, replaces only the files that come with a release, and starts the server again. That also works when `.env` is the only file there, for example after you started the [Docker Compose](#docker-compose) steps in that folder.

These commands work on a server the installer set up:

| Command | What it does |
| --- | --- |
| `curl -fsSL https://oleafly.com/server/install.sh \| sudo sh -s update` | Gets the newest release's files and image, keeps `.env`, restarts the server and waits until it's ready. It never moves to an older release. Read [Upgrading](#upgrading). |
| `sudo sh /opt/oleafly-server/install.sh status` | Shows the version, the containers and whether HTTPS answers. Until someone finishes setup, it also shows the current setup code. |
| `sudo sh /opt/oleafly-server/install.sh uninstall` | Stops and removes the containers. The data stays unless you type `delete` when it asks. |
| `sh install.sh --help` | Lists every option and setting. |

The files that come with a release are replaced on each update. Put your own changes in `docker-compose.override.yml` next to them, which the installer never touches.

Typing `delete` during `uninstall` removes the data volume, `.env` and the copies the installer made before updates. Files and snapshots in a bucket and Litestream's copies of the database stay where they are, and the installer names them so you can delete them with your storage provider. Caddy's certificates stay too, in the volumes `oleafly-server_caddy-data` and `oleafly-server_caddy-config`, so a new install doesn't have to ask Let's Encrypt again. Let's Encrypt gives out at most five certificates for the same domain in a week.

To install without questions, for example from a provisioning script, pass `--yes` and put the settings in a file. They have the same names as in `.env`. Don't put secrets on the `sudo` command line: sudo writes the whole line to the system log, such as `/var/log/auth.log`, and every user on the machine can see it with `ps` while the installer runs. With a file, only its name ends up there:

```sh
sudo install -m 600 /dev/null /root/oleafly-answers.env
sudoedit /root/oleafly-answers.env
curl -fsSL https://oleafly.com/server/install.sh | sudo OLEAFLY_ANSWERS_FILE=/root/oleafly-answers.env sh -s -- --yes
```

Write one setting per line:

```ini
OLEAFLY_DOMAIN=collab.example.org
OLEAFLY_SERVER_NAME='Smith Lab'
OLEAFLY_GITHUB_CLIENT_ID=Ov23liExampleClientId
OLEAFLY_GITHUB_CLIENT_SECRET=example-client-secret
```

Lines that start with `#` are skipped, and a value can be in single or double quotes. The installer reads the file as plain text and never runs it. A setting that is also in the environment keeps the environment's value. The settings end up in `/opt/oleafly-server/.env`, so you can delete the file afterwards.

With `--yes`, the installer stops if Docker is missing, unless you also set `OLEAFLY_INSTALL_DOCKER=yes`. Set `OLEAFLY_DIR` to install somewhere other than `/opt/oleafly-server`. `sh install.sh --help` lists every setting.

## Docker Compose

This setup runs two containers. `oleafly-server` is the server, and only other containers can reach it. `caddy` gets a certificate from Let's Encrypt, serves HTTPS on ports 80 and 443, and passes requests to the server, WebSocket connections included.

1. Install Docker Engine and the Compose plugin by following [Docker's instructions](https://docs.docker.com/engine/install/).
2. Point your domain's DNS record at the machine. Open TCP ports 80 and 443 and UDP port 443 in any firewall in front of it. Caddy needs port 80 to get the certificate.
3. Get the files of the newest release, check them, and make your settings file. Run these as root, for example after `sudo -i`:

   ```sh
   mkdir -p /opt/oleafly-server && cd /opt/oleafly-server
   base=https://github.com/Oleafly/oleafly-server/releases/latest/download
   for file in docker-compose.yml Caddyfile litestream.yml env.example SHA256SUMS; do curl -fLO "$base/$file"; done
   sha256sum --check --ignore-missing SHA256SUMS
   mv env.example .env
   chmod 600 .env
   ```

4. Edit `.env`. Set `OLEAFLY_DOMAIN` to your domain without `https://`, set `OLEAFLY_SERVER_NAME`, and fill in at least one [sign-in provider](#sign-in-providers). Leave the provider lines you don't use empty.
5. Start it:

   ```sh
   docker compose up -d
   ```

   Docker downloads the server image for that release. To build the server from source instead, clone the Oleafly repository and run `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` in its `deploy/server` folder. The first build compiles the server and takes several minutes.
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

If your domain has an AAAA record, set `OLEAFLY_IPV6=true` in `.env`. Without it, Docker hands every visitor who comes in over IPv6 to Caddy from one internal address, so the security log shows that address for all of them and they share one sign-in limit. It needs Docker 27 or newer and a public IPv6 address on the machine, and the one-command installer turns it on when both are there. With an older Docker, give the domain only an A record. If you change the setting later, run `docker compose down` and then `docker compose up -d`, so Docker creates the network again. If the installer says Docker couldn't set up IPv6 for the network, set `OLEAFLY_IPV6=false` in `.env` and run the installer again.

If you change the `Caddyfile`, run `docker compose up -d --force-recreate caddy`.

To copy the database to a bucket as it changes, add the Litestream service. Read [Continuous copies with Litestream](#continuous-copies-with-litestream).

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

Coolify puts its own proxy in front of the server and gets the certificate, so this setup has no Caddy. Coolify can build the server from the Oleafly repository, or run the [published image](#deploy-the-published-image), which skips the build.

Before you start, point your domain's DNS record, such as `collab.example.org`, at the Coolify server. Then create the GitHub OAuth app as described under [GitHub](#github), with the callback address `https://collab.example.org/auth/callback/github`, and keep its client ID and secret at hand.

### Build from the repository

1. In your Coolify project, select **+ New**, then **Public Repository**, and enter `https://github.com/Oleafly/Oleafly`. Keep the branch `main`.
2. Set **Build Pack** to **Docker Compose**, **Base Directory** to `/` and **Docker Compose Location** to `/deploy/server/docker-compose.coolify.yml`, then select **Continue**.
3. Under **Advanced › Build**, set **Build arguments** to **Managed manually in Dockerfile**. The server's image needs no build arguments. Left on automatic, Coolify writes every variable, secrets included, into the image's build history.
4. Under **General**, set the domain of `oleafly-server` to `https://collab.example.org:8080` and save. The `:8080` tells Coolify's proxy which port the server listens on. People still connect on the usual HTTPS port, and Coolify sets `OLEAFLY_PUBLIC_URL` to `https://collab.example.org` for you.
5. Under **Environment Variables**, fill in `OLEAFLY_SERVER_NAME`, which Coolify marks as required, then `OLEAFLY_GITHUB_CLIENT_ID` and `OLEAFLY_GITHUB_CLIENT_SECRET`. Leave the variables you don't use empty. [Settings](#settings) explains each one.
6. Select **Deploy**. The first build compiles the server and takes a few minutes. When it's done, Coolify shows the resource as running and healthy.
7. Open `https://collab.example.org/healthz` in a browser. It shows `{"status":"ok"}`.
8. Open **Logs**, choose the `oleafly-server` container, and copy the code from the newest line that starts with `Setup code:`.
9. In Oleafly, turn on **Live collaboration** in **Settings › Experimentation**. Then open **Settings › Collaboration**, select **Add server**, enter `https://collab.example.org`, then the setup code, and sign in with GitHub. You are now the server's admin. [Become the first admin](#become-the-first-admin) covers what comes next.

If the server doesn't start, its log names the setting it can't use. When it says `OLEAFLY_PUBLIC_URL` is not set, step 4 is missing. A domain that starts with `http://` is refused, because the server needs HTTPS.

If Cloudflare sits in front of Coolify, because your DNS record goes through Cloudflare's proxy or a tunnel leads to Coolify's proxy, set `OLEAFLY_TRUSTED_PROXIES`. Without it, the security log shows the proxy's address for everyone, and they all share one sign-in limit. Behind Cloudflare's proxy, list [Cloudflare's published ranges](https://www.cloudflare.com/ips/) plus the range of Docker's `coolify` network, separated by commas. Find that range with `docker network inspect coolify --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'`. Behind a tunnel, the `coolify` network's range is enough. Cloudflare changes its list now and then, so check it when you update the server. [What OLEAFLY_BEHIND_PROXY changes](#what-oleafly_behind_proxy-changes) explains the other choice, `OLEAFLY_PROXY_HOPS=2`, and why it needs more care.

The Coolify file has room for GitHub and one OpenID Connect provider named `UNIVERSITY`. Set `OLEAFLY_OIDC_UNIVERSITY_LABEL` to the text people should see, such as `GitLab`. Its callback address ends in `/auth/callback/university`. For more providers, deploy from a fork with your own copy of the file.

The data lives in a Docker volume whose name ends in `oleafly-data`. Find it with `docker volume ls --filter name=oleafly-data`. The image has no shell, so Coolify's **Terminal** can't open one in the server's container. Logs and the health check work as usual.

### Deploy the published image

Each server release is published as `ghcr.io/oleafly/oleafly-server`, for x86-64 and ARM. Running it skips the build, which suits a small Coolify server.

Follow the steps above with two changes. In step 2, set **Docker Compose Location** to `/deploy/server/docker-compose.coolify-image.yml`. Skip step 3, because nothing gets built. The file asks for the `0.1` tag, which moves to each `0.1` release once it is published, so each **Redeploy** pulls the newest one.

## Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Oleafly/Oleafly)

The button reads [`render.yaml`](../render.yaml) from the Oleafly repository. It creates one web service from the published image, with a 1 GB disk for the data folder. Render attaches disks only to paid instance types, so the service starts on the smallest paid one, in Render's Oregon region. For another region, deploy from a fork with `region` set in `render.yaml`.

1. Select the button and sign in to Render.
2. Render asks for `OLEAFLY_SERVER_NAME` and the GitHub client ID and secret. Fill in the name and leave the GitHub fields empty for now. Their callback address depends on the service's address, which you don't have yet.
3. Select **Deploy Blueprint**. Once the service is live, its page shows its address, such as `https://oleafly-server.onrender.com`. The Blueprint sets `OLEAFLY_PUBLIC_URL` to that address.
4. Create the GitHub OAuth app as described under [GitHub](#github), with that address followed by `/auth/callback/github` as the callback address. Add the client ID and secret under the service's **Environment**. Render restarts the server with them.
5. Find the newest `Setup code:` line in the service's **Logs** and [become the first admin](#become-the-first-admin).

If you give the service your own domain, set `OLEAFLY_PUBLIC_URL` to it under **Environment** and change the callback address at GitHub to match.

Because of the disk, Render stops the running server before it starts the new one, so each deploy takes the server away for a few seconds. Oleafly reconnects by itself.

## Railway

Railway runs the published image, with a volume for the data folder.

1. In a Railway project, select **+ New**, then **Docker Image**, and enter `ghcr.io/oleafly/oleafly-server:0.1`. Railway may start a first deploy straight away. It stops with `OLEAFLY_PUBLIC_URL is not set`, which is expected at this point.
2. Open the service. Under **Settings › Networking**, select **Generate Domain** and enter port `8080`. Railway shows the address, such as `oleafly-server-production.up.railway.app`.
3. Under **Settings › Deploy**, set **Healthcheck Path** to `/readyz`.
4. Right-click the project canvas, add a volume, attach it to the server's service and set its mount path to `/data`.
5. Under **Variables**, open the **Raw Editor** and paste these lines with your own server name. For the GitHub values, follow [GitHub](#github). The callback address is your address from step 2 with `https://` in front and `/auth/callback/github` after it, such as `https://oleafly-server-production.up.railway.app/auth/callback/github`.

   ```ini
   OLEAFLY_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   OLEAFLY_BIND=0.0.0.0:8080
   OLEAFLY_DATA_DIR=/data
   OLEAFLY_BEHIND_PROXY=true
   OLEAFLY_SERVER_NAME=Smith Lab
   OLEAFLY_GITHUB_CLIENT_ID=Ov23liExampleClientId
   OLEAFLY_GITHUB_CLIENT_SECRET=example-client-secret
   PORT=8080
   RAILWAY_RUN_UID=0
   ```

   Railway mounts volumes as root. `RAILWAY_RUN_UID=0` runs the server as root so it can write to the volume.

6. Deploy the changes. Find the newest `Setup code:` line in the service's **Deploy Logs** and [become the first admin](#become-the-first-admin).

## Linux without Docker

On a machine without Docker, the server runs as a single program under systemd, with Caddy in front for HTTPS.

### Download the server

Each server release on GitHub has a ready-built program for x86-64 and for ARM, and a `SHA256SUMS` file to check it against. It needs nothing else installed. Set `version` to the release you want, and on an ARM machine set `target` to `aarch64-unknown-linux-musl`:

```sh
version=0.1.0
target=x86_64-unknown-linux-musl
base="https://github.com/Oleafly/Oleafly/releases/download/server-v$version"
curl -fLO "$base/oleafly-server-$version-$target.tar.gz"
curl -fLO "$base/SHA256SUMS"
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf "oleafly-server-$version-$target.tar.gz"
sudo install -m 0755 "oleafly-server-$version-$target/oleafly-server" /usr/local/bin/oleafly-server
oleafly-server --version
```

The archive also holds the systemd unit, `oleafly-server.service`, so you can install it from the unpacked folder in [Run it with systemd](#run-it-with-systemd) instead of from `deploy/server`. With the GitHub CLI installed, `gh attestation verify "oleafly-server-$version-$target.tar.gz" --repo Oleafly/Oleafly` also checks that GitHub built the archive from the Oleafly repository.

To build the program yourself instead, follow the next section.

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

For nginx or Apache, or if your university already runs the web server in front, read [Behind a reverse proxy](#behind-a-reverse-proxy).

<a name="behind-a-university-proxy"></a>

## Behind a reverse proxy

The server speaks plain HTTP, so something in front of it handles HTTPS: Caddy in the Compose setup, Coolify's proxy, or a web server you already run, such as your university's. Whatever sits in front has to:

- accept requests as large as `OLEAFLY_MAX_PROJECT_MB`,
- add the client's address to `X-Forwarded-For`.

It should also pass WebSocket upgrades through to `/ws` and keep those connections open for at least an hour. Live editing uses them when it can. If they're blocked, live editing still works over slower HTTP long-polling. Read [When WebSocket connections are blocked](#when-websocket-connections-are-blocked).

Run the server where only the proxy can reach it. On the same machine, set `OLEAFLY_BIND=127.0.0.1:8080`. Then set `OLEAFLY_BEHIND_PROXY=true`.

### When WebSocket connections are blocked

Live editing normally runs over a WebSocket connection to `/ws`. Some networks block those, often a university or company network with a filtering proxy. Live editing still works there, just more slowly. When two WebSocket attempts in a row fail while the server still answers over HTTPS, Oleafly switches to HTTP long-polling. It sends edits to `/api/v1/projects/<project>/frames` and waits for other people's edits on `/api/v1/projects/<project>/poll`, holding each request open for up to 25 seconds, or for `OLEAFLY_POLL_HOLD_SECONDS` if you set it. Every edit still arrives. Oleafly tries a WebSocket again every minute and goes back to it as soon as one connects.

**Test connection** in Oleafly and **Connection checks** in the [admin console](#admin-console) say when this happens: "Live edits take a slower route because this network blocks the usual one. They still arrive."

If you run the proxy in front of the server, pass WebSocket upgrades through anyway. Long-polling works, but each batch of edits costs an extra request and a little more delay.

Some proxies close a request that stays quiet for less than 30 seconds, nginx with a short `proxy_read_timeout` for one. They answer those long-polling requests with a 502 or 504 error, and edits arrive late. Set `OLEAFLY_POLL_HOLD_SECONDS` a few seconds under that timeout, such as `8` for a 10-second timeout.

### What `OLEAFLY_BEHIND_PROXY` changes

The server notes a client address in two places: the security log, and the limits on how often one address can start a sign-in or open a live connection. Sign-ins from one address allow a burst of 300, then two a second. Change these with `OLEAFLY_SIGN_IN_BURST` and `OLEAFLY_SIGN_IN_PER_MINUTE`. Live connections have their own, larger limit, so a whole class behind one address can reconnect at once after a restart and still sign in. Only connections that fail to prove their session use it up: a burst of 300, then ten a second. A connection that proves its session counts against its own device instead, which can reconnect 60 times in a burst, then once a second. The server also pings each live connection every 30 seconds. It closes a connection that leaves those pings unanswered for 90 seconds, and one that stops reading what the server sends.

Without the setting, the server uses the address of whatever connected to it. Behind a proxy that is always the proxy, so everyone shares one limit and the security log shows only the proxy's address.

With `OLEAFLY_BEHIND_PROXY=true`, the server reads the `X-Forwarded-For` header and uses the last address in it, which is the one your proxy added. If the header is missing or holds no valid address, the server falls back to the connecting address. Nothing else changes. The server ignores `X-Forwarded-Proto`, `X-Forwarded-Host` and `Forwarded`, and builds every address it hands out from `OLEAFLY_PUBLIC_URL`.

Turn it on only when every request comes through your proxy. If people can also reach the server directly, anyone can send a made-up `X-Forwarded-For`, put any address in the security log and get around the sign-in limit.

With two proxies in a row, for example Cloudflare in front of Coolify's proxy, the last address is the one the inner proxy added for the outer one. People then show up with the outer proxy's address, a Cloudflare one or a private one such as `10.0.1.1`, and share its sign-in limit. There are two ways to fix that.

The safer one is `OLEAFLY_TRUSTED_PROXIES`, a list of your proxies' IP addresses and CIDR ranges separated by commas. The server then uses `X-Forwarded-For` only on connections that come from an address on the list. It reads the header from the right, skips every address on the list, and takes the first one that isn't as the visitor, the way nginx does with `real_ip_recursive`. A connection from anywhere else keeps its own address, whatever header it sends. It needs `OLEAFLY_BEHIND_PROXY=true` and can't be combined with `OLEAFLY_PROXY_HOPS`. [Coolify](#coolify) shows what to list behind Cloudflare.

The other one is `OLEAFLY_PROXY_HOPS=2`: the server takes the second address from the end instead. Count only the proxies that every request goes through. A [Cloudflare Tunnel](#without-a-public-address) that leads straight to the server counts as one. With `2`, the inner proxy must not be reachable directly from the internet, because a request sent straight to it can carry a made-up address that the server then takes as the visitor's. On Coolify, remove the `sslip.io` host Coolify generated for the resource, so only the domain behind Cloudflare leads to the server.

To check the setting, sign in from your own computer and open **Security log** in the admin console. The newest entry should show your public address, the one a site such as `ifconfig.me` reports. If it shows a private or Cloudflare address instead, add that address's range to `OLEAFLY_TRUSTED_PROXIES`, or raise `OLEAFLY_PROXY_HOPS` by one.

### Caddy

Caddy passes WebSocket connections and `X-Forwarded-For` through without extra settings, and gets the certificate itself. [Put HTTPS in front](#put-https-in-front) has the whole `Caddyfile`.

### nginx

Get a certificate for the domain first, for example with certbot. Then save this as `/etc/nginx/conf.d/oleafly.conf` and run `sudo nginx -t && sudo systemctl reload nginx`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name collab.example.org;
    ssl_certificate /etc/letsencrypt/live/collab.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/collab.example.org/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
        client_max_body_size 200m;
    }
}
```

`client_max_body_size` matches the default `OLEAFLY_MAX_PROJECT_MB` of 200. If you raise one, raise the other.

### Apache

You need Apache 2.4.47 or newer, which Debian 12 and Ubuntu 22.04 and later have. Turn on the modules:

```sh
sudo a2enmod proxy proxy_http ssl
```

Save this as `/etc/apache2/sites-available/oleafly.conf`, then run `sudo a2ensite oleafly && sudo systemctl reload apache2`:

```apache
<VirtualHost *:443>
    ServerName collab.example.org
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/collab.example.org/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/collab.example.org/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8080/ upgrade=websocket timeout=3600
    ProxyPassReverse / http://127.0.0.1:8080/
</VirtualHost>
```

`upgrade=websocket` passes WebSocket connections through and `timeout=3600` keeps them open for an hour. Apache adds the client's address to `X-Forwarded-For` by itself.

### Under a path

If the server lives under a path, include the path in `OLEAFLY_PUBLIC_URL`, for example `https://www.cs.example.edu/oleafly`, and in the callback addresses you register with sign-in providers. The server answers both with and without that path, so your proxy can pass it on or strip it, whichever suits its configuration. With nginx, use `location /oleafly/ {` with the same lines inside, and keep `proxy_pass http://127.0.0.1:8080;` without a path so nginx passes the path on.

### Certificates your university signs

If your university signs its own certificates, for the proxy or for its sign-in service, the server has to trust that certificate authority. So does every computer that runs Oleafly.

Without Docker, add it to the operating system. On Debian and Ubuntu, copy it into `/usr/local/share/ca-certificates/` with a name ending in `.crt` and run `sudo update-ca-certificates`.

The Docker image has no package manager, so give it a certificate list that includes yours. Next to `docker-compose.yml`, on a Debian or Ubuntu machine:

```sh
cat /etc/ssl/certs/ca-certificates.crt university-ca.pem > ca-bundle.pem
chmod 644 ca-bundle.pem
```

Then add the file to the server in `docker-compose.override.yml` and run `docker compose up -d` again:

```yaml
services:
  oleafly-server:
    volumes:
      - ./ca-bundle.pem:/etc/ssl/certs/ca-certificates.crt:ro
```

## Behind an outbound proxy

Some networks, often at universities, reach the internet only through an HTTP proxy. The installer, Docker, the server and Caddy each need to know about it. The examples use `http://proxy.example.edu:3128`.

- The installer. `sudo` drops proxy settings, so pass yours on: `curl -fsSL https://oleafly.com/server/install.sh | sudo https_proxy="$https_proxy" sh`
- Docker, which downloads the images. Save this as `/etc/systemd/system/docker.service.d/http-proxy.conf`, then run `sudo systemctl daemon-reload && sudo systemctl restart docker`:

  ```ini
  [Service]
  Environment="HTTPS_PROXY=http://proxy.example.edu:3128"
  Environment="NO_PROXY=localhost,127.0.0.1"
  ```

- The server, which talks to GitHub, your OpenID Connect provider and your bucket. Add `HTTPS_PROXY=http://proxy.example.edu:3128` and `NO_PROXY=localhost,127.0.0.1` to `.env`. If your bucket is on the same network, add its host name to `NO_PROXY`. Email doesn't go through the proxy, so the server has to reach the mail server directly.
- Caddy, which gets the certificate from Let's Encrypt. Give it the same settings in `docker-compose.override.yml`:

  ```yaml
  services:
    caddy:
      environment:
        HTTPS_PROXY: http://proxy.example.edu:3128
        NO_PROXY: localhost,127.0.0.1,oleafly-server
  ```

Then run `docker compose up -d` again. Let's Encrypt still connects to Caddy on ports 80 and 443 to check the domain, so those have to be open from the internet. If the network blocks them, use [Cloudflare Tunnel](#without-a-public-address) instead.

## Without a public address

If the machine has no public address, for example a computer in your lab behind the university firewall, Cloudflare Tunnel can make it reachable. You need a Cloudflare account with your domain on it. Cloudflare handles HTTPS for the hostname, so requests are decrypted on Cloudflare's network before they reach your machine. Count Cloudflare among the parties that can read traffic to your server.

1. Follow the [Docker Compose](#docker-compose) steps up to editing `.env`. Set `OLEAFLY_DOMAIN` to the hostname you will use, such as `collab.example.org`.
2. Start only the server. Caddy isn't needed here:

   ```sh
   docker compose up -d oleafly-server
   ```

3. In the Cloudflare dashboard, go to **Networking › Tunnels**, select **Create Tunnel**, give it a name, and select **Create Tunnel** again. Copy the token from the install command it shows.
4. Start the tunnel next to the server. The `read` command waits for you to paste the token and doesn't show it:

   ```sh
   read -rs TUNNEL_TOKEN && export TUNNEL_TOKEN
   docker run -d --name oleafly-tunnel --restart unless-stopped --network oleafly-server_default -e TUNNEL_TOKEN cloudflare/cloudflared:2026.10.0 tunnel --no-autoupdate run
   ```

5. Back in the dashboard, open the tunnel. Under **Routes**, select **Add route**, then **Published application**. Under **Hostname**, enter the subdomain and pick your domain. Set **Service URL** to `http://oleafly-server:8080` and select **Add route**.
6. Check that it answers at `https://collab.example.org/healthz`, then [become the first admin](#become-the-first-admin).

On a machine without Docker, install `cloudflared` from [Cloudflare's package repository](https://pkg.cloudflare.com/), run `sudo cloudflared service install` followed by the token, and set **Service URL** to `http://127.0.0.1:8080`.

Cloudflare passes WebSocket connections through and puts the visitor's address last in `X-Forwarded-For`, so keep `OLEAFLY_BEHIND_PROXY=true`. When the tunnel leads to another proxy, such as Coolify's, and not straight to the server, also set `OLEAFLY_TRUSTED_PROXIES` to the range of the Docker network that `cloudflared` and that proxy share. [What OLEAFLY_BEHIND_PROXY changes](#what-oleafly_behind_proxy-changes) explains this and the other choice, `OLEAFLY_PROXY_HOPS=2`. Cloudflare refuses requests larger than 100 MB on its Free and Pro plans, so set `OLEAFLY_MAX_PROJECT_MB` to 100 or less, or large projects fail to upload. Don't put Cloudflare Access in front of the server, because Oleafly can't get past its login page.

When you update the server later, name the service so Caddy stays off: `docker compose pull oleafly-server && docker compose up -d oleafly-server`. The one-command installer always starts Caddy, so use these steps for a tunnel instead.

## Sign-in providers

People sign in through providers you configure, so the server never handles passwords. Configure GitHub, OpenID Connect or both. Without either, the server stops at startup with `Oleafly Server cannot start. No sign-in method is set up` and names the settings to add. [Email](#email) can't take their place, because [sign-in by email link](#sign-in-by-email-link) stays off until an admin turns it on. Each provider sends people back to a callback address on your server:

`https://collab.example.org/auth/callback/<provider>`

If `OLEAFLY_PUBLIC_URL` has a path, so does the callback address, for example `https://www.cs.example.edu/oleafly/auth/callback/github`.

The server's sign-in pages follow the browser's language when Oleafly has it, and show English otherwise.

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

### Sign in by email link

People can also sign in with a link the server emails them, so they don't need a GitHub or OpenID Connect account. This needs [email](#email). Then an admin turns on **Sign in by email** under **Settings** in the [admin console](#admin-console). It's off by default.

1. In **Add server**, the person selects **Continue with Email**. Oleafly opens a page from your server in their browser.
2. They enter their email address and select **Email me a link**.
3. The email has a **Sign in** button. The link works once, for 15 minutes, on the computer that asked for it.
4. Opening the link shows a page with a **Sign in** button. Selecting it finishes the sign-in, and Oleafly carries on by itself. Opening the link alone doesn't use it, so a mail scanner that follows links can't use it up.

Your access rules still decide who gets in: an allowed list entry for that email address, a domain rule, or a [guest invitation](#guests). An allowed list entry by GitHub user name doesn't match an email link. The page says the same thing whether or not the server lets the address in, so nobody can use it to find out who has an account. If someone already has an account with that verified address, for example from signing in with GitHub, the link signs them in to that same account.

Turning **Sign in by email** on also opens existing accounts to email links. A link signs in to the account that already has that address as a verified address. The server keeps every verified address a provider has reported for an account, not just the main one, and it keeps an address even after the person removes it from the provider. GitHub, for example, reports every verified address on the GitHub account. So anyone who can read mail at one of those addresses can sign in to that account by email. Before you turn it on, check that people still control every address on their accounts. If an address belongs to more than one account that can sign in, the link signs in to none of them, and your access rules decide whether it gets an account of its own. If the only account with that address is suspended or removed, the link is refused until you let that person back in, even when a domain rule covers the address.

The server sends at most 3 links to one email address and 100 links to one IP address in 15 minutes, so a class of 50 at one address can all sign in. `OLEAFLY_EMAIL_LINKS_PER_ADDRESS` and `OLEAFLY_EMAIL_LINKS_PER_IP` set these numbers. All IPv6 addresses in one `/64` network count as one address. After that the page asks people to wait 15 minutes. The whole server also sends at most 300 sign-in emails an hour, whoever asks for them, and `OLEAFLY_EMAIL_LINKS_PER_HOUR` sets that number. Turning **Sign in by email** off stops links that were already sent.

### Sign in with a code

When the browser can't get back to Oleafly after a sign-in, for example on a locked-down computer, people can sign in with a code instead. It needs no setting and works with every sign-in option the server has. Oleafly offers **Sign in with a code** in **Add server**, and again when a browser sign-in takes more than 20 seconds.

1. Oleafly shows your server's address followed by `/auth/device`, such as `https://collab.example.org/auth/device`, and a code of eight letters, such as `BCDF-GHJK`.
2. On any phone or computer, the person opens that address, types the code and selects **Continue**.
3. The page names the computer that asked. They check the name and sign in with any option the server offers. Oleafly then finishes signing in by itself.

The sign-in has to finish in the browser where they typed the code. If someone else starts a sign-in and sends them the provider's sign-in page as a link, it doesn't sign anyone in. If they choose Email, they can open the emailed link on any device, but the page it opens asks for the code again. A link that someone else asked for is no use without the code on that person's computer.

If they didn't start the sign-in, **Stop, this wasn't me** cancels the code. A code works once and stops working after 10 minutes, and only the copy of Oleafly that asked for it can finish the sign-in. One IP address can ask for 100 codes and type 10 wrong codes in 10 minutes, counting the code pages of emailed links. That's enough for a class of 50 sharing one address, and `OLEAFLY_DEVICE_CODES_PER_IP` changes it. All IPv6 addresses in one `/64` network count as one address. After that it has to wait 10 minutes.

## Become the first admin

A new server has no admin. Until someone finishes setup, the server makes a new one-time setup code each time it starts and writes it to its log, and Oleafly sees that the server needs setup.

1. Find the newest line that starts with `Setup code:` in the log:
   - One-command install: `sudo sh /opt/oleafly-server/install.sh status` shows the current code
   - Docker Compose: `docker compose logs oleafly-server | grep 'Setup code'`
   - Coolify: the logs of the `oleafly-server` service
   - systemd: `sudo journalctl -u oleafly-server | grep 'Setup code'`
2. In Oleafly, turn on **Live collaboration** in **Settings › Experimentation**. Then open **Settings › Collaboration**, select **Add server**, and enter your server's address. Oleafly asks for the setup code.
3. Enter the code and sign in with any provider you configured. You become the server's admin, and the code stops working.

Anyone who has the code before you use it can make themselves admin, so only ever paste it into Oleafly.

If you set `OLEAFLY_SETUP_CODE`, the server never prints your code. The log only says `Setup code: set by OLEAFLY_SETUP_CODE`, and you enter the value you set. Remove it from your settings once setup is done.

Then add people under **Manage server**. Once you've added them, they can add the server in Oleafly.

You can add a person by email address, by GitHub user name, or let everyone with a verified address at your domain in. User names work only for GitHub, because other providers let people choose or change theirs. Someone you remove stays out, even when a domain rule covers their address or an owner invites them as a guest. To let them back in, add them again by email address or user name. They get their old account back, with every project they had.

The server limits how often one address can start a sign-in or open a live connection, so a flood of requests can't fill its database. All IPv6 addresses in one `/64` network count as one address. People signing in normally never reach the limit.

## Admin console

The admin console is a window for running one server from Oleafly. Admins and maintainers can open it. In Oleafly, open **Settings › Collaboration** and select **Open admin console** on the server's card, or at the top of **Manage server**. Each server gets its own window. Selecting the button again brings that window to the front, and the window remembers its size and position.

If you're signed out of the server, or your role is member or guest, the window says so and shows nothing else.

| Section | What it shows and does |
| --- | --- |
| Overview | Whether the server is healthy, how many people, devices and projects it has and who is online, how much storage it uses, its email and sign-in options, and its settings at a glance. It warns **Nobody can sign in** when the server has no sign-in option, which means no GitHub or OpenID Connect provider and no [sign-in by email link](#sign-in-by-email-link). It warns **The server can't save files** when the data folder can't be written to. |
| People | Everyone who has signed in. Change roles, suspend or remove people, and sign out their devices. [Guest](#guests) invitations waiting for approval are at the top. |
| Access rules | The allowed people list and the domain rules from [Become the first admin](#become-the-first-admin). |
| Projects | Every project shared on the server, with its owner, how many people it has, its size and its last activity. Search by title or owner, show only shared, archived or uploading projects, and archive or restore a project. |
| Settings | The server settings, such as **Allow guests**, **Allow link sharing** and **Sign in by email**. |
| Email | Whether email is set up, the From address and the last failure. Send a test email from here. Read [Email](#email). |
| Security log | Sign-ins and refused sign-ins, devices, people, settings, projects and guests. Each entry says who did it, when and from which IP address, with details such as the project, the sign-in option used or why a sign-in was refused. |
| Connection checks | The same checks as **Test connection**, run from your computer to the server. |

Maintainers can use every section, but they can't make anyone an admin or maintainer, see or sign out another admin's or maintainer's devices, see storage use, archive or restore projects, change server settings or send a test email. Admins can do all of it.

Archiving a project from the console stops sharing it for everyone. People stop syncing it and keep their own copies, and the server deletes it after `OLEAFLY_ARCHIVE_DAYS` days unless an admin restores it first. Restoring shares it again with the same people. A project that never finished its first upload can't be restored. Both show in the security log.

The console never opens a project. It shows titles, owners and sizes, and nothing inside them.

## Email

Email is optional, and everything else works without it. Without email you send people the server's address yourself, and Oleafly lists the projects shared with each person under Shared with you.

To set it up, give the server an SMTP account:

```ini
OLEAFLY_SMTP_URL=smtps://oleafly%40example.org:example-app-password@smtp.example.org:465
OLEAFLY_MAIL_FROM=Smith Lab <oleafly@example.org>
```

Set both lines or neither. Write special characters in the user name and password in URL form, for example `%40` for `@`.

`smtps://` uses TLS from the start, on port 465 unless you name another port. `smtp://` uses port 587 unless you name another, then switches to TLS with STARTTLS. If the mail server doesn't offer STARTTLS, the server won't send. A mail relay on the same machine is the one exception: `smtp://localhost`, `smtp://127.0.0.1` and `smtp://[::1]` send without TLS. The server checks the mail server's certificate against the system's trusted certificates.

A relay on the same private network can skip TLS too, when you ask for it. Add `?tls=none`, as in `smtp://mailpit:1025?tls=none`. That suits a relay container in the same Compose project, or a mail catcher such as [Mailpit](https://mailpit.axllent.org) on a test server. The address can't hold a user name or password then, because they would cross the network unencrypted. The server accepts `tls=none` only for this machine, an IP address in a private, link-local or unique-local range, or a one-word host name such as a Compose service. It refuses it for any other host. Use it only when nobody else can reach that network.

### What the server sends

There are six kinds of email, each as plain text with a simple HTML version. Email to someone who already has an account goes only to their verified addresses, and GitHub's noreply addresses are always skipped.

Adding someone to the allowed list by email address sends that address the server's name, an Add to Oleafly link and the plain server address to type under Add server. Adding someone by GitHub user name or through a domain rule sends nothing, because the server has no address for them yet.

When a project owner adds someone to a project, that person gets the project title, who shared it, their role and a link that opens the project in Oleafly. The email also has the project's web page, for when the link doesn't open the app. Changing someone's role later sends nothing. Each person can turn these emails off on the server's card in Settings > Collaboration.

A sign-in on another device sends the account the device name, its system and the time in the server's time zone, with a reminder to sign that device out under Settings > Collaboration if it wasn't them. Set `TZ`, for example `TZ=Europe/Berlin`, to choose the time zone. A new account's first device gets no email.

When someone mentions a project member in a comment or a reply, that person gets an email with who mentioned them, the project, the file, the text the comment is on and the comment itself, plus a link that opens the comment in Oleafly. The server waits a minute before sending, so several mentions of the same person in that minute arrive as one email. Nobody is emailed about mentioning themselves, and people who have left the project get nothing. A comment written offline sends its email once it reaches the server, and the same comment arriving again never sends a second one. Each person can turn these emails off on the server's card in Settings > Collaboration.

A [guest invitation](#guests) goes to the invited address with the project title, who invited them, an Add to Oleafly link and the address to sign in with. When approval is on, it goes out once the invitation is approved.

A [sign-in link](#sign-in-by-email-link) goes to whoever asks for one on the server's sign-in page.

Admins can stop all of these except sign-in links for everyone with Email notifications on the Email tab. Sign-in links always go out, because people can't sign in without them.

### Test it

In Oleafly, open Settings > Collaboration, choose Manage server on the server's card and open the Email tab. It shows whether email is on and the From address, never the password. An admin can choose Send test email to send one to their own verified address. The tab then says whether it went out, or what the mail server answered.

When email is off, the tab shows the Add to Oleafly link and the server address so you can send them yourself.

### When the mail server is down

Sending never holds up the action behind it. The server keeps emails in a queue in memory and tries again after 30 seconds, 2 minutes, 10 minutes, 30 minutes and 2 hours. Each failed try is a warning in the server log, and the Email tab shows the latest failure. If the last try fails too, the server logs an error and drops that email. Emails still waiting when the server restarts are lost. Mention emails still inside their one-minute wait are kept in the database, so a restart doesn't lose those.

## Guests

A guest is someone from outside your server, such as a coauthor at another university, whom a project owner invites to a project. Guests see only the projects they're invited to.

### Turn guests on

Guests are off on a new server. An admin turns them on with **Allow guests** under **Settings** in the [admin console](#admin-console), or under **Server settings** in **Manage server**. **Approve guests first** is on by default, so an admin or maintainer approves each invitation before it works. Turn it off to let invitations work straight away. When an admin or maintainer sends an invitation, it's approved at once.

If you turn **Allow guests** off later, owners can't send new invitations and unused invitations stop working. Guests who already signed in keep their projects until an owner removes them or you remove them under **People**.

### Invite a guest

Only a project's owner can invite guests to it. In **Manage sharing**, the owner types the person's email address under **Add people**. If nobody on the server uses that address, Oleafly offers **Invite as guest**, with the role Editor or Viewer.

- An invitation is for one address and one project, and it ends after 14 days.
- One person can send up to 20 invitations an hour.
- When approval is on, the invitation waits under **Pending guests** at the top of **People**, where admins and maintainers approve, decline or withdraw it. The owner can withdraw it too.
- If the server sends email and Email notifications is on, the guest gets an [invitation email](#what-the-server-sends). Otherwise Oleafly gives the owner an Add to Oleafly link to send themselves.
- If exactly one account on the server has that address, that person gets the project straight away, after approval if it's needed. If two or more accounts have it, the invitation waits until one of them signs in with it. If the project is already at the server's limit on people, the invitation waits too, and works the next time the person signs in after someone has left.

### How a guest signs in

The guest adds the server in Oleafly and signs in with any option that gives the server the invited address as a verified address: GitHub, an OpenID Connect provider or an [email link](#sign-in-by-email-link). An unverified address doesn't count. The first sign-in makes a guest account and opens every project that address was invited to.

### What guests can and can't do

Guests can open and compile the projects they were invited to, edit them if they're editors, and sign out their own devices. They can't see the member directory or anyone's email address, share projects, invite other people, or join a project through its link. To give a guest another project, that project's owner invites the same address. The guest already has an account, so the invitation works at once, or once it's approved when approval is on.

When a guest is removed from their last project, or leaves it, the server ends their access: it removes the account and signs out every device. A new invitation brings the same account back. If you remove a guest under **People** while they still have projects, a new invitation won't bring them back.

### Removal sticks

When an owner removes someone from a project, guest or not, that person can't come back through the project's link, even with link sharing on. Each try shows in the security log. To let them back in, the owner adds them again, or sends a new invitation if they're a guest. Someone who leaves a project on their own can still rejoin through its link.

## Backups

What a full backup needs depends on where files are stored. With files on disk (`OLEAFLY_BLOB_STORE=fs`, the default), the database, files and project snapshots are all in the data folder, so back up the whole folder as shown below. With files in a bucket, the data folder holds the database and the bucket holds files and project snapshots. A copy of the database plus the bucket is a full backup. Turn on versioning for the bucket so an object deleted by mistake can be brought back.

Back up regularly and keep the copies private, since they hold every project. Your settings, such as `.env`, aren't in the data folder, so keep a copy of them as well.

With Docker Compose, the server stops for a few seconds while you copy the volume. Oleafly reconnects by itself. The commands below run in the folder with `docker-compose.yml`, which is `/opt/oleafly-server` if you used the installer.

```sh
cd /opt/oleafly-server
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

On Coolify, the volume's name starts with the resource's ID. Find it with `docker volume ls --filter name=oleafly-data`, use it in place of `oleafly-server_oleafly-data`, and stop and start the server from Coolify's dashboard instead of with `docker compose`.

### Restore drill

A backup you have never restored is only a hope. This drill starts a second copy of the server from a backup, leaves the running one alone, and checks that both are the same server. Use the date of your own archive in place of `2026-10-11`.

```sh
cd /opt/oleafly-server
docker volume create oleafly-restore-drill
docker run --rm -v oleafly-restore-drill:/data -v "$PWD":/backup:ro debian:13.7-slim tar -C /data -xzf /backup/oleafly-data-2026-10-11.tar.gz
docker run -d --name oleafly-restore-drill -v oleafly-restore-drill:/data -e OLEAFLY_PUBLIC_URL=https://restore-drill.invalid -e OLEAFLY_GITHUB_CLIENT_ID=restore-drill -e OLEAFLY_GITHUB_CLIENT_SECRET=restore-drill "$(docker compose images -q oleafly-server)"
docker run --rm --network container:oleafly-restore-drill curlimages/curl:8.22.0 -fsS --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8080/.well-known/oleafly-server
curl -fsS https://collab.example.org/.well-known/oleafly-server
```

The `server_id` in the two answers must match. The drill copy has a placeholder GitHub sign-in that can't sign anyone in, and no open port, so nobody can use it. Remove it when you're done:

```sh
docker rm -f oleafly-restore-drill
docker volume rm oleafly-restore-drill
```

### Restore

To restore for real with Docker Compose, stop the server, replace the volume's contents with the archive, and start it again:

```sh
cd /opt/oleafly-server
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

A restored server is missing the changes people made after the backup was made. Each app notices when it reconnects, whether it stayed open or was opened later, and sends its own missing changes again. Nobody has to do anything for that. A change that builds on someone else's missing change waits until that person opens the project, because only their app can send their changes. Ask everyone who was editing around the time of the failure to open the project once.

### Continuous copies with Litestream

An archive only holds what was there when you made it. [Litestream](https://litestream.io) copies each change to the server's database to an S3-compatible bucket about a second after it happens. The Compose file includes it as an optional service.

Litestream copies the database. If files are in a bucket, the bucket already holds files and project snapshots, so the Litestream copy and the bucket together can bring back a lost disk. If files are on disk, they and the snapshots are in the `blobs` folder of the data folder, which Litestream doesn't copy. Keep making archives of the volume in that case. Either way, Litestream keeps a copy of the database that is never more than a few seconds old.

1. Create a bucket, or a folder in one, that only this server's Litestream uses. Don't share it with `OLEAFLY_BLOB_STORE`. Give Litestream a key that can list the bucket and read, write and delete objects in it.
2. Add the details to `.env`:

   ```sh
   LITESTREAM_REPLICA_URL=s3://lab-backups/oleafly-server
   LITESTREAM_REGION=eu-west-1
   LITESTREAM_ACCESS_KEY_ID=your-access-key-id
   LITESTREAM_SECRET_ACCESS_KEY=your-secret-access-key
   COMPOSE_PROFILES=litestream
   ```

   For a store other than Amazon S3, also set `LITESTREAM_ENDPOINT` to its address, such as `https://<account-id>.r2.cloudflarestorage.com`, and set `LITESTREAM_REGION` to the region it expects (`auto` for R2). `COMPOSE_PROFILES` makes every `docker compose` command include Litestream.
3. Start it:

   ```sh
   docker compose up -d
   ```

4. Check that it copied the database. This prints a line with `snapshot complete`:

   ```sh
   docker compose logs litestream | grep 'snapshot complete'
   ```

Litestream takes a full copy once a day and keeps a week of copies and the changes between them. The schedule is in `litestream.yml`.

#### Litestream restore drill

This drill restores the database from the bucket into a scratch volume, starts a second copy of the server on it and checks that both are the same server. The running server isn't touched.

```sh
cd /opt/oleafly-server
docker run --rm -v oleafly-litestream-drill:/data "$(docker compose images -q oleafly-server)" --version
docker compose run --rm --no-deps -v oleafly-litestream-drill:/restore litestream restore -config /etc/litestream.yml -o /restore/oleafly-server.sqlite3 /data/oleafly-server.sqlite3
docker run -d --name oleafly-litestream-drill -v oleafly-litestream-drill:/data -e OLEAFLY_PUBLIC_URL=https://restore-drill.invalid -e OLEAFLY_GITHUB_CLIENT_ID=restore-drill -e OLEAFLY_GITHUB_CLIENT_SECRET=restore-drill "$(docker compose images -q oleafly-server)"
docker run --rm --network container:oleafly-litestream-drill curlimages/curl:8.22.0 -fsS --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8080/.well-known/oleafly-server
curl -fsS https://collab.example.org/.well-known/oleafly-server
```

The first command creates the scratch volume with the owner the server needs. The `server_id` in the last two answers must match. Remove the copy when you're done:

```sh
docker rm -f oleafly-litestream-drill
docker volume rm oleafly-litestream-drill
```

#### Restore the database from Litestream

When the database file is damaged or gone but the rest of the data folder is fine, stop the server and Litestream, remove what's left of the database, restore it and start again:

```sh
cd /opt/oleafly-server
docker compose stop oleafly-server litestream
docker run --rm -v oleafly-server_oleafly-data:/data debian:13.7-slim rm -rf /data/oleafly-server.sqlite3 /data/oleafly-server.sqlite3-wal /data/oleafly-server.sqlite3-shm /data/.oleafly-server.sqlite3-litestream
docker compose run --rm --no-deps litestream restore -config /etc/litestream.yml /data/oleafly-server.sqlite3
docker compose up -d
```

After a lost disk with files in a bucket, run the commands above on the new, empty volume and keep the same bucket settings in `.env`. Every project comes back with its files and snapshots.

After a lost disk with files on disk, [restore](#restore) your newest archive and leave it at that. Don't put a newer database from Litestream on top of an older archive. The database would point at files and snapshots the archive doesn't have, and those projects wouldn't open.

## Upgrading

Back up first. The server updates its database the first time a new version starts, so going back to an older version means restoring the backup you took before upgrading.

Older versions kept project snapshots in a `snapshots` folder inside the data folder. The first time a newer version starts, it moves them into the blob store. It checks each copy against its hash before it deletes the old file, and the log says how many snapshots it moved. Older versions also left behind snapshot files that no project used any more. Those are removed too. If a snapshot can't be moved, for example because the bucket refuses the upload, the file stays where it is and the server keeps using it. It tries again at the next start and at each maintenance pass.

- One-command install: run `curl -fsSL https://oleafly.com/server/install.sh | sudo sh -s update`. The installer downloads the new release's images before it changes anything. When the version changes, it stops the server, copies the data volume to `/opt/oleafly-server/backups` and keeps the old `docker-compose.yml` and `install.sh` as `docker-compose.yml.previous` and `install.sh.previous`. It keeps the three newest copies. If the new version doesn't start, the installer prints the commands that put the previous version and its data back. The copy of the installer in `/opt/oleafly-server` only installs its own release again, so it stops and says so when a newer release is out.
- Docker Compose: download the new release's `docker-compose.yml` and `SHA256SUMS` as in [Docker Compose](#docker-compose), check them, then run `docker compose pull && docker compose up -d`. If you build from source, run `git pull` in the `Oleafly` folder and repeat the build command.
- Coolify: select **Redeploy**. With the published image, that pulls the newest release under the image's tag.
- Render: open the service and start a manual deploy, which pulls the image again.
- Railway: deploy the service again from its menu. For images on GitHub's registry, Railway can also update the image by itself.
- systemd: install the new release as in [Download the server](#download-the-server), or run `git pull` in the `Oleafly` folder and repeat the `cargo build` and `sudo install` commands from [Build the server](#build-the-server). Then run `sudo systemctl restart oleafly-server`.

To go back after a one-command update by hand, put the copy and the previous files back. Use the name of your newest copy:

```sh
cd /opt/oleafly-server
sudo docker compose down
sudo docker run --rm -v oleafly-server_oleafly-data:/data -v /opt/oleafly-server/backups:/backup:ro debian:13.7-slim sh -c 'find /data -mindepth 1 -delete && tar -C /data -xzf /backup/oleafly-data-20261014T101500Z-0.1.0.tar.gz'
sudo cp docker-compose.yml.previous docker-compose.yml
sudo cp install.sh.previous install.sh
sudo docker compose up -d
```

Oleafly checks the server's version every time it connects. If the app and the server can't work together, Oleafly says which one needs an update.

## Roles and permissions

Each person has one server role, given by the server's admins and maintainers. In each project they were added to, they also have a project role, given by that project's owner. A cell says whether that role on its own allows the action. No server role opens a project by itself: project access comes only from the project's owner.

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
| Read the security log | Yes | Yes | No | No | No | No | No |
| Add members to the server | Yes | Yes | No | No | n/a | n/a | n/a |
| Appoint maintainers | Yes | No | No | No | n/a | n/a | n/a |
| Change server settings | Yes | No | No | No | n/a | n/a | n/a |
| Delete a project | Yes, to free storage | No | No | No | Yes, by stopping sharing | No | No |
| Sign out someone's device | Yes | Yes, but not other admins' or maintainers' | Own devices only | Own devices only | n/a | n/a | n/a |
| Read stored projects with direct server access | Not in the app | Not in the app | Not in the app | Not in the app | n/a | n/a | n/a |

The last row matters most. Projects are not encrypted on the server, so whoever runs the machine can read every stored project, whatever their role. Oleafly gives no role, admin included, a way to do it from the app. When an admin deletes a project to free storage, its owner and members are told, and their own copies stay on their computers.

## Checking the server

- `https://collab.example.org/healthz` answers `200` while the server process runs.
- `/readyz` answers `200` only while the server can write to its database and its data folder. When it can't, for example on a full disk, it answers `503` and names what failed (`database` or `storage`).
- The Docker image checks `/readyz` by itself with the server's own `oleafly-server healthcheck` command, so `docker ps` and Coolify show an unhealthy server instead of a running one that can't save anything.
- In Oleafly, **Test connection** under **Settings › Collaboration** checks the address, HTTPS, the version, WebSocket connections, sign-in providers and the server's clock, and names the first problem it finds. When WebSocket connections are blocked but long-polling gets through, it says live edits take a slower route. **Connection checks** in the [admin console](#admin-console) runs the same checks.
- A certificate error from Oleafly or in the server's log usually means a certificate authority that the machine doesn't trust yet. Read [Certificates your university signs](#certificates-your-university-signs).
