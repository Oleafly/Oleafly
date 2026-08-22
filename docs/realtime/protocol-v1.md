# Realtime protocol v1

This page fixes the first public collaboration contract. The TypeScript definitions live in
`packages/realtime-protocol/`; Rust uses `crates/oleafly-realtime-protocol/`. Shared fixtures under
`fixtures/realtime/` keep the two implementations honest.

Realtime is not a released product capability yet. These contracts exist so the first two-client
Source editing slice has stable names and wire data.

## Version rules

| Contract | Current version | Code constant |
| --- | ---: | --- |
| Binary frame header | 1 | `FRAME_HEADER_VERSION` |
| Binary realtime protocol | 1 | `REALTIME_PROTOCOL_VERSION` |
| `AuthoringDoc` schema | 1 | `AUTHORING_DOC_SCHEMA_VERSION` |
| Authoring conflict record | 1 | `AUTHORING_CONFLICT_SCHEMA_VERSION` |
| Project controls | 1 | `PROJECT_CONTROLS_SCHEMA_VERSION` |
| Canonical test manifest | 1 | `CANONICAL_MANIFEST_SCHEMA_VERSION` |

A client and server advertise the versions they can read and choose the highest common value. They
must reject a connection when there is no common protocol version. An unknown `AuthoringDoc` schema
is also an error; a client must not guess at its contents.

Yjs updates use lib0 update-v1 encoding in protocol v1. Stored history keeps complete update bytes
and periodic full state snapshots. A state vector is only a summary used to calculate a difference;
it is not a project snapshot and cannot back a revision on its own.

An incompatible field or behavior change needs a new protocol or schema version. Compatible readers
must continue to accept the checked-in v1 vectors after a Yjs or `yrs` library upgrade.

## Identity glossary

| Name | Meaning | Format |
| --- | --- | --- |
| `ActorId` | Named account identity stamped by the server | UUID |
| `ServerProfileId` | Local desktop reference to one configured server | UUID |
| `ServerInstanceId` | Persistent identity returned by server discovery | UUID |
| `SharedProjectId` | Project identity within one server | UUIDv7 |
| `ReplicaId` | One installed desktop replica for a project | UUIDv7 |
| `FileId` | Stable identity retained across rename and move | UUIDv7 |
| `ProjectRevisionId` | One sealed immutable revision | UUIDv7 |
| `ClientUpdateId` | Idempotency key for one mutation envelope | UUIDv7 |
| `EditSessionId` | Groups nearby edits without changing their attribution | UUIDv7 |
| `ConflictId` | Stable identity for one typed authoring conflict | UUIDv7 |
| `ContentDigest` | Digest of canonical bytes | Lowercase `sha256:` plus 64 hex digits |

UUID text is canonical lowercase, hyphenated text. Readers reject uppercase, compact, non-RFC 4122,
and versionless values. Ordered IDs require UUIDv7. Unsigned 64-bit integers cover the full range
from 0 through 18446744073709551615; JavaScript represents them as `bigint`. Binary frames encode
them as unsigned big-endian values. HTTP and JSON contracts encode them as canonical decimal
strings. Readers reject JSON numbers, signs, leading zeroes, whitespace, and out-of-range values.

A remote project is the pair `(ServerInstanceId, SharedProjectId)`. A URL is not an identity. Desktop
may accept a changed URL when discovery returns the same instance ID; a different ID requires an
explicit trust decision.

`SharedProjectBinding` holds the local project ID, server profile, server instance, shared project,
replica, and local project state. Desktop stores that binding in encrypted app data outside the
project tree. Credentials remain in the operating system credential store and never appear in the
binding.

## Roles and authorization

Roles are capability presets. The server checks the capability and authorization epoch for every
durable command; the client-side matrix only controls the interface.

| Role | Added capabilities |
| --- | --- |
| Viewer | `source_read`, `presence_join`, `compile_private`, `review_read` |
| Commenter | Viewer capabilities, plus `review_create`, `review_manage_own` |
| Editor | Commenter capabilities, plus source/tree/binary writes, review moderation and suggestion decisions, file restore, version creation, and artifact publication/selection |
| Owner | Editor capabilities, plus membership and project controls, abusive-content hiding, whole-project restore, publisher policy, lifecycle, and ownership transfer |

The exact capability IDs and inherited lists are in `fixtures/realtime/contracts-v1.json`. Instance
and team administration grant no source capability. Presence identity comes from the authenticated
server session, never from an actor field supplied by a client.

## `AuthoringDocV1`

One Yjs document represents one shared project. Protocol v1 defines these root types:

| Root name | Yjs type | Contents |
| --- | --- | --- |
| `authoring` | `Y.Map` | `schema_version` only |
| `nodes` | `Y.Map<Y.Map>` | Stable tree nodes keyed by `FileId` |
| `texts` | `Y.Map<Y.Text>` | Canonical text keyed by `FileId` |
| `binary_heads` | `Y.Map<Y.Array>` | Immutable content-digest heads keyed by `FileId` |
| `conflicts` | `Y.Array` | Append-only typed conflict records |

Each node has `parent_id`, `name`, `collision_key`, `tombstone`, and `kind`. Kind is `directory`,
`text`, or `binary`. A text node has one matching `Y.Text`; a binary node has one matching head
array. A tombstone keeps the node ID and content for history and recovery but does not materialize a
file.

Readers accept only the five roots above. The metadata map contains only `schema_version`, and each
node map contains only the five node fields. Extra roots or fields fail validation. Text and binary
maps cannot contain entries without matching nodes of the correct kind. The same checks run on an
isolated candidate document before Rust applies an untrusted update to the authoritative document.

The materializer accepts a node name only when all of these rules hold:

- The name is non-empty Unicode NFC and is not `.` or `..`.
- It contains no control character, `/`, `\`, `<`, `>`, `:`, `"`, `|`, `?`, or `*`.
- It has no trailing dot or space.
- Its first dot-separated component is not `CON`, `PRN`, `AUX`, `NUL`, `COM1` through `COM9`, or
  `LPT1` through `LPT9` under the pinned ASCII fold.
- An active parent exists, is an active directory, and does not form a cycle.

The portable collision key first changes `\` to `/`, then applies Unicode 17.0 NFC, then maps ASCII
`A` through `Z` to `a` through `z`. Non-ASCII case is preserved. TypeScript uses checked-in tables
generated from the pinned Unicode 17.0 data files. Rust pins `unicode-normalization` 0.1.25, which
uses the same Unicode version. Host ICU tables are not part of this contract. Active siblings need
unique keys unless a matching typed `path_collision` record preserves all colliding values.

Conflict records are strict tagged values with `schemaVersion`, `conflictId`, and one of these
payloads:

| Kind | Required payload |
| --- | --- |
| `path_collision` | Parent, collision key, and at least two colliding file IDs |
| `binary_heads` | File ID and at least two immutable content digests |
| `delete_vs_edit` | Deleted file ID and the retained recovery-copy file ID |
| `rename_loser` | File ID plus losing and winning names |

Unknown kinds, fields, and schema versions fail closed. Multiple active binary heads likewise need a
matching `binary_heads` record.

The main file is not editor-writable Yjs state. `ProjectControlsSnapshotV1` and the
`set_main_file` command carry it through the authenticated Owner-only project-controls API. The
command includes an expected control version for optimistic concurrency.

Yjs counts text offsets as UTF-16 code units. Every `yrs::Doc` that edits an `AuthoringDoc` must use
`OffsetKind::Utf16`; the default byte offset mode is not compatible. The fixture deliberately edits
next to a character represented by a UTF-16 surrogate pair.

The Rust document constructor only sets `OffsetKind::Utf16`; it creates no root types or schema
fields. JavaScript owns initialization of the semantic document. Rust registers the expected root
types on an isolated validation candidate, then on the authoritative document only after the update
passes. The canonical manifest fixture is a deterministic logical view used by compatibility tests.
It does not replace the full Yjs state snapshot or canonical materialized source bundle used by a
sealed revision.

## Binary WebSocket frames

Every WebSocket data message is one binary frame. The 12-byte header is fixed:

| Offset | Size | Value |
| ---: | ---: | --- |
| 0 | 4 | ASCII `OLRT` |
| 4 | 1 | Frame-header version (`1`) |
| 5 | 2 | Negotiated protocol version, unsigned big-endian |
| 7 | 1 | Message kind |
| 8 | 4 | Payload byte length, unsigned big-endian |

Protocol version `0` is reserved for `opening_auth`, which runs before negotiation. Every other
message has a nonzero negotiated version. The opening payload contains a unique list of supported
16-bit versions and the 32-byte, one-use sync ticket. The ticket is never placed in the WebSocket
URL. The server chooses the highest common version and replies with `opening_accepted` under that
version, or closes the connection when no version matches.

Protocol v1 assigns these message-kind bytes:

| Byte | Message | Direction | Payload |
| ---: | --- | --- | --- |
| `0x01` | `opening_auth` | Client to server | Supported versions and 256-bit ticket |
| `0x02` | `opening_accepted` | Server to client | Empty |
| `0x10` | `yjs_sync` | Subtype-specific | Subtype plus opaque bytes |
| `0x11` | `mutation` | Client to server | `MutationEnvelopeV1` |
| `0x12` | `durable_receipt` | Server to client | Exact client mutation ID and server commit data |
| `0x20` | `client_presence` | Client to server | Optional selection, with no actor or replica identity |
| `0x21` | `server_presence` | Server to client | Server-stamped identity, display data, and selection |

Clients may send subtype `0`, a state-vector reconciliation request. Servers may send subtype `1`,
the update-v1 response to that vector, or subtype `2`, a committed broadcast. A client cannot send
an update through `yjs_sync`; authoring bytes enter the server only through the durable mutation
path. Byte fields use a 32-bit big-endian length.
Short UTF-8 strings use a 16-bit length; the accepted AI diff uses a 32-bit length. UUIDs occupy 16
network-order bytes. All 64-bit integers are unsigned big-endian values and round-trip to JavaScript
`bigint` without passing through `number`.

Both codecs enforce configurable ceilings before they allocate a field buffer, copy bytes, or call
the Yjs/`yrs` decoder. The defaults are a 4 MiB frame, a 2 MiB Yjs or mutation update, a 256 KiB
state vector, 4 KiB per relative position, 4 KiB per short string, and 1 MiB for an accepted AI
diff. Deployments may lower these values. A larger public limit requires a protocol review.

`fixtures/realtime/wire-v1.json` pins golden bytes for opening authentication, negotiation, a real
Yjs state vector, reconciliation update, committed broadcast, mutations with and without assistance,
a durable receipt, real relative positions, and selected or cleared presence in both directions.
Rust and TypeScript both decode and recreate every frame byte for byte.

## Mutations and durability

An authoring update travels in `MutationEnvelopeV1`:

```ts
interface MutationEnvelopeV1 {
  clientUpdateId: ClientUpdateId;
  replicaId: ReplicaId;
  clientSequence: bigint;
  editSessionId: EditSessionId;
  origin:
    | "human"
    | "suggestion_accept"
    | "version_restore"
    | "external_small_save"
    | "external_bulk_apply"
    | "import";
  assistance?: {
    provider: string;
    model: string;
    proposalIdentifier: string;
    acceptedDiff: string;
  };
  update: Uint8Array;
}
```

`clientUpdateId` and `(replicaId, clientSequence)` make replay idempotent. Replaying the same three
values is a no-op. Reusing a client update ID with a different replica or sequence is an error and
cannot clear the saved-state tracker. The server stamps actor,
server sequence, authorization epoch, and time after it authenticates the request. It writes the
journal row before issuing a durable receipt or broadcasting the update. Remote authoring changes
therefore never expose an uncommitted mutation. AI provenance is optional and strict. It can contain
only the provider, model, proposal identifier, and accepted diff; prompts, responses, reasoning,
chat history, and keys have no field in this message.

A durable receipt repeats `clientUpdateId`, `replicaId`, and `clientSequence`, then supplies the
server sequence, authorization epoch, and commit timestamp. Desktop tracks each pending ID. A
receipt removes only its matching entry, and the status remains `syncing` while any pending entry
remains. Only an empty pending set may display `saved_to_team`.

Presence is a separate typed message. A cursor selection contains a `FileId` and opaque Yjs relative
position bytes for its anchor and head. The client-to-server value has no actor field. The server
adds `ActorId`, `ReplicaId`, display name, and color token from the authenticated session before it
broadcasts the value. Presence can be rate-limited or dropped, is never persisted, and does not
change the saved state.

## State machines

The machine-readable transition tables in `fixtures/realtime/contracts-v1.json` are normative. An
event not listed for the current state is invalid.

The local project states are `local`, `sharing_staging`, `sharing_cutover`, `joining_bootstrap`,
`shared_active`, `revocation_recovery`, and `shared_closed`. Share or join failure returns to `local`.
A project becomes `shared_active` only after a durable cutover or a complete, durable join bootstrap.
Revocation keeps the encrypted local state in recovery until the user detaches, exports, or discards
it.

Leaving changes the original project to `shared_closed` and removes its live binding. It never turns
that project back into the original local project. "Make Local Copy" mints a separate solo project
and leaves the shared project's state unchanged.

Saved status is separate from project state: `saved_locally`, `syncing`, `saved_to_team`, `offline`,
or `recovery_required`. `durable_receipt_pending` leaves the status at `syncing`, while
`durable_receipt_complete` moves it to `saved_to_team`. A clean reconnect with no pending mutations
uses `reconciliation_complete_no_pending` for the same transition. Local edits made offline leave
the status `offline`; the journal tracks the safe pending IDs and count.

Server lifecycle states are `staging`, `active`, `archived_read_only`, `delete_pending`, and `purged`.
Staging can activate or expire. Active and archived projects can enter deletion grace. An Owner can
cancel during grace, returning the project to active; expiry moves it to the terminal `purged` state.

## Server packaging

The initial server is not a separate repository. This monorepo will contain the Axum control and
sync service, PostgreSQL migrations, operator CLI, and deployment descriptors for Compose and
Coolify. One signed OCI image provides the `control`, `sync`, `migrate`, `backup`, and `doctor`
modes. Coolify runs that image as a separate container alongside PostgreSQL and the configured blob
volume or S3-compatible store.
