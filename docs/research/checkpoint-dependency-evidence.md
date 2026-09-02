# Oleafly Checkpoints: dependency-evidence gate

Status: implementation decision, verified 2026-09-01.

This note records the dependency-evidence contract used before Oleafly may
publish a reproducible Checkpoint. It is narrower than the storage design. Its
purpose is to keep the content-addressed store from making a stronger recovery
promise than the compiler evidence supports.

## Product invariant

An Oleafly Checkpoint is an immutable recovery record for the exact
project-local inputs of one successful, validated compile. It is not a copy of
the project directory.

The default dependency snapshot contains:

- `project.json`, always
- the configured main document, always
- every project-local file reported by controlled compiler discovery
- portable files selected by the project's `always_include` policy
- for a compiler-reported file matched by `ignored`, its path and content
  hash only, with no stored bytes.

A checkpoint is written only when the sources changed. Before any probe runs,
the lane hashes the files of the newest checkpoint and compares the current
explicit input set and stored flags against it. If nothing differs, the
outcome is `unchanged` and no compiler starts. After sealing, a candidate whose
snapshot root is already visible is dropped with the same outcome, so history
never gains duplicates and never reorders.

Unused files, compiler output, `.git`, `.oleafly`, `node_modules`, and
unrelated assets are excluded. Protected directories are pruned at every
depth, including inside an Always include directory.

A compile can still succeed when checkpoint evidence is incomplete, external,
or conflicts with project policy. Oleafly then skips publication and reports a
non-blocking reason. It never broadens capture to the whole project.

## Evidence model

The shipped tools do not expose a uniform first-read digest API. Oleafly uses a
controlled discovery and sealed replay protocol instead. It does not claim
that a post-compile dependency list alone proves the bytes read by the ordinary
compile.

For a successful main-document compile, Oleafly:

1. Uses one fixed `SOURCE_DATE_EPOCH` for the ordinary compile and all probes.
2. Runs dependency discovery in a private output workspace with a controlled
   home, configuration, data, cache, and executable search path.
3. Requires the discovery PDF to byte-match the visible ordinary PDF.
4. Canonicalizes every reported input and rejects external, linked, protected,
   or missing paths. A reported input matched by `ignored` is kept as a
   replay-required input whose bytes are not stored.
5. Hashes and stages only those inputs, `project.json`, and explicit Always
   include files into a private candidate, and stops with `unchanged` when the
   candidate's root is already visible.
6. Recompiles from the candidate in a fresh output directory.
7. Requires the replay dependency closure to contain every and only the
   compiler-required candidate file.
8. Requires replay PDF bytes and toolchain identity to match discovery.
9. Publishes the immutable source root last.

The candidate stores pre-seal BLAKE3 identities and confirms path identity
while copying. Replay reads only sealed candidate bytes. Discovery output and
an unpublished candidate are compile preparation, not Checkpoints. Streaming
capture allows a 1 GiB input with bounded memory and stops before writing past
the 16 GiB per-file, 128 GiB per-checkpoint, or 250,000 chunk-reference limits.

Toolchain evidence includes the selected engine, exact compiler binary hashes,
the controlled-environment revision, the effective `SOURCE_DATE_EPOCH`, and
the Tectonic cache identity where applicable. Tectonic identity binds the
selected bundle marker, index, cached resource bytes, and generated formats.

Checkpoint probes share a private persistent Tectonic cache that ordinary
compiles do not use. Before each probe Oleafly seeds that cache from the
ordinary Tectonic cache for the selected bundle, linking or copying the bundle
marker, index, resource files, and generated formats, so the first checkpoint
never downloads and an offline user can still publish. A cooperative
cross-process lock covers seeding, discovery, identity hashing, replay, and
publication. A lane that finds the cache busy waits for it in the background,
checking for cancellation, and skips only after ten minutes. Cache hashing runs
on a blocking worker and is

bounded by file count, per-file size, total size, and traversal depth.


Publication is scheduled after the ordinary compile has returned. The compile
command records the visible PDF hash and the Biber marker while it still holds
the compile lock. Everything else runs later in a per-project lane: the
unchanged check, discovery, sealing, replay, and the store write. The lane
reports each outcome to the window through an event. It takes the shared
worktree lock only while it hashes or seals inputs, so a running probe does not
block editor saves. There is no queue: a newer successful compile cancels the
running lane and becomes its single successor. A worktree mutation, restore,
reset, import, or deletion cancels the lane before taking its own locks.
 Compiler binaries keep their recorded hash while size and modification
time are unchanged. The Tectonic cache keeps its recorded identity while a stat
fingerprint of the cache matches and every entry is at least two seconds old. A
cache that Tectonic has just changed is always rehashed.



The final history-store path is created only after discovery, sealing, replay,
and root-last publication succeed. A first publication builds a complete
nonempty store in a private sibling directory, then installs it with one
same-filesystem rename. Failed attempts leave the final path absent. A stable
per-project lock serializes installation, reset, and deletion across processes,
and the next attempt reaps private initialization directories left by a crash.

## Supported adapter matrix

| Engine | Controlled evidence | Publication status and limits |
|---|---|---|
| Tectonic 0.16.9 | `--makefile-rules`, canonical project-path validation, fixed bundle, controlled cache, empty executable search path, and `--only-cached` sealed replay | Available for direct LaTeX without shell escape or Biber. Project fonts are captured when Tectonic reports them. External and system fonts skip. |
| Typst 0.15.0 | Zero-delimited `--deps`, canonical project-path validation, controlled environment, `--ignore-system-fonts`, and sealed replay | Available only when the controlled compile reproduces the ordinary PDF. System or project filesystem fonts normally change that PDF and therefore skip. Embedded fonts are bound by the Typst binary hash. External packages skip. |
| Markdown with Pandoc 3.9.0.2 and Tectonic 0.16.9 | Pandoc structured resource log, sandbox mode, controlled data directory, citeproc, downstream Tectonic rules, fixed bundle, and cached-only sealed replay | Available when all resources are local and the controlled pipeline reproduces the ordinary PDF. Any fetching event or external path skips. |
| latexmk | Final recorder files are not a cumulative union of all passes. External helpers also have incomplete evidence. | Unavailable. |

### Tectonic

Tectonic reports logical dependency names relative to the output workspace.
The adapter rebases those names to the project only when the resulting
canonical regular file exists inside the project. Absolute dependencies are
validated directly. Symlink escapes and system font paths are rejected.

Direct Tectonic discovery cannot use `--untrusted` because that mode disables
the project search path required by Oleafly's generated wrapper. The controlled
executable search path is empty, shell escape is disabled, and a primary `.bcf`
artifact causes a skip before a probe can invoke Biber. Biber and other
auxiliary-tool closure remain unavailable.

Replay adds `--only-cached`. The selected bundle locator is fixed, and the
identity covers the cache bytes Tectonic actually has available. This
deliberately over-binds the selected cached bundle rather than guessing which
individual package byte mattered.

### Typst

Typst's zero-delimited dependency report covers evaluated imports, `read()`
data, images, bibliography, and package files. It omits filesystem font paths.
The adapter therefore disables system font discovery during controlled passes
and relies on the ordinary-to-discovery PDF equality check. A document whose
ordinary output depends on a system or project font fails that equality and is
not published. Preview packages outside the sealed project are external and
also skip.

The bundled Typst runtime test performs an ordinary compile, controlled
discovery, candidate sealing, mutation of the live source, and replay from the
sealed root. It requires identical PDFs and identical relative dependency
closures.

### Markdown

Pandoc emits structured `LoadedResource` records for bibliography, CSL, and
media. The adapter also rejects any structured event whose type indicates a
fetch. The downstream Tectonic makefile report is merged with Pandoc's resource
evidence.

Ordinary Markdown compilation keeps the released recursive bibliography
discovery behavior for compatibility. Controlled checkpoint probes do not scan
the project tree. They use bibliography declared by document metadata and the
conventional root `references.bib`. If that explicit controlled input set does
not reproduce the ordinary PDF, publication skips. Citation insertion writes
the metadata declaration for Markdown projects.

Pandoc always uses sandbox mode for deterministic PDF generation. Checkpoint
passes additionally use an empty controlled user-data directory, an empty
executable search path, structured JSON logging, and a pinned downstream
Tectonic bundle. Replay adds downstream `--only-cached`.

## Runtime and regression evidence

The implementation was exercised with the checksum-pinned shipped tools:

- Direct Tectonic discovery and cached-only replay produced byte-identical PDFs
  and reported the wrapper, main source, nested sources, local fonts, and local
  configuration. An absolute system font was rejected.
- Markdown discovery and cached-only replay produced byte-identical PDFs under
  the controlled executable path. Local images and bibliography were reported.
  Remote fetching was rejected.
- Typst discovery and sealed replay produced byte-identical PDFs and identical
  relative dependency closure. A live source mutation after sealing did not
  affect replay.
- Modifying a cached Tectonic resource changed the recorded toolchain identity.
- Paths containing spaces were accepted. Parent escapes, symlinks, and
  protected directories were rejected. An ignored required input was recorded
  by identity and replayed from its sealed copy without storing its bytes.

Focused unit and integration tests cover parser bounds, policy matching,
Unicode wildcard semantics, protected-directory pruning, exact replay closure,
root-last publication, atomic first-store installation, concurrent reset,
bounded cache-lock contention, and compiler-cache path substitution.

## Project policy and compatibility

Portable project policy belongs in `project.json`:

```json
{
  "checkpoints": {
    "mode": "engine_dependencies",
    "always_include": [],
    "ignored": []
  }
}
```

Patterns use validated project-relative forward-slash syntax. They cannot
target `.git`, `.oleafly`, or escape the project. Traversal also excludes
`node_modules` at every depth. Patterns never contain local store paths, backup
destinations, URLs, or credentials.

Policy is applied after compiler discovery:

- an unread ignored path stays omitted
- a required ignored path is sealed for replay and recorded by path and hash,
  but its bytes are not stored and a restore leaves it as it is on disk
- `project.json` and the main document are always stored
- Always include expands only explicitly selected project paths.

Compatibility rules:

1. A missing `checkpoints` object means engine-dependencies mode.
2. Existing projects are not rewritten merely by opening them.
3. New projects remain two-file starters: source plus `project.json`.
4. Duplicate and fork projects receive a new id and no copied history.
5. New desktop code preserves unknown manifest fields when rewriting metadata.
6. Older releases cannot preserve fields they do not understand. If one
   rewrites `project.json`, it can reset checkpoint policy.
7. Ordinary desktop and CLI Markdown compilation retain their prior recursive
   bibliography behavior. Only controlled checkpoint probes use explicit
   bibliography inputs.

## Gate decision

Controlled Tectonic, Typst, and Markdown adapters may publish only after the
full discovery, capture, sealed replay, output equality, closure equality, and
toolchain identity checks pass. Any failed or unavailable check returns a
truthful non-blocking skipped outcome while preserving the successful ordinary
compile.

latexmk, Biber, shell escape, draft mode, external resources, external fonts,
external packages, and incomplete dependency reports remain unavailable.

OS-level tracing, post-compile whole-tree scans, mtime or size heuristics, and
output comparison by itself remain rejected. Output equality is accepted only
as one check inside the controlled sealed-replay protocol.
