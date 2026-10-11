# Development

What you need to work on Oleafly. The app is a [Tauri 2](https://tauri.app) project: a React + TypeScript + Vite frontend that talks over IPC to a Rust backend. Rust selects a compiler through the `DocumentEngine` interface. LaTeX, Typst, and Markdown use shipped CLI sidecars. Markdown runs the bundled Pandoc executable with the bundled Tectonic executable as its PDF engine.

## Repo layout

```
oleafly-desktop/
├── crates/
│   ├── oleafly-core/       shared Rust project, path, and build-directory policy
│   ├── oleafly-cli/        oleafly commands and native compiler adapter
│   ├── oleafly-agent/      provider-neutral agent runtime
│   └── oleafly-history/    content-addressed compile checkpoints
├── src/                    React app shell (stores, Tauri client, UI kit, port adapters)
│   ├── components/         ui (shadcn-style), layout, editor glue, preview panes, ai
│   ├── contributions/      registers rail tabs / commands / AI toolsets into the registry
│   ├── features/           export, import, synctex, citations, converters
│   ├── lib/                tauri wrappers, github, spellcheck, utils, package shims
│   └── store/              zustand stores
├── packages/               @oleafly/* engine packages (consumed as TS source)
│   ├── latex/  latex-intelligence/  ai-core/  ai-tools/  registry/  preflight/
│   ├── editor/  wysiwyg/  preview/  diagram/  templates/  search-query/
│   └── backend-port/  conversion-registry/  i18n-contract/  pdf-to-latex/
├── src-tauri/
│   ├── src/                rust: commands, DocumentEngine, config, git, paths, project, synctex
│   ├── binaries/           target-suffixed compiler sidecars
│   ├── resources/          templates, licenses, and pinned runtime archives
│   └── tauri.conf.json
├── scripts/fetch-tectonic.sh
├── scripts/fetch-biber.sh
├── scripts/fetch-pandoc.sh
├── scripts/fetch-typst.sh
├── scripts/fetch-language-servers.mjs
└── docs/
```

The frontend is a pnpm workspace: feature engines live in `packages/*` behind
injected ports, and the app shell wires them together. Read
[Architecture](architecture.md) before touching `packages/`: it
covers the port pattern, the contribution registry, and the alias wiring.

## Prerequisites

- Node.js 22.13+ and pnpm 11.9+ (the exact pnpm version is declared in
  `package.json`)
- Rust via [rustup](https://rustup.rs). The version is pinned in
  `rust-toolchain.toml`, and rustup installs it the first time you run `cargo`
  inside the repo.
- [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS
- No system document engines are required. The setup scripts stage the same pinned Tectonic, Biber, Pandoc, and Typst binaries shipped with Oleafly.

## First run

```bash
pnpm install
host_target="$(rustc -vV | sed -n 's/^host: //p')"
./scripts/fetch-tectonic.sh "$host_target"
./scripts/fetch-biber.sh "$host_target" # pinned Biber 2.17
./scripts/fetch-pandoc.sh "$host_target"
./scripts/fetch-typst.sh "$host_target"
node scripts/stage-windows-vcruntime.mjs # Windows only
pnpm tauri dev
```

On Windows, `stage-windows-vcruntime.mjs` copies Microsoft's
`vcruntime140.dll` into `src-tauri/binaries/`. Typst and TexLab need it and
Windows doesn't include it, so Oleafly installs it next to `Oleafly.exe`. The
script takes the copy from Visual Studio Build Tools, or from `System32` when
that's the only one, and refuses any file Microsoft didn't sign. Windows builds
fail until it has run.

The sidecar scripts fetch only the current host for day-to-day development.
Pass `all` only when preparing every supported target for CI or release work.

TexLab and Tinymist use the separate checksum-pinned language-server fetcher.
Run `pnpm language-servers:fetch` when you need that optional editor
intelligence. Its default installs TexLab under the current user's app-data directory as an
explicit development setup action and stages Tinymist's exact upstream archive
as a Tauri resource. Neither language server is an `externalBin`: TexLab's
GPL object-distribution checklist awaits a
separate maintainer decision, and normal Tauri release builds neither require
nor package it. The app's first-run path must display the pinned license/source
and wait for user consent before downloading. See
[Language-server toolchain](language-server-toolchain.md). `pnpm build` does
not fetch or require any sidecar.

## Day-to-day

```bash
pnpm tauri dev          # run the app with hot reload (frontend) + cargo incremental (backend)
pnpm build              # typecheck + build the frontend (tsc -b && vite build)
pnpm tauri build        # produce a distributable bundle
```

The command-line adapter ships inside the desktop app but has no standalone
package yet. Run it from the workspace. Cargo builds it as `oleaflyc`, because the desktop package already owns the
name `oleafly` in this workspace. Help, completions, the manual and release
archives all call it `oleafly`:

```bash
cargo run -p oleafly-cli --bin oleaflyc -- --help
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

`oleafly` works on the current directory unless you pass `-C <path>`. It also
has `watch`, `clean`, and `doctor`. Output is human-readable by default.
`--json` switches to structured output, and watch mode prints newline-delimited
JSON events. Build and watch kill a compiler after 300 seconds unless you pass
`--timeout <seconds>`. The CLI never turns on TeX shell escape. Only the
desktop can, and only through its device-local trust prompt for the system TeX
engine.

`oleafly open [path]` hands a folder to the desktop app, and `oleafly .` is
short for it. A bare `.` or `..`, or an argument with a path separator, opens
that folder. Anything else is still read as a command, so a folder named
`build` opens with `oleafly ./build` or `oleafly open build`. On macOS the CLI
asks Launch Services for the app, and prefers the bundle it ships inside. On
Windows it reads the install folder from the registry. On Linux it starts
`oleafly-desktop`: the desktop binary has that name on Linux so the CLI can own
`oleafly`. Set `OLEAFLY_APP` to a `.app` bundle or an app executable to open a
development build instead.

The .deb and .rpm packages also install `/usr/bin/oleafly`. It's a short
script: with arguments it runs `oleafly-cli`, and with none it starts the app.
Older packages put the app itself at that path, and an older copy that installs
an update restarts through it, so the script has to stay.

The desktop app carries the CLI as a second binary, `oleafly-cli`, next to its
own executable. Settings can link it into `~/.local/bin` as `oleafly`, or into
`/usr/local/bin` on a Mac where you can write to that folder. An AppImage gets
a copy instead of a link, because its files vanish when it quits.

The CLI does not bundle compilers. `doctor` lists the ones the project's
engine needs, and when one is missing it prints an install command for the
current platform. If you add an engine tool, give it a hint in
`install_hint` next to the others. A test fails when a tool has none.

`completions <shell>` prints a shell completion script and `man` prints a
roff manual page. Both are generated from the clap parser, so new flags show
up in them without anyone editing them by hand. Packagers can take them
straight from the built binary.

The interface is not stable before 1.0.0. Any release may add, rename or
remove JSON fields and change exit codes. `--help` says this too, since the
people who depend on the output are usually scripting against it.

### Checks before opening a PR

Make sure these pass:

```bash
pnpm lint                                 # Biome lint over src/ and packages/
pnpm build                                # frontend typecheck (noUnusedLocals/Parameters on)
pnpm test                                 # vitest across src/ and packages/
pnpm language-servers:test                # manifest, checksum, target, URL, and license policy
pnpm audit --prod --audit-level high      # registry-backed npm advisory check
cargo check --workspace                   # all Rust crates compile
cargo fmt --all -- --check                # Rust formatting
cargo clippy --workspace --all-targets -- -D warnings  # Rust lints, as CI runs them
cargo test -p oleafly-core -p oleafly-cli --all-targets  # shared core and CLI
cargo deny --workspace --all-features --config src-tauri/deny.toml check  # Rust advisories, licenses, and sources
```

The two audit commands require registry/network access. CI records their
current results on every code change. An offline local run cannot certify that
the dependency graph is advisory-free.

CI also runs `pnpm test:coverage`, which fails if frontend coverage drops below
the thresholds in `vitest.config.ts` (98% of lines, 92% of branches, 96% of
functions and statements). New code needs tests that keep it there. SonarCloud
counts the same files: `src/` and `packages/`, without tests, `tests/` folders,
the `src/main.tsx` bootstrap and the e2e-only probes.

### The Rust toolchain pin

`rust-toolchain.toml` names one Rust version. rustup applies it to every plain
`cargo` call in the repo, so the pre-commit hook, CI, the e2e builds, and the
release workflow all compile and lint with the same compiler. Before the pin,
CI floated on the latest stable while local machines stayed wherever they
were, and a commit could pass clippy locally and then fail it on CI with no
code change behind the break.

To move to a newer Rust:

1. Change `channel` in `rust-toolchain.toml` to an exact version, for example
   `1.99.0`. CI rejects `stable` and version ranges on purpose.
2. Run `cargo fmt --all -- --check`,
   `cargo clippy --workspace --all-targets -- -D warnings`, and
   `cargo test --workspace --all-targets`. rustup downloads the new version on
   the first call.
3. Fix what the newer clippy reports in the same pull request, so the bump
   lands green.

The 1.87 minimum for `oleafly-core` and `oleaflyc` is a separate promise. CI
checks it with an explicit `cargo +1.87.0`, which takes priority over the pin.

For user-facing changes, also run the end-to-end suite (real app and real
compiles, see [e2e/README.md](../e2e/README.md)):

```bash
pnpm test:e2e:app                         # builds + launches the app, runs Playwright, tears down
```

## How a compile works

1. The frontend loads the backend `project_engine` descriptor and its capability flags, then calls `compileProject(projectId, mainDoc, offline)` through Tauri IPC.
2. `oleafly-core` validates the workspace, resolves the source inside the project root, and prepares the isolated build directory.
3. The desktop adapter dispatches through `DocumentEngine`. UI code must not infer engine behavior from a filename. The `oleafly` adapter invokes its native compiler runner through the same shared workspace policy.
4. The desktop LaTeX adapter writes `_oleafly_entry.tex` and invokes Tectonic with `--synctex --keep-logs --print` and, when requested, `--only-cached`. The CLI invokes the selected source directly and normalizes its PDF output to `_oleafly_entry.pdf`.
5. Typst invokes the pinned Typst CLI directly against the selected `.typ` main document with short diagnostics and an explicit PDF output path.
6. Markdown invokes Pandoc directly against `.md`/`.markdown`, with an explicit
   output path and `--pdf-engine=<absolute bundled Tectonic path>`. Pandoc's
   manual explicitly supports a full PDF-engine path. Do not replace this with
   an implicit system `pdflatex`, since packaged Oleafly must not depend on an
   undeclared TeX installation. The process runs with the project root as its
   working directory so relative images, bibliography files, and CSL files work
   for both root and nested main documents.

Tauri's [sidecar documentation](https://v2.tauri.app/develop/sidecar/) defines
`bundle.externalBin` inputs with target-triple suffixes and exposes the packaged
sidecar under its unsuffixed name at runtime. Oleafly resolves both Pandoc and
Tectonic beside the application executable, matching Tauri's desktop bundle
layout. Unit tests cover macOS app-bundle and Cargo debug/release candidates,
while the release workflow checks every staged sidecar on every target.

Tectonic 0.17.0 release archives are checksum-pinned from the official GitHub
Releases API `digest` fields. `scripts/fetch-tectonic.sh` verifies SHA256 before
extracting exactly the root `tectonic`/`tectonic.exe` regular-file member. The
same script is used by CI and every release target, including Windows.

Pandoc 3.9.0.2 follows the same policy. `scripts/fetch-pandoc.sh` verifies the
release archive before extracting only the expected executable. The app still
recognizes a compatible system or previously managed Pandoc as a development
fallback, but release builds use the bundled copy and do not download a runtime
when a conversion starts.

TexLab 5.26.0 and Tinymist 0.15.8 have a separate machine-readable manifest,
secure Node fetcher, and distribution policy. Neither language server is a
Tauri `externalBin`. TexLab resolves from its consent-gated, checksum-pinned
app-local-data installation. Tinymist's target-specific upstream archive is a
Tauri resource. Rust verifies and extracts it atomically into the same
versioned app-local-data layout on first use. Keeping the archive immutable is
important because macOS and Windows signing may modify executable bytes. See
[Language-server toolchain](language-server-toolchain.md) for the target
matrix, integrity checks, CLI modes, and license obligations.
7. All engines stream normalized log/error events. Rust returns compile metadata through JSON IPC. The PDF itself is fetched separately as raw binary IPC rather than embedded as base64 in the result.
8. The frontend renders PDF bytes with pdf.js and publishes normalized diagnostics to CodeMirror.

Engine descriptors model compilation policy plus formatting/source-preflight
profiles and feature/export/template-kind sets. Frontend consumers use the
fail-closed files-store descriptor rather than guessing from extensions. See
the [document engine matrix](document-engines.md).

Typst reports `supports_synctex=true` and `supports_offline=true`, so source
and PDF sync (through Tinymist) and the offline compiler toggle work for Typst
projects. It reports `supports_isolated_compile=false`: its figure tools render
CeTZ or fletcher as Typst snippets instead of compiling an isolated LaTeX
document. Add engine-specific behaviour only once the backend capability says
so. Do not add extension-based UI exceptions.

## Where state lives

Oleafly stores app-managed state beneath the user's `~/.oleafly/` directory.
The application keeps preferences separate from owner-only encrypted
credentials. Do not copy, publish, or commit files from this directory. The
directory also contains project folders (each with its own `.git` repository)
and the application log. Exact credential filenames and key material are
intentionally omitted from public documentation.

## Key extension points

- Add an AI provider → `crates/oleafly-agent/src/provider.rs` (`CATALOG` + `wire_for`), and mirror the display entry in `packages/ai-core/src/providers.ts` (`PROVIDERS`). OpenAI-compatible providers just need a `base_url`, since routing collapses to four wire formats.
- Add a Tauri command → declare in `src-tauri/src/*.rs`, register in `src-tauri/src/lib.rs`, wrap in `src/lib/tauri.ts`.
- Add a document engine → implement `DocumentEngine` in `src-tauri/src/document_engine.rs`, expose truthful capabilities, add a checksum-pinned sidecar fetch/smoke path, then consume the descriptor in UI controls.
- Add a project template → drop a folder with a `template.json` manifest into `src-tauri/resources/templates/` (its `engine` field selects LaTeX, Typst, or Markdown).
- Add a Tools gallery entry → register the destination and slash aliases in `src/lib/tool-catalog.ts`, add its localized name, description, and tags in `src/i18n/locales/en/researchTools.json`, then update the catalog and gallery tests.
- Add a tool for the AI → `packages/ai-tools/src/tools.ts`. App services it needs go through `AiToolsHost` (adapter in `src/lib/ai-tools.ts`).
- Add a rail tab / palette or omnibar command / AI toolset → register it in `src/contributions/` (see [Architecture](architecture.md#extension-model)).

## Sync and GitHub internals

OAuth device flow runs server-side in Rust (`src-tauri/src/github.rs`) because the OAuth endpoints aren't CORS-enabled. Authenticated API calls (api.github.com) also run in Rust, so the token never reaches the webview.

## Coding style

- TypeScript: follow what's already there. No comments unless asked. Respect `noUnusedLocals`/`noUnusedParameters`.
- Rust: idiomatic, small commands, friendly error strings.
- UI: Tailwind v4 + Geist tokens. Reuse the `Button`/`Tooltip`/`Select` primitives.
- User-facing copy: prefer short sentences. Do not use em dashes or semicolons
  in labels, status text, errors, accessibility text, tool descriptions, or AI
  prompts. Syntax examples and source-language snippets are exempt.

## Releasing

Packaging targets macOS Apple Silicon, Windows x64, Linux x64, and Linux ARM64.
Each target gets matching Tectonic, Biber, Pandoc, Typst, and language-server
resources that are fetched and smoke-tested in CI. Linux ARM64 gets a stub in
place of Biber, because upstream publishes no 2.17 build for it. A tag produces
a complete draft. Publishing is a separate manual workflow run, and it refuses
to publish unless every platform's artifacts are present. See
[Auto-updates](updates.md) for required secrets, signing, and publication.
