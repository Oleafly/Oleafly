# Realtime protocol fixtures

These files are compatibility inputs, not snapshots to regenerate during a normal build.

- `contracts-v1.json` is the cross-language version, role, and state-transition table.
- `authoring-doc-v1.json` contains one Yjs update and one `yrs` update in lib0 update-v1 encoding.
- `canonical-authoring-manifest-v1.json` is the exact logical state after both updates.
- `wire-v1.json` pins binary WebSocket frames produced by both implementations.
- `identity-v1.json` pins accepted and rejected UUID text plus the full unsigned 64-bit range.
- `control-json-v1.json` pins strict decimal-string `u64` values and binding objects for JSON APIs.
- `materialization-v1.json` pins valid trees and cross-runtime rejection cases for file IDs and names.

The TypeScript test recreates the Yjs update byte for byte. The Rust test does the same for the
`yrs` update. To inspect the Rust-produced value while changing a fixture, run:

```sh
cargo run -p oleafly-realtime-protocol --example emit_yrs_fixture_update
cargo run -p oleafly-realtime-protocol --example emit_wire_fixture
node scripts/generate-unicode-nfc-v17.mjs
```

Changing a checked-in vector requires a schema or fixture-version decision. A library upgrade by
itself is not a reason to replace a vector; new implementations must continue to read old updates.
