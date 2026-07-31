# Desktop Localization Framework Bake-Off

## Decision

Keep `i18next` 26.3.6 with `react-i18next` 17.0.11 as the desktop
localization runtime.

The representative desktop slice found no runtime or package-boundary blocker
that justifies switching to Lingui 6. i18next passed strict selector typing,
package-owned namespace declarations, render-time registry resolution, live
language switching, and structured Rust error localization.

Lingui 6 produced the better translator catalog. Its PO files preserve
descriptions, source locations, semantic IDs, and named JSX placeholders.
That advantage does not currently outweigh its macro transform, catalog
compiler, package configuration, higher Node floor, and slower measured build
workflow.

This is a conditional confirmation of the existing i18next decision. The
Weblate context pilot remains a required gate before broad string migration.
It is not a blocker for the desktop runtime foundation.

## Scope

This bake-off covers the desktop React runtime, desktop workspace package
ownership, startup registries, and the Tauri-to-React product error contract.
It does not evaluate the public site, signed web application, server runtime,
or remote template catalog.

The experiment was built in an isolated worktree:

| Field | Value |
| --- | --- |
| Worktree | `/Users/prajwalsvenkatesh/Codespace/Oleafly/oleafly-desktop-localization-bakeoff` |
| Branch | `spike/localization-framework-bakeoff` |
| Base revision | `78796d1d8c24` |
| Spike revision | `2d48a5bc0` |
| Experiment root | `experiments/localization-bakeoff/` |
| Production dependency changes | None |

The verified spike is committed on its isolated branch. Production runtime and
dependency files remain unchanged.

## Representative Slice

Both implementations contain the same behavior and English and Spanish
catalogs.

| Boundary | Evidence |
| --- | --- |
| Settings | Language navigation item and description |
| Plural | Spanish `one`, `many`, and `other` forms, including a count of 1,000,000 |
| Rich JSX | One sentence with a named `docsLink` component |
| Startup registry | Command label, group, hint, and keywords resolved when rendered |
| Workspace package | Package-owned message and catalog |
| Rust boundary | Language-neutral error code, parameters, and trace ID localized by React |
| Document metadata | Live `<html lang>` and `dir` updates |

The Rust fixture emits this stable contract:

```json
{
  "error": {
    "code": "project.name_conflict",
    "params": {
      "name": "Thesis"
    },
    "traceId": "trace-bakeoff-001"
  }
}
```

Rust never emits localized prose in this path. React maps the stable code and
parameters to the active locale while preserving the trace ID.

## Pinned Environment

| Component | Version |
| --- | --- |
| Node | 22.22.0 |
| pnpm | 11.9.0 |
| TypeScript | 5.9.3 |
| React | 19.2.7 |
| Vite | 6.4.3 |
| Vitest | 4.1.9 |
| i18next | 26.3.6 |
| react-i18next | 17.0.11 |
| i18next CLI | 1.67.3 |
| Lingui packages | 6.6.0 |
| Serde | 1.0.229 |
| serde_json | 1.0.151 |
| Rust | 1.96.1 |
| Host | macOS 26.2, Apple silicon |

Lingui 6 requires Node 22.19 or newer on the Node 22 line. The current desktop
package range begins at Node 22.13. Adopting Lingui would therefore require a
repository engine-floor change even though the checked-in Node 22.22 runtime
already satisfies it.

## Implementation Findings

### i18next

- The desktop host creates one private i18next instance with `createInstance`.
- React mounts only after `init()` completes, which prevents a first-render
  language flash.
- `enableSelector: "strict"` is set in runtime and TypeScript configuration.
- Invalid selectors fail TypeScript. The spike includes an
  `@ts-expect-error` assertion that passes only when an unknown Settings key is
  rejected.
- `extract --ci` and `status` read the reviewed application and package
  catalogs directly. `verify` runs both commands, so an empty or missing
  Spanish target message exits with a failure instead of checking a disposable
  extraction directory.
- The application declares its namespaces through `ResourceNamespaceMap`.
- The workspace package augments `ResourceNamespaceMap` with its own
  `workspace` namespace. It receives the host instance and does not import an
  application singleton.
- The workspace package has an independent TypeScript project and an explicit
  strict-selector host contract. Both the application and package typechecks
  run during verification.
- Static command objects resolve their localized fields through `getFixedT`
  when the command is rendered. Switching language updates the command without
  rebuilding the registry.
- The CLI generated a correct `Resources` interface from the app and package
  English catalogs. The application module augmentation imports that generated
  declaration, so stale generated types fail `types --ci` and TypeScript
  instead of existing as unused evidence.
- Spanish contains every cardinal category reported by Node 22.22 CLDR:
  `one`, `many`, and `other`. The rendered `many` test uses 1,000,000.
- Bundled resources make initialization deterministic, but the initialization
  API remains asynchronous and must stay behind the desktop bootstrap gate.

### Lingui 6

- Vite needs the Lingui plugin and the React Babel macro transform.
- PO extraction and compilation are required parts of the build and test
  workflow.
- The app and workspace package each need catalog configuration and compiled
  catalog loading.
- `defineMessage` descriptors fit static registries well and resolve cleanly
  through the active Lingui instance.
- Bundled compiled catalogs allow synchronous initialization in this slice.
- Named JSX placeholders work through
  `macro.jsxPlaceholderAttribute: "_t"`.
- Extracted PO files preserve translator comments, source locations,
  placeholders, and semantic IDs.
- Spanish carries explicit `one`, `many`, and `other` ICU branches. Strict
  catalog compilation and the workspace-package typecheck run in verification.
- `lingui compile --typescript` emits TypeScript catalogs cast to the broad
  `Messages` type. It does not produce a literal message-ID union. Automatic
  strict ID typing would need a separate generated declaration or maintained
  augmentation.

## Behavior and Test Results

Both implementations passed the same three React tests:

1. Render every representative boundary in English, including the singular
   plural form, command group and hint, rich JSX, and document language
   attributes.
2. Switch to Spanish and update the singular and million-count plural forms,
   command metadata, rich JSX, workspace-owned text, document language
   attributes, and the structured product error without rebuilding the
   registry.
3. Render a safe localized fallback for an unknown structured product error
   code.

The i18next test factory awaits initialization. The Lingui test factory is
synchronous after catalog compilation. Both use the framework provider and
exercise the rendered UI rather than calling translation functions in
isolation.

The Rust crate passed three contract tests. The envelope derives Serde
serialization, maps `trace_id` to `traceId`, and proves that quotes, newlines,
and backslashes in untrusted parameters are escaped as valid JSON. Its emitted
output is compared byte for byte with the expected fixture and both TypeScript
fixtures. The shared fixture check runs from each framework's `verify` command.

Final verification:

The hardened commands were repeated on 2026-07-31 after restoring the
isolated spike. Catalog checks, generated types, tests, builds, and Rust
fixtures all passed without changing any saved source file.

| Implementation | Extraction | Type check | React tests | Production build |
| --- | --- | --- | --- | --- |
| i18next | Reviewed catalogs passed `extract --ci`, Spanish status was 12 of 12, with the rich-message caveat below | Application and workspace package passed | 3 of 3 | Passed |
| Lingui 6 | Passed, 11 messages and 0 Spanish missing, then compiled in strict mode | Application and workspace package passed | 3 of 3 | Passed |
| Rust contract | Both frontend fixtures matched emitted JSON | Passed through Rust compiler | 3 of 3 Rust tests | Passed |

## Build Measurements

These numbers come from the isolated representative applications. Both builds
include React and the same product slice. They are useful for comparing the
two implementations, not for predicting the final Oleafly application size.

### Browser JavaScript

Vite production builds include source maps. Gzip values below use `gzip -9`
against the final JavaScript asset.

| Implementation | Modules | JavaScript | Gzip | Source map |
| --- | ---: | ---: | ---: | ---: |
| i18next | 76 | 262,157 bytes | 83,403 bytes | 1,143,849 bytes |
| Lingui 6 | 61 | 208,169 bytes | 65,691 bytes | 966,495 bytes |
| i18next difference | +15 | +53,988 bytes | +17,712 bytes | +177,354 bytes |

Lingui produced the smaller browser bundle in this slice. That result is kept
separate from install footprint and build workflow cost.

### Warm Production Workflow

Each framework was built five times sequentially. The i18next command runs
TypeScript and Vite. The Lingui command runs catalog compilation, TypeScript,
and Vite because compilation is required for its production workflow.

| Implementation | Runs in seconds | Mean | Median | Median maximum RSS |
| --- | --- | ---: | ---: | ---: |
| i18next | 2.17, 2.09, 2.07, 2.21, 2.09 | 2.126 s | 2.09 s | 305.0 MiB |
| Lingui 6 | 3.02, 3.09, 2.98, 2.95, 3.03 | 3.014 s | 3.02 s | 424.3 MiB |

The measured Lingui workflow was 41.8 percent slower by mean and 44.5 percent
slower by median. This is a workflow comparison, not a claim about runtime
translation speed.

### Local Install Footprint

Both workspaces used the same pnpm store on the same host.

| Implementation | `node_modules` | pnpm package directories | Files | Lockfile |
| --- | ---: | ---: | ---: | ---: |
| i18next | 151,872 KiB | 245 | 7,591 | 95,617 bytes |
| Lingui 6 | 117,860 KiB | 232 | 6,734 | 85,480 bytes |

i18next used 34,012 KiB more local install space in this experiment. This
does not affect the shipped desktop JavaScript measurement above.

## Catalog and TMS Findings

Lingui is the clear catalog-quality winner before a TMS is involved. Its PO
output carries comments such as the purpose of the command hint, the source
location, the semantic ID, and the named `docsLink` placeholder in one
reviewable file.

i18next JSON is simpler and matched the intended desktop runtime model. A
local validation confirmed that English and Spanish have the same semantic
message set and identical interpolation and rich-tag contracts. Plural
branches follow each locale's CLDR categories rather than requiring identical
suffix sets. Plain JSON does not carry translator descriptions, source
origins, or screenshots by itself. Those must be supplied and preserved by
Weblate.

No hosted Weblate project was available to this isolated bake-off, so a true
TMS import, review, export, and reimport cycle was not claimed. Before broad
migration, the Weblate pilot must prove all of the following:

- Nested i18next JSON exports and reimports without key drift.
- Translator explanations remain attached to the correct keys.
- Screenshots remain attached and usable during review.
- Placeholder and named-component checks reject unsafe translations.
- Backup and restore preserve translations and context.

Failure of that pilot is a real decision-reopen condition. It is not evidence
today that Lingui's compiler and macro integration should replace the selected
desktop runtime.

## Known i18next CLI Caveat

With i18next 26.3.6, react-i18next 17.0.11, and i18next CLI 1.67.3, direct
strict selectors, `getFixedT` selectors, plural selectors, and the
package-owned namespace extracted into the expected namespace files.

The CLI did not normalize the leading namespace segment for a strict selector
inside React `<Trans>`. The authored runtime key is
`common:legal.readGuide`, while extraction produced
`common:common.legal.readGuide`. Runtime typing and rendering remain correct
because generated types use the authored JSON catalog rather than this
extraction output.

The repaired verification workflow does not claim this is fixed. Reviewed
catalog extraction disables `<Trans>` discovery and preserves the authored
`common:legal.readGuide` key. Runtime typing and the live English-to-Spanish
component test still cover the rich message. This prevents the CLI from writing
the known duplicated path into reviewed catalogs, but it also means rich
messages need the dedicated extractor contract planned for Phase 1.

Phase 1 should continue to contain this issue with the following controls:

1. Pin the validated i18next and CLI versions.
2. Keep reviewed JSON catalogs as the source of truth.
3. Add an extractor contract fixture that fails on a repeated namespace
   prefix.
4. Do not merge rich-message extraction output until the CLI supports strict
   `<Trans>` normalization or the project adopts one documented,
   type-checked rich-message convention.
5. Re-evaluate Lingui only if safe rich-message extraction still requires
   recurring manual catalog repair.

This is a narrow extraction-tool issue. It is not a desktop runtime blocker
and the spike does not hide it behind a custom transform.

## Acceptance Decision

Proceed with the planned i18next desktop foundation.

| Acceptance item | Result |
| --- | --- |
| Strict typed selectors | Pass |
| Package declarations | Pass |
| Static registry resolution | Pass |
| Startup and live switching | Pass |
| Structured Rust errors | Pass |
| Type generation | Pass |
| General extraction | Pass |
| Strict `<Trans>` extraction | Known narrow issue with a Phase 1 guard |
| TMS context | Weblate pilot still required before broad migration |

Do not switch to Lingui now. Reopen the framework choice only if the Weblate
pilot cannot retain usable context or the strict `<Trans>` extraction guard
cannot be closed without ongoing manual repair.

## Reproduction

From the isolated experiment root:

```bash
nvm use 22.22.0

pnpm --dir i18next verify
pnpm --dir lingui verify

cargo test --manifest-path rust-error/Cargo.toml
cargo run --quiet --manifest-path rust-error/Cargo.toml

node scripts/benchmark.mjs --runs 5 --output benchmark-results.json
```

The spike artifact `benchmark-results.json` contains every raw timing and
maximum-RSS value, the exact command, environment versions, bundle
measurements, and install measurements. The benchmark script uses
`/usr/bin/time -lp` around each framework's `pnpm build` command. Bundle sizes
come from the built asset and `gzip -9 -c`. Install footprint comes from
`du -sk` and direct counts under each isolated `node_modules` directory.

## Official References

- [i18next TypeScript guidance](https://www.i18next.com/overview/typescript)
- [i18next namespaces](https://www.i18next.com/principles/namespaces)
- [Official i18next CLI](https://github.com/i18next/i18next-cli)
- [react-i18next Trans component](https://react.i18next.com/latest/trans-component)
- [Lingui 6 announcement](https://lingui.dev/blog/2026/04/22/announcing-lingui-6.0)
- [Lingui 6 migration guide](https://lingui.dev/releases/migration-6)
- [Lingui Vite integration](https://lingui.dev/installation)
- [Lingui PO catalog format](https://lingui.dev/ref/catalog-formats)
- [Weblate i18next JSON format](https://docs.weblate.org/en/latest/formats/json.html#i18next-json-files)
