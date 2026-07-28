# Editor Intelligence 100% Support and Release Acceptance Contract

**Status:** Accepted Phase 0 baseline
**Date:** 2026-07-27
**Scope:** Nine editor features across LaTeX, Markdown, Typst, and BibTeX on
Source, Visual, and PDF surfaces

## 1. Purpose

This document is the canonical support and release contract for:

1. Advanced Syntax Highlighting
2. Live Reference Checking
3. Integrated PDF Viewer
4. Live Inline Preview
5. LaTeX Commands Completion and Syntax Checking
6. Live Grammar Checking
7. Local and Global Structure View
8. Citations Checking and Completion
9. Spellchecking

It fixes the meaning of "100% supported" before later phases extend the
implementation. A machine-readable contract, representative fixtures, feature
tests, and performance harnesses are executable evidence for this document;
they do not broaden or weaken its scope.

## 2. Exact meaning of 100%

A release may claim **100%** only when all of the following are true:

- Every release criterion in this document passes for every applicable
  engine, file class, and surface.
- The criteria pass on every release platform: `macos` (macOS arm64),
  `windows` (Windows x64), and `linux` (Linux x64).
- All five English grammar dialects pass.
- Every dictionary pack actually shipped by the application passes.
- Correctness, stale-result rejection, visible-failure, project-size, and
  performance gates all pass.
- Required unit, integration, end-to-end, fixture, and performance evidence is
  green with no waived or known failure.

There is no averaging, weighted score, partial credit, or silent fallback.
An explicitly documented non-applicable cell does not reduce 100%. An
undocumented omission does. The representative fixture corpus is a mandatory
regression floor, not the maximum syntax the product accepts and not a
substitute for feature-specific tests.

## 3. Supported engines, files, and surfaces

### 3.1 Surface definitions

- **Source:** the editable CodeMirror surface, bound to the active project,
  file, and source revision.
- **Visual:** the Tiptap WYSIWYG surface for a document body. Preambles,
  frontmatter, custom raw constructs, and other source-only regions remain
  source-owned.
- **PDF:** the integrated viewer displaying the latest successful compiled PDF
  for the active main document and project revision.

### 3.2 Support matrix

| Engine and file class | Extensions | Contractual surfaces | Scope |
| --- | --- | --- | --- |
| LaTeX documents | `.tex`, `.ltx`, `.latex` | Source, Visual, PDF | Full source intelligence; Visual operates on the document body; PDF displays compiled output |
| LaTeX support files | `.sty`, `.cls` | Source | Full LaTeX source intelligence; no WYSIWYG or standalone PDF promise |
| Markdown documents | `.md`, `.markdown` | Source, Visual, PDF | Pandoc Markdown source, document-body Visual editing, and compiled PDF |
| Typst documents | `.typ` | Source, PDF | Source intelligence, source proofing, and compiled PDF |
| BibTeX files | `.bib` | Source | Highlighting, recoverable syntax linting, entry indexing, and completion |

Extension routing is case-insensitive, but a lookalike suffix such as
`.typ.txt` is not supported. `.bst` is explicitly outside full LaTeX
intelligence. Existing generic highlighting for `.bst`, if any, is
best-effort and cannot be counted toward this contract.

### 3.3 Typst Visual and inline-preview exception

Typst does not require Tiptap WYSIWYG parity or KaTeX live-inline-preview
parity. Its contractual surfaces are source intelligence, source proofing, and
integrated PDF. These are explicit non-applicable cells, so their absence does
not reduce an otherwise valid 100% result. Typst results must never be
presented as if WYSIWYG or KaTeX parity exists.

### 3.4 Canonical feature applicability matrix

This table is the canonical applicability matrix. Each row is one structured
applicability group; comma-separated Surfaces and Extensions cells form a
cross product. The machine-readable contract must expand to exactly the same
feature, engine, surface, and extension tuples, with no additional or omitted
tuple.

| Feature ID | Engine | Surfaces | Extensions |
| --- | --- | --- | --- |
| `advanced-syntax-highlighting` | `latex` | `source` | `.tex, .ltx, .latex, .sty, .cls` |
| `advanced-syntax-highlighting` | `markdown` | `source` | `.md, .markdown` |
| `advanced-syntax-highlighting` | `typst` | `source` | `.typ` |
| `advanced-syntax-highlighting` | `bibtex` | `source` | `.bib` |
| `live-reference-checking` | `latex` | `source, visual` | `.tex, .ltx, .latex` |
| `live-reference-checking` | `latex` | `source` | `.sty, .cls` |
| `live-reference-checking` | `markdown` | `source, visual` | `.md, .markdown` |
| `live-reference-checking` | `typst` | `source` | `.typ` |
| `integrated-pdf-viewer` | `latex` | `pdf` | `.tex, .ltx, .latex` |
| `integrated-pdf-viewer` | `markdown` | `pdf` | `.md, .markdown` |
| `integrated-pdf-viewer` | `typst` | `pdf` | `.typ` |
| `live-inline-preview` | `latex` | `source, visual` | `.tex, .ltx, .latex` |
| `live-inline-preview` | `markdown` | `source, visual` | `.md, .markdown` |
| `latex-commands-completion-and-syntax-checking` | `latex` | `source` | `.tex, .ltx, .latex, .sty, .cls` |
| `live-grammar-checking` | `latex` | `source, visual` | `.tex, .ltx, .latex` |
| `live-grammar-checking` | `markdown` | `source, visual` | `.md, .markdown` |
| `live-grammar-checking` | `typst` | `source` | `.typ` |
| `local-and-global-structure-view` | `latex` | `source, visual` | `.tex, .ltx, .latex` |
| `local-and-global-structure-view` | `latex` | `source` | `.sty, .cls` |
| `local-and-global-structure-view` | `markdown` | `source, visual` | `.md, .markdown` |
| `local-and-global-structure-view` | `typst` | `source` | `.typ` |
| `local-and-global-structure-view` | `bibtex` | `source` | `.bib` |
| `citations-checking-and-completion` | `latex` | `source, visual` | `.tex, .ltx, .latex` |
| `citations-checking-and-completion` | `latex` | `source` | `.sty, .cls` |
| `citations-checking-and-completion` | `markdown` | `source, visual` | `.md, .markdown` |
| `citations-checking-and-completion` | `typst` | `source` | `.typ` |
| `citations-checking-and-completion` | `bibtex` | `source` | `.bib` |
| `spellchecking` | `latex` | `source, visual` | `.tex, .ltx, .latex` |
| `spellchecking` | `markdown` | `source, visual` | `.md, .markdown` |
| `spellchecking` | `typst` | `source` | `.typ` |

## 4. Proofing scope

### 4.1 Grammar

Live grammar checking is English-only and uses Harper. These dialects are all
contractual:

| Dialect | Locale |
| --- | --- |
| American English | `en-US` |
| British English | `en-GB` |
| Australian English | `en-AU` |
| Canadian English | `en-CA` |
| Indian English | `en-IN` |

For any other language, the UI must identify English as the supported grammar
scope and report the requested language as unsupported. It must not claim that
unsupported-language prose was checked.

### 4.2 Spelling dictionaries

`en-US` is the mandatory baseline. The scope of 100% automatically includes
every paired `.aff` and `.dic` dictionary pack shipped under
`public/dictionaries`; adding a shipped pack adds it to this contract.

For each shipped pack, loading, known-word recognition, known-misspelling
detection, suggestions, and user-dictionary behavior must pass. An orphaned
`.aff` or `.dic`, a load failure, or a missing mandatory `en-US` pack blocks
release. A requested pack that is not shipped or cannot load must appear as
visibly unavailable. The implementation may fall back only if it labels the
active pack truthfully; it may never claim to be using the requested pack
while silently checking with another.

### 4.3 Prose extraction

Grammar and spelling operate on prose regions in LaTeX, Markdown, and Typst
documents, in Source and supported Visual surfaces. Engine markup, commands,
URLs, code, citation syntax, math, and comments excluded by the engine's
proofing rules must not generate synthetic findings. Masking must preserve
source offsets exactly enough for diagnostics and fixes to target the original
text. Package/class implementation text and BibTeX field prose are outside the
document-proofing contract.

## 5. Global correctness rules

### 5.1 Stale-result rejection

Stale asynchronous analysis, proofing, and parse responses are rejected
without painting or committing any part of the response. Retaining an already
accepted, last successfully compiled PDF is the sole display exception
described below; the stale response itself is still rejected, and the retained
PDF is not current.

- A file-scoped job is identified by `projectId`, `filePath`,
  `sourceRevision`, and `requestGeneration`.
- A project-scoped job is identified by `projectId`, `projectRevision`, and
  `requestGeneration`.
- A compile or PDF-load job is identified by `projectId`, `mainDocument`,
  `projectRevision`, and `requestGeneration`.

Compile and PDF-load results capture `projectRevision` and are accepted only
when the captured `projectRevision` equals the current `projectRevision`.
This revision covers the whole compile dependency graph: changes to the main
document, included or imported files, bibliographies, or assets advance
`projectRevision`.

Before an asynchronous analysis, proofing, or parse response updates
highlighting, diagnostics, previews, completion state, structure, or citations,
every identity field must still match the active request. A stale completion
item cannot be accepted. Cancellation is an optimization, not the correctness
mechanism; identity validation is still required.

Discarding a stale result does not need a user-facing error for every
keystroke. The UI keeps the newest request pending or retains only a result
clearly belonging to the current revision.

A stale compile or PDF-load response is rejected without replacing the
accepted PDF. An already accepted last-good PDF may remain visible only while
a newer project revision is pending compilation or its compile has failed. It
must be prominently marked `stale` and `non_current`, must identify that it
does not represent the current project revision, and must never be presented as
current.

### 5.2 Incomplete and malformed source

Incomplete and malformed files must stay editable. Parsers recover as far as
possible, keep useful highlighting/outline/catalog information around the
damage, and return accurate syntax diagnostics. When recovery is incomplete,
the UI shows that analysis is partial. A parser exception, timeout, or
unreadable dependency must not turn into an empty "no issues" result.

### 5.3 Visible state taxonomy

| ID | Kind | Meaning | Required presentation |
| --- | --- | --- | --- |
| `unsupported` | state | The requested cell is explicitly outside this contract | Show an unsupported label and the reason |
| `unavailable` | state | A supported capability or required local asset could not load | Name the unavailable capability and offer retry or setup where actionable |
| `not_run` | state | No current-revision result has completed | Show not run or pending; never show success or "no issues" |
| `error` | state | The current-revision operation failed | Show the failure at the affected surface with actionable detail and retry |
| `partial` | state | Recovery produced incomplete current-revision results | Show recovered results together with a partial-analysis indicator and syntax diagnostics |
| `success` | state | A complete current-revision operation succeeded | Show current results; an empty result may say "no issues" |
| `stale` | modifier | Accepted output belongs to an older project revision | Mark the retained output prominently as stale |
| `non_current` | modifier | Displayed output does not represent the active project revision | Explicitly identify that the output is not current |

An empty success is valid only after a complete current-revision run.
Timeouts are errors. Silent file-count, character-count, issue-count, or time
cutoffs are forbidden.

## 6. Performance and project-size release gates

Performance gates use this fixed reference machine: **Mac mini (M1, 2020),
8-core CPU, 16 GiB RAM, SSD, macOS 15, on AC power**. Each gate receives three
warmup runs followed by 20 measured runs, and the recorded statistic is p95.
Functional acceptance remains a separate gate on all three release platforms;
passing the macOS reference-machine performance run does not imply functional
acceptance on Windows or Linux.

These numbers are normative reference-hardware release gates:

| Gate | Budget |
| --- | --- |
| Reference project | Up to 200 source files and 500,000 total source characters |
| Single-document stress case | 500,000 characters |
| Main-thread responsiveness | No feature-attributable task over 50 ms |
| Cached completion | p95 at or below 100 ms |
| Project-backed completion | p95 at or below 250 ms |
| Incremental visible syntax update | p95 at or below 50 ms |
| Project diagnostics and structure | p95 at or below 750 ms after 300 ms idle |
| Normal proofing | Full 100,000 characters in a worker within 2 seconds |
| Stress proofing | Full 500,000 characters in a worker within 8 seconds |
| Inline math refresh | At or below 500 ms after idle |
| Auto-compile | Starts within 3 seconds after an edit |

Proofing may not satisfy a budget by truncating input or findings. The
repeatable measurement harness is completed in later phases, but later work
may not relax the pinned hardware, methodology, or budgets implicitly. A
release cannot claim 100% until the pinned harness passes.

## 7. Per-feature release criteria

### 7.1 Advanced Syntax Highlighting

**Feature ID:** `advanced-syntax-highlighting`

**Applies to:** LaTeX document/support Source, Markdown Source, Typst Source,
and BibTeX Source. Visual and PDF are non-applicable because they render
document structure/output rather than source tokens.

Release requires:

1. **`ASH-01`** — Constructs covered by the representative corpus and feature grammar suites
   receive engine-correct token classes in every declared source extension.
2. **`ASH-02`** — Incomplete and malformed input retains useful highlighting around damage,
   stays editable, and shows a diagnostic or partial state without crashing.
3. **`ASH-03`** — Incremental highlighting paints only the current revision and meets the
   visible-syntax and main-thread budgets.
4. **`ASH-04`** — Extension routing is case-insensitive for declared extensions and does not
   grant full support to lookalike or explicitly excluded suffixes.

### 7.2 Live Reference Checking

**Feature ID:** `live-reference-checking`

**Applies to:** LaTeX document Source/Visual and support Source, Markdown
Source/Visual, and Typst Source. PDF is non-applicable. BibTeX key integrity is
covered by citations checking.

Release requires:

1. **`LRC-01`** — Local and cross-file labels, anchors, links, includes, imports, and relevant
   asset targets resolve with engine-correct syntax.
2. **`LRC-02`** — Missing and duplicate targets are reported at every affected range, while
   valid targets produce no false error.
3. **`LRC-03`** — Malformed/unreadable files yield visible partial/error states and never a
   false "no issues" result.
4. **`LRC-04`** — File create, edit, rename, move, and delete invalidate affected project
   state, reject stale results, and pass project-analysis budgets.

### 7.3 Integrated PDF Viewer

**Feature ID:** `integrated-pdf-viewer`

**Applies to:** compiled PDFs from LaTeX, Markdown, and Typst document engines.
Source, Visual, support files, and BibTeX are non-applicable to this feature.

Release requires:

1. **`PDF-01`** — The latest successful PDF bytes from each supported engine render without
   engine-specific viewer regressions.
2. **`PDF-02`** — Page navigation, zoom/fit, scrolling, text selection/search, links, and
   download work on representative single- and multi-page documents.
3. **`PDF-03`** — Missing, invalid, unavailable, and failed loads show truthful visible states
   rather than blank success.
4. **`PDF-04`** — A stale compile or PDF load can never replace the accepted PDF. A retained
   last-good PDF for a pending or failed newer project revision is prominently marked
   stale and is never represented as current.

### 7.4 Live Inline Preview

**Feature ID:** `live-inline-preview`

**Applies to:** LaTeX and Markdown document bodies in Source and Visual.
LaTeX support files, PDFs, BibTeX, and all Typst cells are non-applicable here.
Typst uses the explicit exception in section 3.3.

Release requires:

1. **`LIP-01`** — Supported inline and display math forms render their exact source and
   refresh after edits in both engines.
2. **`LIP-02`** — Preview decorations never alter source, block cursor/selection operations,
   hide the editable expression, or create an inaccessible focus trap.
3. **`LIP-03`** — Incomplete or invalid math stays editable and shows a visible,
   non-destructive fallback instead of throwing or disappearing silently.
4. **`LIP-04`** — Only current-revision output is painted, and refresh meets inline and
   main-thread budgets.

### 7.5 LaTeX Commands Completion and Syntax Checking

**Feature ID:** `latex-commands-completion-and-syntax-checking`

**Applies to:** Source for `.tex`, `.ltx`, `.latex`, `.sty`, and `.cls`.
Visual, PDF, Markdown, Typst, BibTeX, and `.bst` are non-applicable.

Release requires:

1. **`LCS-01`** — Commands, environments, argument forms, document classes/packages, and
   project-defined macros/environments complete in valid contexts.
2. **`LCS-02`** — Unclosed or mismatched delimiters/environments, malformed command forms, and
   parser errors receive accurate current-revision diagnostics.
3. **`LCS-03`** — Completion remains available at incomplete command/argument sites; damaged
   neighboring source degrades visibly to partial results instead of disabling
   the file.
4. **`LCS-04`** — Cached and project-backed completion meet their latency gates, and a stale
   completion item cannot be committed.

### 7.6 Live Grammar Checking

**Feature ID:** `live-grammar-checking`

**Applies to:** LaTeX and Markdown document prose in Source/Visual, and Typst
document prose in Source. PDF, LaTeX support implementation text, and BibTeX
field prose are non-applicable.

Release requires:

1. **`LGC-01`** — Harper checks English prose under all five declared dialects, and
   diagnostics/suggestions reflect the active dialect.
2. **`LGC-02`** — Engine markup, URLs, code, citation syntax, math, and excluded comments are
   masked without offset drift or synthetic grammar errors.
3. **`LGC-03`** — Suggestions, ignores/categories, unsupported languages, loading failures,
   and partial analysis all have truthful visible states.
4. **`LGC-04`** — Full-input proofing runs off the main thread, rejects stale revisions, uses
   no silent cutoff, and passes both normal and stress budgets.

### 7.7 Local and Global Structure View

**Feature ID:** `local-and-global-structure-view`

**Applies to:** LaTeX document Source/Visual and support Source, Markdown
Source/Visual, Typst Source, and BibTeX Source. PDF is non-applicable.

Release requires:

1. **`SGV-01`** — The active file exposes an ordered, navigable, engine-correct local outline
   with stable source ranges.
2. **`SGV-02`** — The project view merges all supported files into a navigable hierarchy and
   include/import/link graph without losing duplicate or unresolved nodes.
3. **`SGV-03`** — Project-defined LaTeX symbols and BibTeX entries retain defining file/range
   and feed navigation and completion consumers.
4. **`SGV-04`** — Content/file mutations invalidate affected nodes, malformed files remain
   partially represented, stale graphs are rejected, and the 200-file/500,000
   character project gate passes.

### 7.8 Citations Checking and Completion

**Feature ID:** `citations-checking-and-completion`

**Applies to:** LaTeX document Source/Visual and support Source, Markdown
Source/Visual, Typst Source, and BibTeX Source. PDF is non-applicable.

Release requires:

1. **`CCC-01`** — LaTeX, Pandoc Markdown, and Typst citation forms resolve against every
   project bibliography declared or discovered by the engine.
2. **`CCC-02`** — BibTeX entry types, fields, braces/quotes, keys, duplicates, and
   incomplete/malformed entries are highlighted, cataloged, and linted with
   recoverable partial results.
3. **`CCC-03`** — Current keys and useful metadata appear in supported Source/Visual
   completion; duplicate keys are distinguished and missing keys diagnosed.
4. **`CCC-04`** — Bibliography and citing-file edits/moves invalidate affected diagnostics
   and completions, reject stale catalogs, and pass project-analysis budgets.

### 7.9 Spellchecking

**Feature ID:** `spellchecking`

**Applies to:** LaTeX and Markdown document prose in Source/Visual, and Typst
document prose in Source. PDF, LaTeX support implementation text, and BibTeX
field prose are non-applicable.

Release requires:

1. **`SPC-01`** — Every shipped paired dictionary passes load, known-word,
   known-misspelling, and suggestion smoke coverage; en-US is always present.
2. **`SPC-02`** — Engine markup, commands, URLs, code, citation syntax, math, and excluded
   comments are skipped without offset drift or false positives from masking.
3. **`SPC-03`** — Global/project ignore, un-ignore, suggestions, and diagnostic refresh work
   across Source and supported Visual surfaces.
4. **`SPC-04`** — Missing packs and load failures are visible; full-input worker results
   reject stale revisions, use no silent cutoff, and pass performance gates.

## 8. Acceptance evidence

The machine contract assigns one or more required evidence types to every
criterion. The vocabulary is:

| Evidence ID | Meaning |
| --- | --- |
| `unit` | Isolated logic and state behavior |
| `integration` | Behavior across production components or workers |
| `end-to-end` | User-visible behavior on a supported application surface |
| `fixture` | Deterministic representative-corpus coverage |
| `performance` | Measurement on the pinned reference hardware and methodology |

Phase 0 establishes this specification, a machine-readable mirror, and a
lightweight multi-engine corpus. The corpus must include:

- Valid LaTeX, Markdown, Typst, and BibTeX sources.
- Cross-file references, citations, and includes/imports.
- Incomplete and malformed source that must recover visibly.
- Deliberately misspelled and ungrammatical prose.
- Inline and display math.

Later phases add feature-specific unit/integration/end-to-end suites and the
reference-hardware performance harness. Each implementation phase must preserve
the machine contract and corpus validator. Missing evidence, an unmeasured
budget, a visible-failure violation, or any applicable failing criterion blocks
the 100% claim and release acceptance.
