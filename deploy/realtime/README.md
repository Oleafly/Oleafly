# Oleafly realtime server (experimental slice)

The collaboration server is a separate Rust package in this monorepo:
`crates/oleafly-realtime-server`. It is not a separate repository. This first runnable slice is
intentionally limited to durable Source updates and ephemeral live selections/cursors.

## Local Docker run

Docker Desktop must be running. From the repository root:

```sh
docker compose -f compose.realtime.dev.yaml up --build
curl http://127.0.0.1:8787/.well-known/oleafly-realtime
curl -X POST -H 'Authorization: Bearer oleafly-local-e2e' \
  http://127.0.0.1:8787/v1/dev/bootstrap
```

The development control route creates one active project, two Editor actors/replicas, and two
one-use tickets. It is mounted only when the process is explicitly in `development` mode, has a
bootstrap token, and is bound to a loopback address. The Compose service makes the equivalent
explicit assertion with `OLEAFLY_DEV_TRUST_LOOPBACK_PROXY=true` while publishing its container port
only on host `127.0.0.1`. Production refuses both development settings. Plain HTTP/WebSocket is
allowed only for this loopback workflow.

To run the focused two-client test against only the Compose PostgreSQL service:

```sh
docker compose -f compose.realtime.dev.yaml up -d postgres
OLEAFLY_REALTIME_TEST_DATABASE_URL=postgres://oleafly:oleafly-dev-only@127.0.0.1:55432/oleafly_realtime \
  cargo test -p oleafly-realtime-server --test two_client_e2e -- --ignored --nocapture
```

The test opens real WebSockets using the checked-in protocol codec and `yrs` updates. It covers
commit-before-delivery ordering, a sender disconnect after submit, presence cleanup on bad input,
live revocation, idempotent replay, encrypted AI-assistance data, and restart from an encrypted
snapshot plus its journal tail. It also runs the production bootstrap, login, and ticket flow.

## Coolify

Use `deploy/realtime/coolify/compose.yaml` as the Compose deployment. Configure:

- `POSTGRES_PASSWORD` with a random database password.
- `OLEAFLY_REALTIME_MASTER_KEY` with `openssl rand -base64 32`. Keep it outside PostgreSQL and its
  backups; losing it makes encrypted projects unrecoverable.
- `OLEAFLY_REALTIME_SETUP_TOKEN` with `openssl rand -hex 32`. This token is used once to create the
  recovery Owner and first project.
- `OLEAFLY_REALTIME_PUBLIC_URL` with the externally routed `https://` URL.

Point Coolify's HTTPS proxy at the `realtime` service on port 8787 and enable WebSocket forwarding.
TLS is terminated at that edge; production discovery advertises `wss://`. PostgreSQL has no public
port, and the stack contains no Redis, NATS, MinIO, compiler, or Docker socket.

After the service reports ready, create the local recovery account:

```sh
curl -X POST "https://realtime.example.com/v1/setup/bootstrap" \
  -H "Authorization: Bearer $OLEAFLY_REALTIME_SETUP_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"username":"recovery-owner","password":"replace-with-a-long-password","displayName":"Recovery Owner"}'
```

The setup route returns 404 after the first successful request. Passwords are hashed with Argon2id.
Login at `POST /v1/auth/local/login`, then send its Bearer access token to
`POST /v1/projects/:project_id/sync-tickets` with `{"replicaId":"<uuidv7>"}`. Access tokens last
five minutes and sync tickets last one minute. The ticket goes in the authenticated opening frame,
not in the WebSocket URL.

## Endpoints and commands

- `GET /health`: process liveness.
- `GET /ready`: PostgreSQL readiness.
- `GET /.well-known/oleafly-realtime`: persistent instance identity, protocol versions, and sync URL.
- `GET /v1/projects/:project_id/sync`: binary realtime WebSocket; the first frame carries a 32-byte
  one-use ticket, never the URL.
- `POST /v1/setup/bootstrap`: production-only, one-time recovery Owner and project setup.
- `POST /v1/auth/local/login`: production local-account login.
- `POST /v1/projects/:project_id/sync-tickets`: membership-scoped one-use ticket issuance.
- `POST /v1/dev/bootstrap`: loopback development only.
- `POST /v1/dev/projects/:project_id/tickets`: loopback development only; refresh a test ticket.
- `oleafly-realtime-server serve|migrate|doctor`: service, migration, and diagnostic commands.

Authoring updates, AI-assistance receipts, project data keys, and hot snapshots use versioned AEAD
envelopes. The instance master key wraps one random key per project; project/object identity is
authenticated as associated data. The server rechecks membership authorization epochs for each
authoring and presence action and before forwarding room events. Persistence is committed before
collaborator delivery or the sender receipt.

This remains an experimental Source collaboration slice. Local login is enough to operate a fresh
Coolify deployment, but refresh credentials, OIDC, invitations, sharing UI, the Desktop offline
journal/materializer, review, artifacts, and history UI are not implemented. The dev routes are test
scaffolding and are never mounted in production.

The following optional limits have conservative defaults and can be changed through Coolify:

- `OLEAFLY_REALTIME_MAX_CONNECTIONS` (default `256`)
- `OLEAFLY_REALTIME_MAX_WRITE_BUFFER_BYTES` (default `524288`)
- `OLEAFLY_REALTIME_ROOM_BROADCAST_BYTES` (default `67108864`)
- `OLEAFLY_REALTIME_MUTATIONS_PER_SECOND` and `OLEAFLY_REALTIME_MUTATION_BURST`
- `OLEAFLY_REALTIME_STATE_VECTORS_PER_SECOND` and `OLEAFLY_REALTIME_STATE_VECTOR_BURST`
- `OLEAFLY_REALTIME_PRESENCE_PER_SECOND` and `OLEAFLY_REALTIME_PRESENCE_BURST`
- `OLEAFLY_REALTIME_AUTH_PER_MINUTE` and `OLEAFLY_REALTIME_AUTH_BURST`

Slow clients are disconnected when their bounded room queue falls behind. They reconcile from a
state vector after reconnecting.
