# ADR 0001: local-first realtime collaboration

- Status: Accepted
- Date: 2026-08-21

## Context

Oleafly starts every project as ordinary local files. Editing, AI calls, and compilation work
without a collaboration server. Sharing must preserve that property while adding named users,
authorization, durable synchronization, review, history, and published artifacts.

Four earlier assumptions no longer fit that job:

- A room per file cannot make a project-wide rename, restore, or revision atomic.
- A proprietary collaboration service would make the self-hosted edition incomplete.
- Git commits are useful local checkpoints, but they do not record each accepted collaborative edit
  or provide safe offline replay.
- In-place unsharing is ambiguous once several people own history and review data. Silently removing
  the server binding would strand or erase shared records.

## Decision

A shared project has one JavaScript Yjs `AuthoringDoc`. Text files are `Y.Text` values inside that
document; the tree uses stable file IDs, and binary content stays outside Yjs as immutable blob
references. JavaScript owns the semantic document. Rust uses `yrs` to exchange, validate, and store
opaque update bytes, but it does not create a second authoring model.

Membership, main-file selection, shared compile settings, and lifecycle are not Yjs fields. They use
typed control APIs with server-side capability checks. Authoring conflicts are strict, versioned
records rather than arbitrary JSON.

The collaboration server will be first-party, AGPL-licensed software built with Axum and PostgreSQL.
It commits an authorized authoring mutation before sending the durable receipt or broadcasting the
update. Presence is separate, ephemeral traffic. The desktop keeps an encrypted local journal and
materializes the converged document back to ordinary files.

The server is part of this monorepo. Its Axum service, database migrations, operator CLI, Compose
file, and Coolify descriptor will be versioned beside the desktop and protocol packages. The build
produces one OCI image with separate runtime modes. Operators deploy that image as a container, but
there is no separate server repository for the initial milestone.

Git remains available for private, manual interoperability. It is not the shared event log, and
shared projects will not make automatic Git commits.

Sharing is a staged migration with a short final cutover. A failed migration leaves the local
project untouched. Joining finishes only after the complete current text state is cached and
materialized locally.

There is no in-place Unshare command. Leaving closes and unbinds the original shared project. Making
a local copy mints another project and does not change the source. Owners can archive a project or
schedule deletion with a 30-day, read-only grace period. Restore and import create new
forward history; neither rewrites an existing collaboration.

The initial public contracts are recorded in [Realtime protocol v1](../realtime/protocol-v1.md) and
the machine-readable files under `fixtures/realtime/`.

## Consequences

Project operations can share one ordering boundary, and a single state vector describes the whole
authoring document. The server can enforce membership on each mutation and retain exact update
bytes for recovery.

The desktop must replace whole-string editor pathways before shared editing can ship. It also needs
an explicit materialization barrier before compile, export, close, and external-tool handoff.

Self-hosting includes the code that stores and coordinates source. Operators should understand that
the host can read server-side content; this design is encrypted at rest, not end-to-end encrypted.

Ending a collaboration takes an explicit lifecycle action. That costs a few more steps in the UI,
but it avoids pretending that shared history belongs to one device.
