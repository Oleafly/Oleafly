# Oleafly Checkpoints: dependency-evidence gate

Status: implementation gate, 2026-09-01.

This note records the executable dependency-capture investigation that must be
resolved before Oleafly can publish a reproducible Checkpoint. It is narrower
than the full storage design. Its purpose is to prevent a content-addressed
store from making a stronger recovery promise than the compiler evidence can
support.

## Product invariant

An Oleafly Checkpoint is an immutable recovery record for the exact
project-local inputs of one successful, validated compile. It is not a copy of
the project directory.

The default dependency snapshot contains:

- `project.json`, always
- the configured main document, always
- every project-local file the successful compiler actually read
- portable files selected by the project's `always_include` policy.

Unused files, compiler output, `.git`, `.oleafly`, `node_modules`, and
unrelated assets are not eligible merely because they exist.

A compile can still succeed when checkpoint evidence is incomplete, external,
or conflicts with project policy. In that case Oleafly must skip publication
and report a non-blocking reason. It must not broaden capture to the whole
project.

## Required engine interface

Dependency evidence belongs to each document-engine adapter. A generic parser
over whichever files happen to remain after a compile is not sufficient.

The adapter result needs to distinguish:

```text
Proven {
  project_inputs: [resolved path, logical path, first-read content digest],
  toolchain_inputs: [stable toolchain identity],
  external_inputs: [resolved path and reason],
}

Unavailable {
  reason,
  actionable_suggestion,
}
```

For a published checkpoint, the compile flow is necessarily a replay:

1. Run dependency discovery without publishing anything.
2. Reject or skip incomplete, external, or ignored-required evidence.
3. Under the project mutation seam, copy and hash the proven project inputs,
   `project.json`, and Always include paths into a private candidate.
4. Compile a materialization of those exact candidate bytes.
5. Require the replay report to contain no unexpected filesystem input and to
   digest-match the candidate.
6. Validate the output.
7. Publish the immutable source root last.

The discovery pass and candidate are compile preparation. Neither is a
Checkpoint.

## Executable probe matrix

The probes used checksum-pinned shipped tools where the repository provides
them:

- Tectonic 0.16.9 from `scripts/fetch-tectonic.sh`;
- Typst 0.15.0 from `scripts/fetch-typst.sh`;
- Pandoc 3.9.0.2 from `scripts/smoke-markdown.sh`; and
- local latexmk 4.86a with pdfLaTeX, XeLaTeX, LuaLaTeX, BibTeX, Biber, and
  PythonTeX probes.

Temporary fixtures contained nested source files, local classes and styles,
bibliographies, images, configuration, fonts, false/conditional branches,
symlinks, parent-relative and absolute paths, shell commands, and Python reads.

| Engine | Evidence that works | Correctness gap | Current publication status |
|---|---|---|---|
| Tectonic 0.16.9 | `--makefile-rules` reports many read TeX, image, class, style, config, font, and BibTeX inputs. Unused files stay absent. | Rules retain logical names rebased under the output directory rather than the resolved provider path. Symlink and parent-relative origins are ambiguous. BibLaTeX input is lost by the external-tool import path. Biber can read unreported user config. | Unavailable |
| latexmk 4.86a | Recorder output covers ordinary nested TeX, images, local classes/styles, bibliography, and several config paths when no shell escape is used. | Final `.fls`, `.fdb_latexmk`, and `-deps-out` are not a union of all passes. A file read only on pass one disappears from the successful final evidence. Shell commands and ordinary Python `open()` reads are also absent. | Unavailable |
| Typst 0.15.0 | Zero-delimited `--deps` correctly reports evaluated imports, `read()` data, images, bibliography, and package files. A false branch remains absent. | Loaded font files are held in a separate font store and are omitted from `--deps`. This includes a project font passed through `--font-path` with system and embedded fonts disabled. Symlinks are lexical and need canonical escape checks. | Unavailable |
| Markdown / Pandoc 3.9.0.2 | Structured `--verbose --log` JSON emits `LoadedResource` entries for bibliography, CSL, and media. Tectonic make rules can cover the generated TeX stage. | Current code discovers and passes every `.bib`, including unrelated files. Pandoc user-data overrides can affect output without a `LoadedResource` record. The Tectonic stage inherits the Tectonic gaps above. | Unavailable |

### Tectonic findings

The exact shipped sidecar exposes:

```text
tectonic -X compile --makefile-rules <path>
```

Ordinary local dependencies are present, and an absolute macOS system font is
reported as external. However, the rule serializer emits the logical open name
joined to the output directory. With Oleafly's separate build directory,
`styles/local.sty` is written as if it lived under the build directory even
though the successful provider was the project search path. A project symlink
to an external file remains the project-relative symlink name.

The BibLaTeX path is worse: Tectonic imports Biber's temporary input and changes
its origin classification, so the `.bib` can disappear from prerequisites.
`.run.xml` contains part of that information, but it is not a complete record
of Biber configuration reads. Biber searches user and platform config
locations unless invoked with `--noconf`; the current Tectonic and recovery
paths do not establish that invariant.

To make this safe, Oleafly needs a pinned Tectonic adapter or upstream patch
that emits a versioned machine-readable record for every filesystem input:
resolved provider path, logical name, origin, first-read digest, and bundle
identity. Biber execution must use a controlled environment and `--noconf`,
with its inputs merged into the same report.

### latexmk findings

Recorder output is useful but not cumulative. A successful multi-pass fixture
read `first-pass-only.tex` during pass one and skipped it after `.toc` existed.
After three passes, final `.fls`, `.fdb_latexmk`, and `-deps-out` all omitted
the file.

With shell escape enabled, a command successfully read a project data file
without adding the input to recorder evidence. PythonTeX likewise omitted a
normal Python `open()` dependency; PythonTeX's tracked open helpers are opt-in
and cannot prove arbitrary scripts.

The safe adapter must wrap every TeX invocation that latexmk starts
and archive/union each pass's recorder output before it is overwritten. Biber,
BibTeX, makeindex, and similar tools need controlled wrappers too. Checkpoints
remain unavailable whenever shell escape or PythonTeX is active unless the
whole process tree gains a correctness-grade filesystem broker.

### Typst findings

The exact Typst 0.15.0 sidecar was run with a fixture containing an import,
image, bibliography/data read, and a local `Arial.ttf` supplied through
`--font-path`. System fonts and embedded fonts were disabled. The compile
succeeded and used the 773,236-byte project font. The zero-delimited dependency
file contained the source, import, and image, but not the font.

This matches Typst's CLI architecture: file dependencies and fonts use
separate stores, while the current deps writer enumerates only the file store.
Timing output records a `load font` event without a path.

`--ignore-system-fonts` is not a transparent fix. It changes current document
output and still does not report project fonts. Embedding Typst in the desktop
crate is also not a small compatibility change because Typst 0.15 requires a
newer Rust toolchain than Oleafly's Rust 1.77 floor.

This needs an independently built, pinned Typst sidecar that
adds every loaded filesystem font, with resolved path and digest, to its
dependency report. Embedded fonts should be represented by compiler provenance
rather than copied into the project snapshot.

### Markdown findings

Pandoc's structured log is a useful stable seam:

```json
{"type":"LoadedResource","for":"image.png","from":"/project/image.png"}
```

It distinguishes local and remote resource fetching, and covers media,
bibliography, and CSL in focused probes. The main input is already known from
the command line.

Current Markdown compilation still has two silent widenings:

1. `discover_bibliographies` recursively passes every `.bib`, so unrelated
   bibliography files are intentionally read.
2. Pandoc's user data directory can override output-affecting data without a
   `LoadedResource` event.

A future adapter must use a supported/pinned Pandoc capability, an
Oleafly-controlled empty data directory, unconditional citeproc without the
whole-tree bibliography discovery, the structured JSON log, and a corrected
Tectonic dependency report. Network fetches and unclassified paths make that
compile non-self-contained.

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
target `.git`, `.oleafly`, or escape the project. They never contain local
store paths, backup destinations, URLs, or credentials.

Policy is applied after compiler evidence:

- an unread ignored path stays omitted
- a required ignored path leaves the compile successful, publishes no
  Checkpoint, and produces an actionable non-blocking notice
- Always include expands only the explicitly selected project paths.

Compatibility rules:

1. A missing `checkpoints` object means the default engine-dependencies mode.
2. Existing projects are not rewritten merely by opening them.
3. New projects remain two-file starters: the source file and `project.json`.
4. A store is created lazily only after the first publishable successful
   compile.
5. Duplicate/fork projects get a new project id and no copied history.
6. New desktop code preserves unknown manifest fields when rewriting metadata.
7. Already-released older Oleafly versions cannot preserve a field they do not
   know. Opening and rewriting a project in one of those versions can reset the
   checkpoint policy. This forward-compatibility limit must be documented; it
   cannot be repaired by the new binary after the older binary has discarded
   the data.

## Gate decision

No current engine can yet provide the complete evidence required for a
reproducible Checkpoint. Therefore snapshot publication must remain disabled
until at least one corrected engine adapter is available, and each unsupported
engine or mode must return a truthful skipped/unavailable outcome.

The preferred resolution is two independently built compiler adapters plus one
latexmk invocation wrapper:

1. Tectonic: resolved path, origin, digest, bundle identity, controlled Biber.
2. Typst: existing zero-delimited file evidence plus loaded filesystem fonts.
3. latexmk: per-pass recorder union and controlled auxiliary-tool execution.
   shell escape remains unavailable.
4. Markdown: controlled Pandoc data directory and structured resource log,
   followed by the corrected Tectonic adapter.

OS-level tracing, post-compile whole-tree scans, output-hash comparison, and
mtime/size heuristics are rejected. None is a uniform proof of the bytes the
compiler read on macOS, Windows, and Linux.
