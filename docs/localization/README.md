# Desktop Localization String Inventory

This directory contains the Phase 0 classified string inventory for the Oleafly
desktop product. It is a regenerable review baseline, not a translation
catalog or a frozen source snapshot.

The inventory covers production TypeScript and TSX in `src` and `packages`,
bundled template metadata and starter content, Rust and Tauri error boundaries,
desktop installer and update metadata, accessibility names, search keywords,
registries, settings, tours, diagnostics, and locale-sensitive formatters.

The public-site and remote template-pack repositories are deferred. Their
strings are not present in the tracked TSV or summary. Desktop code that
consumes template metadata and the template snapshots bundled with the desktop
application remain in scope.

## Artifacts

- [`string-inventory.tsv`](string-inventory.tsv) contains one row per detected
  occurrence or intentional file-level content boundary.
- [`string-inventory-summary.json`](string-inventory-summary.json) contains
  deterministic counts, file counts, the reviewed manifest hash, and a scanned
  source fingerprint.
- [`rust-error-boundaries.tsv`](rust-error-boundaries.tsv) contains every
  registered Tauri command, its current return contract, owner, planned error
  code status, and raw-detail policy.
- [`error-code-manifest.json`](error-code-manifest.json) is the reviewed,
  human-owned policy for semantic codes and temporary fallback code templates.
- [`../../scripts/localization-inventory.mjs`](../../scripts/localization-inventory.mjs)
  regenerates the machine-owned artifacts.

The TSV preview value is capped at 480 characters. The source file remains the
authority for the complete value. Backslashes and every C0 control character,
including NUL, are escaped inside fields so every record remains on one
physical TSV line.

## Snapshot

| Repository ID | Scanned files | Source SHA-256 |
| --- | ---: | --- |
| `desktop` | 545 | `5f4a6f681b5ee53f2d22fe22730eeebf4dfebdcfc76bcc9a19e7dd163dd9a53b` |

The source fingerprint covers the normalized path and bytes of every scanned
file in sorted order. Generated output deliberately excludes the clone's
origin URL and Git `HEAD`. Those values are not source identity, differ between
clones, and make a generated artifact stale as soon as its own commit changes
`HEAD`.

## Counts

The desktop inventory contains 26,454 occurrences.

| Classification | Count | Migration action |
| --- | ---: | --- |
| `translate` | 3,483 | Move Oleafly-owned desktop UI copy into the owning namespace |
| `structured-code-then-translate` | 1,030 | Replace prose identity with a stable code, then translate at presentation |
| `user-content` | 41 | Preserve source unchanged unless an explicit localized variant is published |
| `third-party/raw-diagnostic` | 1,896 | Preserve exact detail and add localized Oleafly framing when useful |
| `developer-only` | 18,647 | Keep out of catalogs |
| `channel-specific` | 1,357 | Localize through template metadata, installer, updater, or release workflows |

Counts are occurrence counts. Repeated English text in separate contexts stays
separate because it may need different grammar, ownership, or translator
context.

The 4.9 MB detail TSV is intentionally tracked. It is the reviewable evidence
behind source positions, ownership, classifications, and planned error codes.
It must not be edited by hand or used as a runtime catalog.

This baseline is regenerable. Source positions and counts are expected to move
when desktop source changes. Reviewed rules, the error-code manifest, source
regression assertions, and the source fingerprint preserve the audit contract.
`--check` is available for local or future CI use, but no current workflow runs
it. This document does not claim an active CI gate.

## Classification Rules

### `translate`

Use for Oleafly-owned desktop presentation copy. This includes React children,
headings, buttons, placeholders, tooltips, empty states, native menus,
accessibility names, settings display metadata, tours, command labels, command
groups, and localized command-search keywords.

Do not infer a shared key merely because two English values match.

### `structured-code-then-translate`

Use when prose currently acts as machine identity or crosses a process
boundary. The current inventory applies this to Tauri string errors, app-owned
error text, dynamic raw-error coercion that should become a product error, and
English category values that currently control desktop behavior.

The future code or ID is the stable identity. The localized sentence or label
is presentation.

### `user-content`

Use for starter LaTeX, Typst, Markdown, and BibTeX content, including source
embedded in desktop code. A UI locale change must not rewrite this content.
Localized starter documents require explicit variants with their own content
locale and QA.

### `third-party/raw-diagnostic`

Use for compiler output, Git output, upstream responses, external dataset
values, and exact runtime diagnostics. The raw value stays unchanged. A
localized heading, explanation, or recovery action may appear beside it.

### `developer-only`

Use for IDs, routes, Tauri command names, slash aliases, shortcuts, enum values,
storage keys, CSS tokens, URLs, protocol fields, AI tool protocol text, code
examples, logs, and automation strings.

### `channel-specific`

Use for bundled template display metadata, installer metadata, release notes,
and updater copy that does not belong in a normal desktop React namespace.

## Manual Review

The generator supplies deterministic candidate extraction. The following
high-risk rule groups were manually reviewed against their source surfaces.
This is category-level classification review, not final editorial review of
every sentence.

### Desktop UI and registries

- 66 registry rows cover command labels, command groups, hints, and rail labels
  in `src/contributions`.
- 9 localized search-keyword rows cover the current command keyword fields.
- Slash aliases and shortcut-only hints are developer-only. Three shortcut or
  slash hint occurrences were explicitly separated from translatable hints.
- 338 settings rows cover settings navigation, display metadata, and visible
  settings copy.
- 62 tour rows cover titles, labels, and content in the tour registry.
- 571 accessibility-rule rows cover `aria-label`, descriptions, titles,
  placeholders, and equivalent names.
- 31 formatter rows identify locale-sensitive number, date, time, and count
  formatting calls.

The inventory treats static visible names and labels as catalog candidates even
when the approved glossary later preserves a term such as LaTeX, BibTeX, DOI,
arXiv, GitHub, or SyncTeX.

Source-based regression assertions preserve the independently reviewed
classification cases:

- `Show compiled preview`, `Find and replace`, and `No results` are visible
  copy classified as `translate`.
- `GPT-4o`, `var(--destructive)`, and
  `pdf-metadata-extraction-failed` are stable model, style, and finding
  identities classified as `developer-only`.
- The `bg-white/15` CSS utility is excluded rather than inventoried as prose.
- Identity and protocol rules run before error heuristics, so an ID containing
  the word `failed` cannot become translated error copy.

### Error and diagnostic boundaries

All 134 `#[tauri::command]` functions registered by
`tauri::generate_handler!` are present in `rust-error-boundaries.tsv`.

- 121 registered commands currently return `Result<..., String>`.
- Every one of those 121 boundaries has a module owner and a command-derived
  code in the form `errors.<module>.<command>`.
- Every command-derived code is labeled `fallback-command`. It is a migration
  aid, not approved semantic API identity.
- No registered string error boundary lacks an owner or planned code.
- Thirteen registered commands do not use a string error contract.

Rust string review found:

- 675 app-owned string-error construction occurrences that need structured
  codes.
- 376 compiler, process, Git, network, or upstream diagnostic occurrences that
  must preserve raw detail.
- 13 native menu strings that belong to the desktop locale.
- 11 explicit log or invariant strings that remain developer-only.

Nested Rust helpers are assigned a module-level fallback code in the occurrence
inventory. The command boundary provides the unique transport code. During
migration, the command adapter must map helper failures to its command code or
to a more specific typed domain code.

The frontend scan also records 145 dynamic `String(error)` or `error.message`
flows. Of these, 88 need a structured product code and 57 sit on raw diagnostic
boundaries. This evidence is important because no static string-literal scan
can find those exposures.

Raw-detail policy is recorded per Tauri command:

- Compile, SyncTeX, LaTeX, Pandoc, Git diff, and Git show preserve exact tool
  detail with localized framing.
- Citation, literature, GitHub, Ollama, and template-pack network operations
  log upstream detail and show a localized service message.
- Other failures log the raw cause with a trace ID and show localized product
  copy.

### Error-code identity

[`error-code-manifest.json`](error-code-manifest.json) separates reviewed
semantic identity from temporary inventory fallbacks. The semantic entries are
`project.name_conflict` and `errors.common.unexpected`. Current inventory rows
use the following explicitly labeled fallback groups:

- 310 frontend surface fallbacks.
- 675 nested Rust module fallbacks.
- 435 raw-diagnostic wrapper fallbacks.
- 121 command-derived Tauri boundary fallbacks.

Fallbacks are derived from stable owners, modules, and commands. No code uses
an English-message hash. Migration must replace a fallback with a reviewed
domain code whenever distinct recovery behavior or parameters require one.

### Bundled templates and desktop consumers

The desktop bundle contains 23 template manifests and 25 starter source files.
The inventory also covers `src-tauri/resources/template-packs.json` and every
desktop TypeScript or Rust consumer found in the normal source scan.

- 365 bundled template names, labels, and descriptions are channel-specific
  metadata.
- 25 starter files are represented once per file as `user-content`.
- 16 additional embedded starter-source occurrences are `user-content`.
- 23 inline template author fields and 23 inline SPDX fields are inventoried
  as non-translatable attribution identity.
- 34 template category values currently act as English identity and are
  `structured-code-then-translate`.
- 11 desktop tool-category identity occurrences have the same classification.

Desktop template behavior currently checks display values such as
`category === "Diagrams & Figures"` and uses category text for grouping,
filtering, and search. A stable desktop-facing category ID must replace those
English values before localized labels ship.

### Bundled deadline data

The JSON scanner parses objects and arrays structurally rather than matching
one property per line. This covers both the minified
`src-tauri/resources/deadlines-seed.json` file and the formatted
`deadlines-extra.json` file with accurate value-token positions.

- The bundled seed contributes 4,431 string values.
- The supplemental file contributes 142 string values.
- Titles, full names, dates, places, and the curated note remain exact external
  data under `third-party/raw-diagnostic`.
- IDs, links, ranks, subjects, deadline kinds, timestamps, and time zones are
  developer or protocol data.

### Installer, updater, and release channels

The scan includes:

- Tauri `productName` and window title.
- The initial HTML document title.
- GitHub release name and user-facing download instructions.
- Changelog prose used by the GitHub release and updater.

Three installer or shell metadata rows and two release-workflow copy rows need
channel ownership. The remaining 62 release-workflow strings are automation.
Shell heredoc tokens such as `${name}<<OLEAFLY_SECRET_EOF`, `$value`, and the
delimiter are developer-only.

`src-tauri/tauri.conf.json` currently has no WiX language map, NSIS language
list, or NSIS language selector. macOS and Linux packaging expose no localized
metadata in the current config. These are distribution gaps, not desktop
catalog work.

The changelog contributes 987 channel-specific release-note rows. It remains
the release-note source rather than becoming part of the in-app UI catalog.

## Ownership

| Surface | Owner label in inventory | Required next contract |
| --- | --- | --- |
| Desktop shell and registries | `desktop-shell` | Runtime-resolved labels, groups, hints, and keywords |
| Settings | `desktop-settings` | `settings` namespace and locale preference |
| AI UI | `desktop-ai` | UI catalog separate from model and tool protocol text |
| Editor and WYSIWYG | `desktop-editor`, `desktop-wysiwyg` | Host translation plus structured diagnostics |
| Preview | `desktop-preview` | Host translation and raw PDF diagnostic framing |
| Preflight | `desktop-preflight` | Finding codes with translated presentation |
| Diagram | `desktop-diagram` | Framework-neutral host translation |
| Templates in desktop | `desktop-templates` | Stable metadata IDs and localized display values |
| Rust modules | `desktop-rust-*` | Typed codes, safe params, trace ID, and logged cause |
| Installer and releases | `release-engineering` | Per-channel locale checklist and packaging metadata |

Owner labels identify a product area, not a person. Phase 0 product decisions
must assign accountable people before migration begins.

## Deferred Repositories

The following repositories are deliberately outside this desktop-first
baseline:

- `Oleafly/oleafly-web`
- `Oleafly/template-packs`

Their files, revisions, counts, and recommendations are not included in the
generated artifacts. They require new inventories when their localization work
becomes active. The desktop inventory does not imply coverage of those products.

## Known Gaps and Exclusions

- Extraction is syntactic and deterministic. It does not replace runtime
  data-flow review, localization QA, or native-speaker editorial review.
- Tests, stories, imports, CSS class values, SVG path data, and generated build
  output are excluded from occurrence counts.
- Bundled starter source is represented once per file. This preserves the
  correct no-automatic-translation boundary without producing misleading
  per-token candidates.
- Dynamic user documents, filenames, citation keys, project names, and upstream
  values do not exist as static source strings. Their boundary is documented,
  but their runtime values are not counted.
- Remote template or deadline data not bundled in this repository is not
  included. Current committed desktop snapshots are included.
- CodeMirror, PDF.js, KaTeX, Tauri plugin dialogs, and other third-party package
  UI require a runtime capability audit. Dependency source strings are not
  copied into this repository inventory.
- OS permission prompts, installer UI supplied by packaging tools, store
  listings, screenshots, and support pages need channel-specific inventories
  when their desktop release sources are available.
- The scanner identifies 45 desktop display values that also serve as identity.
  Migration still needs a schema decision for each family.
- Classification does not assign final i18next namespaces or semantic keys.
  That happens during vertical-slice migration after the architecture decision.
- AI protocol strings are kept developer-only by rule. A later multilingual
  prompt design would require a separate inventory and evaluation.

## Regeneration and Validation

Regenerate from the desktop repository:

```bash
node scripts/localization-inventory.mjs
```

Run the built-in Node parser and source-regression assertions:

```bash
node scripts/localization-inventory.mjs --self-test
```

Verify that tracked artifacts match current desktop sources:

```bash
node scripts/localization-inventory.mjs --check
```

The check fails if any generated artifact differs, if a registered
`Result<..., String>` Tauri boundary lacks an owner or fallback status, or if
an inventory invariant fails. No repository workflow invokes this command yet.

The deterministic contract is:

1. Source paths are normalized relative to the desktop repository.
2. Directory traversal, rows, summary keys, and error boundaries are sorted.
3. No wall-clock timestamp is written.
4. Stable occurrence IDs derive from repository, path, kind, context, value,
   and duplicate ordinal. Unrelated line insertions do not change them.
5. Line and column remain review metadata and point to the source token.
6. The source fingerprint covers every scanned file in sorted path order.
7. The summary contains no clone remote or Git revision metadata.
8. The reviewed error-code manifest is recorded by content hash.

The scanner validates unique occurrence IDs, TSV column structure, escaped C0
controls, the absence of literal NUL, code-status coverage, the absence of
English-text code hashes, and source regressions for the reviewed high-risk
examples. Its Rust lexer covers cooked strings, escaped line continuations,
raw strings, byte strings, nested block comments, and line comments. Its JSON
parser covers minified and formatted objects and arrays.

The two TSV files and summary JSON are machine-owned and must be regenerated
through the script. The error-code manifest is human-owned and reviewed. None
of these files is a runtime translation catalog.
