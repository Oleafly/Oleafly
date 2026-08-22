# Test the Desktop Source collaboration slice

This slice is deliberately small. Two Desktop windows can edit one Source file and see each other's
named cursors and selections. The server commits an edit before the other window receives it. Visual
mode, sharing, invitations, review, and published PDFs are not part of this test yet.

## Start the local server

Docker Desktop must be running. From the repository root:

```sh
docker compose -f compose.realtime.dev.yaml up --build
```

In another terminal, create a test room:

```sh
curl -sS -X POST \
  -H 'Authorization: Bearer oleafly-local-e2e' \
  http://127.0.0.1:8787/v1/dev/bootstrap | tee /tmp/oleafly-realtime-room.json
```

The response has one `projectId` and two clients. Alice is `clients[0]`; Bob is `clients[1]`.
Each client has its own `actorId` and `replicaId`.

## Open two isolated Desktop profiles

For the automated two-window check, run:

```sh
bash scripts/realtime-desktop-e2e.sh
```

The runner uses separate app-data directories and bridge sockets for Alice and Bob. It checks edits
in both directions, named selections, a server disconnect, and replay of an offline edit. It removes
the temporary Desktop profiles when it exits and leaves the Docker services running.

For a manual check, follow the steps below.

The app's existing Playwright bridge handles one Desktop process at a time, so this check uses two
isolated app data directories. Launch the app twice from separate terminals and give each process a
different `OLEAFLY_DATA_DIR`. If you use an e2e-enabled binary, also give the processes different
`TAURI_PLAYWRIGHT_SOCKET` values.

In each profile:

1. Create or open a local project and open its `main.tex` file.
2. Open DevTools and run
   `localStorage.setItem("oleafly.experimentalRealtime", "true"); location.reload()`.
3. Expand **Live setup** above the editor.
4. Enter `http://127.0.0.1:8787`, the shared `projectId`, and that client's actor and replica IDs.
5. Keep the default file ID, `0198cf35-0000-7000-8000-000000000002`, in both windows.
6. Enter `oleafly-local-e2e` as the development token.
7. In Alice's window only, select **Initialize a new room from the open file**. Connect Alice and
   wait for **Saved to team**. Leave the option off when Bob connects.

Type in Alice's editor, then in Bob's. Move each selection after typing. Both windows should show the
same text, plus an Alice or Bob cursor label in the other window. The status moves through **Syncing**
to **Saved to team** after each edit.

To exercise offline replay, stop the `realtime` container, type in one window, and check that the
status reports the locally safe change count. Start the container again. The original pending frame
is replayed from the encrypted Desktop journal and both windows converge.

```sh
docker compose -f compose.realtime.dev.yaml stop realtime
docker compose -f compose.realtime.dev.yaml start realtime
```

Close and reopen a Desktop profile to check its encrypted Y.Doc cache and pending journal. The local
project file is materialized about 250 ms after editing; closing, export, and compile barriers will be
wired in a later slice.

## Focused checks

```sh
pnpm exec vitest run \
  src/lib/realtime/file-source.test.ts \
  src/lib/realtime/live-source.test.ts

TAURI_CONFIG='{"bundle":{"externalBin":[]}}' \
  cargo test -p oleafly --lib realtime::tests

docker compose -f compose.realtime.dev.yaml up -d postgres
OLEAFLY_REALTIME_TEST_DATABASE_URL=postgres://oleafly:oleafly-dev-only@127.0.0.1:55432/oleafly_realtime \
  cargo test -p oleafly-realtime-server --test two_client_e2e -- --ignored --nocapture
```

The TypeScript tests cover minimal UTF-16 edits, convergence, remote-update feedback prevention,
local-only undo, save states, and relative cursor positions. The Rust test covers journal ordering,
idempotent acknowledgement, and the loopback-only plaintext rule. The server test uses PostgreSQL
and real WebSockets; it covers durable delivery, reconnect/replay, presence, and restart recovery.
