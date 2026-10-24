# Development

What you need to work on Oleafly. The app is a [Tauri 2](https://tauri.app) project: a React + TypeScript + Vite frontend that talks over IPC to a Rust backend. Rust selects a compiler through the `DocumentEngine` interface. LaTeX, Typst, and Markdown use shipped CLI sidecars. Markdown runs the bundled Pandoc executable with the bundled Tectonic executable as its PDF engine.

## Repo layout

```
oleafly-desktop/
├── crates/
│   ├── oleafly-core/       shared Rust project, path, and build-directory policy
│   ├── oleafly-cli/        oleafly commands and native compiler adapter
│   ├── oleafly-agent/      provider-neutral agent runtime
│   ├── oleafly-history/    content-addressed compile checkpoints
│   ├── oleafly-collab-protocol/  messages shared by the app and the collaboration server
│   ├── oleafly-collab/     live collaboration client: shared project document, sync and comments
│   └── oleafly-server/     the collaboration server (Axum and SQLite)
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

The minimum Rust versions are separate promises. The shared crates
(`oleafly-core`, `oleafly-secrets`, `oleafly-doctools`, `oleafly-downloads`,
`oleafly-sandbox`, `oleafly-forge`) build on Rust 1.87. `oleafly-preflight` and
`oleafly-research` need 1.88 because they read PDFs with lopdf 0.42, which uses
let chains (it declares 1.85, which is too low); research gets it through
pdf-extract. `oleafly-lint` builds on 1.88 without its `proofread` feature.
`oleafly-online` needs 1.89 for the `aes` crate that decrypts copied browser
cookies, and `oleaflyc` needs 1.89 because it links the collaboration client.
CI checks each group with explicit `cargo +1.87.0`, `cargo +1.88.0` and
`cargo +1.89.0` runs, which take priority over the pin.

Spelling and grammar in `oleafly lint` use harper-core behind the CLI's
`proofread` feature, which release builds and the app turn on. harper-core's
dependencies need Rust 1.90, so those builds do too. After changing a preflight
rule, a linter or a prose mask, regenerate the CLI golden files with
`OLEAFLY_WRITE_GOLDENS=1 pnpm vitest run src/lib/cli-goldens`.

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

## Git hosting internals

Sign-in and every Git hosting API call run in Rust (`src-tauri/src/forge/` and `crates/oleafly-forge/`). The OAuth endpoints aren't CORS-enabled, and tokens never reach the webview. Git gets a token only through environment variables read by a credential helper scoped to that account's server address.

## Live collaboration load tests

The crowd tests in `crates/oleafly-collab/tests/crowd` run scripted typists
against a real Oleafly Server. `ten_people_typing_at_once_end_with_identical_documents`
runs with the normal test suite. The `stress_` tests are ignored by default and
need a release build:

```bash
cargo test --release -p oleafly-collab --test crowd -- --ignored --nocapture stress_
```

### The soak test

`soak_twenty_people_over_fifty_files` starts the server binary as its own
process, so its memory and CPU are measured apart from the clients. Twenty
scripted people type into a project of 50 files. Four of them reach the server
through a proxy that refuses WebSockets, so they stay on the long-poll fallback
for the whole run. Every two minutes one person loses the network for a few
seconds, and every minute someone adds a 64 KB figure.

It prints a progress line every minute. The summary at the end has:

- how long an edit takes to reach the others over a socket and over long-poll
  (p50, p95 and p99, counted while both people are online),
- how long the server takes to acknowledge an edit,
- reconnects, and how long people took to come back after a cut,
- the server's memory and CPU,
- how fast the database, snapshots and files grow,
- whether every copy of the project ended identical.

Build the server first. The test looks for `oleafly-server` next to its own
build output, so use the same profile and target folder:

```bash
cargo build --release -p oleafly-server
CROWD_SOAK_MINUTES=10 cargo test --release -p oleafly-collab --test crowd soak -- --ignored --nocapture
```

Every setting is optional:

| Variable | Default | What it does |
| --- | --- | --- |
| `CROWD_SOAK_MINUTES` | `10` | How long people type. Decimals work. |
| `CROWD_SOAK_PEOPLE` | `20` | People in the project, the owner included. |
| `CROWD_SOAK_FILES` | `50` | Text files in the project. |
| `CROWD_SOAK_LONG_POLL` | `4` | People behind the proxy that refuses WebSockets. |
| `CROWD_SOAK_PAUSE_MS` | `150,900` | Shortest and longest pause between keystrokes. |
| `CROWD_SOAK_REPORT_SECONDS` | `60` | Time between progress lines. |
| `CROWD_SOAK_CUT_SECONDS` | `120` | Time between network cuts. `0` turns cuts off. |
| `CROWD_SOAK_CUT_FOR_MS` | `3000,12000` | Shortest and longest cut. |
| `CROWD_SOAK_FIGURE_SECONDS` | `60` | Time between added figures. `0` turns figures off. |
| `CROWD_SOAK_FIGURE_KB` | `64` | Size of each figure. |
| `CROWD_SOAK_MAX_CHARS` | `30000` | A file longer than this gets deletes instead of inserts, so documents stop growing. |
| `CROWD_SOAK_DATA` | a temporary folder | Keeps the server's data folder and `server.log` here. |
| `CROWD_SERVER_BIN` | next to the test | Path to another server binary. |
| `CROWD_SEED` | fixed | Seed for the typists. |

### Running the 30-day soak

A month-long run needs a machine that stays awake and a slower pace, so the
documents and the update log grow at the rate of real writing rather than the
burst rate of the short run. On macOS:

```bash
cargo build --release -p oleafly-server
mkdir -p "$HOME/oleafly-soak"
CROWD_SOAK_MINUTES=43200 \
CROWD_SOAK_PAUSE_MS=1500,9000 \
CROWD_SOAK_REPORT_SECONDS=900 \
CROWD_SOAK_CUT_SECONDS=1800 \
CROWD_SOAK_FIGURE_SECONDS=1800 \
CROWD_SOAK_DATA="$HOME/oleafly-soak/data" \
caffeinate -dimsu cargo test --release -p oleafly-collab --test crowd soak -- --ignored --nocapture \
  > "$HOME/oleafly-soak/soak.log" 2>&1 &
```

On Linux, leave out `caffeinate -dimsu` and start it with `nohup` or inside
tmux.

Read `soak.log` once a day:

- The server's RSS should level off after the first hour. A trend that keeps
  rising is a leak.
- The database should level off too. Every 1,000 changes a client asks the
  server to build a snapshot, and the server builds it itself from the
  previous one. It keeps at least the last 2,000 updates, so the update log
  stays a few thousand rows long. The blob store holds a few snapshots per
  project under `blobs/snapshots/` (or the bucket's `snapshots/` prefix).
- Files grow by the figures added and nothing else.
- p95 and p99 should stay where they were on the first day.
- Reconnects should match the number of network cuts, and the problems count
  should stay at 0.

When the run ends, the summary and the test result are at the end of the log.
If it fails, read `server.log` in the data folder.

The test process holds every person's copy of the project, so its own memory
grows with the documents. `CROWD_SOAK_MAX_CHARS` keeps that bounded.

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

### Releasing Oleafly Server

Server releases have their own tags, `server-v<version>`, and their own
workflow, `.github/workflows/release-server.yml`. The installer and
`https://oleafly.com/server/install.sh` download releases from
[Oleafly/oleafly-server](https://github.com/Oleafly/oleafly-server), not from
this repository, so a release reaches people only once it is copied there.

Once, before the first release, add the `OLEAFLY_SERVER_SYNC_TOKEN` secret to
this repository under **Settings › Secrets and variables › Actions**. Make it a
fine-grained personal access token owned by the Oleafly organization, with
access to Oleafly/oleafly-server only and the Actions permission set to read
and write. Without it, publishing a release fails at the copy, and the
installer keeps offering the previous release.

Do the steps in this order:

1. Set `version` in `crates/oleafly-server/Cargo.toml` and merge. Push the tag
   on the merge commit, such as
   `git tag server-v0.1.0 <merge commit> && git push origin server-v0.1.0`.
   The workflow refuses a tag that doesn't match the crate.
2. Wait for **Release server**. It pushes
   `ghcr.io/oleafly/oleafly-server:<version>`, checks that anyone can pull it,
   and creates a draft release here with the installer files.
3. On the first release, the **Draft release** job stops with "can't be pulled
   without signing in", because new packages on GitHub's registry start
   private. Make the `oleafly-server` package public in the organization's
   package settings, re-run the job, and check with
   `docker logout ghcr.io && docker pull ghcr.io/oleafly/oleafly-server:<version>`.
4. Try the draft on a fresh Linux machine with a domain pointing at it:

   ```sh
   gh release download server-v0.1.0 --repo Oleafly/Oleafly --dir rel
   sudo OLEAFLY_RELEASE_URL="file://$PWD/rel" sh rel/install.sh
   ```

5. Publish the draft with **Set as the latest release** unticked, or run
   `gh release edit server-v<version> --repo Oleafly/Oleafly --draft=false --latest=false`.
   Desktop and server releases share this repository. The desktop app's
   updater and the download links read its latest release, so the latest
   release has to stay a desktop one with `latest.json`. If the label lands on
   the server release anyway, the workflow moves it back to the newest desktop
   release.
   The workflow then moves the image's minor tag, such as
   `:0.1`, and `:latest`, which Coolify, Render and Railway follow. It also
   starts `sync-release.yml` in Oleafly/oleafly-server, which copies the
   release there, and waits until the copy answers. That needs the
   `OLEAFLY_SERVER_SYNC_TOKEN` secret: a fine-grained token with read and write
   access to Actions on Oleafly/oleafly-server and nothing else.
6. On the first release only, point the website at it. Until then,
   `https://oleafly.com/server/install.sh` serves a placeholder that says
   where the release will appear and exits 1, and two pages say the release
   is on its way. In Oleafly/oleafly-web, delete `public/server/install.sh`,
   remove the `# ` in front of the `/server/install.sh` line in
   `public/_redirects`, delete the "The first release is on its way" note in
   `src/content/docs/docs/collaboration/server.mdx`, and set
   `firstServerReleasePublished` to `true` in
   `src/lib/__tests__/server-install.test.ts`, which checks all of it. In
   Oleafly/oleafly-server, delete the "first release is on its way" line in
   `README.md`.
7. When the copy has passed, and on the first release the website is
   deployed, check that
   `curl -fsSL https://oleafly.com/server/install.sh | grep '^installer_version='`
   prints the new version. Then run the one-command install on a fresh machine.

If the copy fails, run it by hand with
`gh workflow run sync-release.yml --repo Oleafly/oleafly-server -f tag=server-v0.1.0`.
Oleafly/oleafly-server also copies new releases once a day, but GitHub turns
that schedule off after 60 days without activity in the repository, so don't
count on it.

Pull requests that change the server or `deploy/server` also run
`deploy/server/tests/e2e.sh` against the amd64 image the job built. It starts a
privileged ubuntu:24.04 container that installs Docker with Docker's script,
then installs, updates and uninstalls the server with the real installer, with
the release served from a local registry. Caddy uses its own test certificate
authority, so nothing reaches Let's Encrypt. To run it yourself, use a Linux
x86-64 machine with Docker that can start privileged containers:
`sh deploy/server/tests/e2e.sh oleafly-server:ci-amd64`.
