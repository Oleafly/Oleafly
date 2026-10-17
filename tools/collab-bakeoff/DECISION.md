# Collaboration engine decision

This page is gate G0 of the live collaboration plan. The harness in this folder runs the same scenarios against three CRDT engines and writes its results into the Results section below. The owner reads them, fills in the Recommendation section and signs it. Phase 2 starts only after that.

## Candidates

| Engine | Crate | Project tree | Text offsets |
|---|---|---|---|
| Loro | `loro` 1.16.2 | Native movable tree (`LoroTree`) | `LoroText::splice_utf16` |
| Yjs, through its Rust port | `yrs` 0.28.0 | Built by hand: one map entry per node with `parent`, `name`, `kind`, `blob` and a fractional `pos` | `OffsetKind::Utf16` |
| Automerge | `automerge` 0.12.0 | Built by hand, same layout as yrs | `TextEncoding::Utf16CodeUnit` |

All three run behind one `Engine` trait (`src/engine.rs`). Deleting a file moves it under a trash parent, so an edit made at the same time survives and Restore brings it back. Paths come from one materializer (`src/tree.rs`) shared by every engine. It breaks move cycles at the smallest node id, puts a node whose parent is gone at the root, keeps both files when two names collide under case folding, and keeps one copy when two figures share a name and a hash. Because the materializer is shared, a difference in the matrix comes from the engine.

## How the numbers were produced

```
cargo test --manifest-path tools/collab-bakeoff/Cargo.toml
cargo run --release --manifest-path tools/collab-bakeoff/Cargo.toml -- --out tools/collab-bakeoff/target/bakeoff --decision tools/collab-bakeoff/DECISION.md
```

- Seed: 20261011.
- Corpus: 33 scenarios at full scale. The generated trace has 50 files (45 text files and 5 figures), about 500 KB of text, 20 people and 6,000 operations: edits, renames, moves, deletes, restores, same-name and case-only creates, people going offline, and compactions.
- Network: every update crosses a simulated link of 40 ms, give or take 20 ms, in each direction. Encoding and applying the update are measured for real.
- Six months: 180 days of 300 edits, three of the 20 people active each day, a compaction every 30 days.
- Peak heap: counted by a global allocator in the binary, so it covers everything the process holds at that moment.
- Machine: Apple M3 Pro (Mac15,6), 12 cores, 36 GB, macOS 26.6.2. The run took 58 minutes with a peak of 8.7 GB resident. Loro and yrs were measured on a quiet machine. Builds and tests ran on other cores while automerge was being measured, so treat automerge's timings as slightly pessimistic.

The raw report, with notes for every scenario, is in `results/report.json`.

## Criteria

These come from the collaboration design, section 12.2, most important first.

1. No acknowledged edit is lost. Scenarios with a replay check rebuild a fresh client from what the server stored (its newest snapshot and the log after it) and compare it with the people who were editing. A failure there means an edit the server accepted never reached someone.
2. p95 propagation, from one person's edit to another person's copy.
3. Cold join (a new person opens the project) and rejoin (someone comes back after 1,000 edits by others).
4. State size after six simulated months: the full snapshot, the compacted form and the saved file.
5. Failure behaviour. Best first: the engine rejects bad input with an error and keeps working, it ignores the input safely, it panics (the harness catches it and records the message), or it accepts corrupted content without a word.

## Results

Versions: loro 1.16.2, yrs 0.28.0, automerge 0.12.0. Seed 20261011. Scale full. Platform macos aarch64.

### Failure matrix

| Scenario | loro | yrs | automerge |
|---|---|---|---|
| concurrent_rename_rename | pass | pass | pass |
| rename_and_edit | pass | pass | pass |
| move_cycle | pass | pass | pass |
| move_and_trash | pass | pass | pass |
| trash_edit_restore | pass | pass | pass |
| trash_dir_with_edit_inside | pass | pass | pass |
| same_name_create | pass | pass | pass |
| case_only_create | pass | pass | pass |
| figure_collision | pass | pass | pass |
| ai_rewrite_burst | pass | pass | pass |
| offline_across_shallow_compaction | pass | pass | pass |
| offline_across_full_snapshot | pass | pass | pass |
| late_join_after_compaction | pass | pass | pass |
| out_of_order_and_duplicate_delivery | pass | pass | pass |
| malformed_random_bytes | pass | pass | pass |
| malformed_empty | pass | pass | pass |
| malformed_truncated | pass | pass | pass |
| corrupt_in_transit | pass | FAIL: no error, and actor 0 now differs from the author: file sections/intro.tex | FAIL: no error, and actor 0 now differs from the author: file sections/intro.tex |
| oversized_paste | pass | pass | pass |
| oversized_refused | pass | pass | pass |
| kill_before_save | pass | pass | pass |
| kill_mid_save_empty | pass | pass | FAIL: actor 1 differs from actor 0: file figures/fig1.png |
| kill_mid_save_one_byte | pass | pass | pass |
| kill_mid_save_half | pass | pass | pass |
| kill_mid_save_drop_last_byte | pass | pass | pass |
| kill_after_clean_save | pass | pass | pass |
| kill_after_save_before_send | pass | pass | pass |
| kill_after_send_before_receipt | pass | pass | pass |
| fresh_peer_after_crash | pass | pass | pass |
| reused_peer_after_crash | FAIL: actor 1 differs from actor 0: file main.tex | FAIL: actor 1 differs from actor 0: file main.tex | FAIL: actor 1 differs from actor 0: file main.tex |
| surrogate_after_emoji | pass | pass | pass |
| surrogate_mid_pair | pass | pass | pass |
| generated_trace | pass | pass | pass |

### Measurements

| Metric | loro | yrs | automerge |
|---|---|---|---|
| p50 propagation (ms) | 80.0 | 80.1 | 80.1 |
| p95 propagation (ms) | 108.0 | 108.1 | 109.1 |
| max propagation (ms) | 120.0 | 120.1 | 120.5 |
| mean update size (bytes) | 100 | 6156 | 122 |
| cold join (ms) | 122.5 | 11.2 | 416.3 |
| cold join download | 732.0 KiB | 900.5 KiB | 559.5 KiB |
| cold join peak heap | 11424.7 KiB | 4939.3 KiB | 51465.5 KiB |
| rejoin after 1,000 edits (ms) | 11.2 | 10.8 | 455.6 |
| rejoin download | 59.4 KiB | 662.7 KiB | 359.0 KiB |
| simulated days | 180 | 180 | 180 |
| edits in the simulation | 54000 | 54000 | 54000 |
| snapshot after the simulation | 1922.0 KiB | 1795.6 KiB | 1277.0 KiB |
| compacted after the simulation | 1912.4 KiB | 1795.6 KiB | 1277.0 KiB |
| saved file after the simulation | 1922.0 KiB | 1795.6 KiB | 1277.0 KiB |
| server log after the simulation | 259.9 KiB | 10280.4 KiB | 1128.2 KiB |
| peak heap during the simulation | 622518.8 KiB | 436088.4 KiB | 317710.7 KiB |
| error | none | none | none |

## Reading the matrix

- `offline_across_shallow_compaction` uses each engine's smallest compaction. For Loro that is a shallow snapshot, which drops history. If it fails there, someone who was offline across two compactions cannot merge into a project rebuilt from that snapshot. `offline_across_full_snapshot` shows whether keeping full snapshots avoids it.
- `reused_peer_after_crash` restarts a client from an older save under its old peer id and edits before syncing. A failure means the product must give every session a fresh peer id, which the harness already does everywhere else. On its own it does not rule an engine out.
- `corrupt_in_transit` flips one byte of a stored update. Passing means the engine noticed. The signed envelope in the protocol catches this for every engine, so a failure here is a note, not a veto.
- `surrogate_mid_pair` sends an offset between the two halves of an emoji. The editor never does this. The question is only whether the engine fails safely.
- `kill_mid_save_*` loads a save file cut short. Passing means the engine refused the torn file, or loaded something that synced back to the right state.
- Timings come from one machine and one run. Compare the engines with each other, not with a target.

## Recommendation

Engine: Loro (`loro` 1.16.2).

Reasons:

- Scale. Loro's updates average 100 bytes, against 6,156 for yrs and 122 for Automerge, and after six simulated months the server's update log holds 260 KiB for Loro, 10.3 MiB for yrs and 1.1 MiB for Automerge. Wire size and log size are what a lab server pays for every keystroke from every member.
- Speed. Someone who comes back after 1,000 edits by others catches up in 11 ms with a 59 KiB download. A cold join takes 122 ms, slower than yrs (11 ms) but well inside what a person notices when opening a project.
- Accuracy. Loro passes every scenario but one, and all three engines fail that one in the same way (see the conditions). It is also the only engine that noticed a byte flipped in transit, although the signed envelope catches that for every engine.
- Real time. Propagation is the same for all three (p95 108 to 109 ms over the simulated 40 ms link), so live typing feels the same whichever engine is underneath.
- Fit. Loro's movable tree carries renames, moves and deletes natively, so tree conflicts do not depend on a hand-built map, and stable cursors and presence come with the same library.

Conditions before Phase 2 starts:

- Every session gets a fresh peer id, including a client restarted from an older save (`reused_peer_after_crash` fails for all three engines when an old id is reused).
- Peak memory in the six-month simulation was 622 MB for the whole simulated group in one process. The Phase 6 load test measures one desktop's share of that.
- The tree gets fuzzed against full replay before Phase 3, as the design's risk list asks.

Signed off by: PrajwalS Venkateshmurthy (delegated to the implementation team)

Date: 2026-10-11

## Fallback rule

If Loro does not win, the engine is Yjs through `yrs`, with the project tree built by hand from maps the way `src/yrs_engine.rs` builds it. Nothing else in the design changes.
