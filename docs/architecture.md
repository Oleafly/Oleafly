# Product architecture

Oleafly is a pnpm monorepo with a React and TypeScript desktop frontend and a
Rust Tauri backend. The architecture keeps product surfaces composable while
making document engines, filesystem policy, and external integrations explicit.

## Monorepo map

| Area | Responsibility |
| --- | --- |
| `crates/oleafly-core/` | Shared project manifest, path safety, and build-directory policy |
| `crates/oleafly-cli/` | The `oleaflyc` commands, native compiler adapter, and output contracts |
| `crates/oleafly-agent/` | Provider-neutral agent runtime |
| `src/` | Application shell, stores, Tauri adapters, contributions, and UI |
| `packages/editor/` | Engine-neutral editor and language-service primitives |
| `packages/latex/` | LaTeX parsing, masking, and source operations |
| `packages/registry/` | Rail tabs, commands, toolsets, and context providers |
| `packages/preflight/` | Source, PDF, ATS, accessibility, and reference rules |
| `packages/diagram/` | Host-independent diagram composer |
| `packages/templates/` | Template gallery contracts and host integration |
| `packages/ai-core/` and `packages/ai-tools/` | Provider and tool boundaries |
| `src-tauri/src/` | IPC commands, project sandbox, Git, engines, downloads, and secrets |
| `src-tauri/resources/` | Templates, licenses, and pinned runtime resources |

## Runtime flow

1. The frontend selects a project and reads its engine descriptor.
2. The shared project index parses source, references, citations, and file
   relationships.
3. A compile request crosses typed Tauri IPC into the Rust engine dispatcher.
4. Rust executes the selected engine inside the project sandbox and emits
   normalized logs, diagnostics, and declared artifacts.
5. The preview consumes the accepted artifact and optional SyncTeX map.
6. Preflight and AI tools consume the same project snapshot and result policy.

Step 2 reads project source through a single `read_project_sources` call
instead of one `read_file` per path. Rust hashes every file and sends text back
only where the hash differs from what the caller already holds, so a rebuild
after one edit returns a list of paths rather than the whole project. The cache
of those hashes lives in `src/lib/project-sources.ts`, which reverts to
per-file reads when the batch command is missing.

Document statistics go through the same reader. The `document_stats` command
walks the include closure from the main document and reads every file in one
batch call. Masking and counting happen in Rust, and unsaved buffers travel in
the request so the numbers match what is on screen. The TypeScript counter in
`src/lib/document-stats.ts` stays as the fallback for browser mode and for a
backend without the command. The golden fixtures under
`src-tauri/src/fixtures/document-stats/` fail the Rust tests as soon as the
two counters disagree.

`rag_retrieve` does the same for the assistant. It walks the project and
scores every indexable chunk against the query in Rust, so one message costs
one call rather than one read per file. `src/lib/ai-rag.ts` still reads file by
file when the command is missing, and a golden fixture under
`src-tauri/tests/fixtures/rag/` fails the Rust tests when the two scorers
disagree.

## Extension model

The contribution registry is the supported application extension point. Tabs,
commands, AI toolsets, and context providers register typed contributions.
Packages depend on ports and contracts, not application stores or Tauri globals.
The app shell supplies concrete adapters at the boundary.

## Package boundaries and ports

- `@oleafly/editor` owns CodeMirror, language primitives, proofing, and editor
  controllers.
- `@oleafly/latex` owns pure LaTeX parsing, masking, and figure serialization.
- `@oleafly/preview` owns the PDF.js viewer and SyncTeX page controller.
- `@oleafly/preflight` owns source, PDF, ATS, accessibility, and reference
  rules without importing app stores.
- `@oleafly/diagram`, `@oleafly/templates`, and `@oleafly/ai-tools` expose
  host interfaces for compile, file, UI, and approval services.
- `@oleafly/registry` owns contribution contracts. It is an internal registry,
  not a dynamic third-party plugin SDK.

The app creates the concrete host adapters in `src/`. A package must not import
Zustand stores, Tauri APIs, or `@/` application modules. This keeps package
tests runnable without a desktop runtime and prevents dependency cycles.

## Compilation boundary

`oleafly-core` owns the portable project manifest, project-relative resolution
of the main document, and `.oleafly/build` preparation. Both adapters use it.
The desktop keeps its wider application sandbox for stored projects, figures,
and exports. Compiler execution and diagnostics stay with each adapter: the
desktop runs engines inside that sandbox, and `oleaflyc` runs them directly
against the project directory it was pointed at.

Within the desktop adapter, `DocumentEngine` is the capability contract for
LaTeX, Typst, and Markdown. It declares source extensions, formatting profile,
compile policy, SyncTeX/offline/isolated-compile capabilities, and conversion
exports. The UI must not infer engine behavior from a filename extension.

LaTeX log parsing lives in `oleafly-core::parse_latex_log`, next to the project
policy both runtimes share. The desktop calls it once a compile finishes and
returns the grouped result in `CompileResult.diagnostics`, so the log pane no
longer reparses the whole log on every streamed chunk. The TypeScript parser in
`@oleafly/latex` remains the fallback for a backend that does not send the
field.

## AI providers and model trust

`crates/oleafly-agent` talks to every provider over one of four wire formats
and has no idea which models the app trusts. That decision stays in the
desktop adapter. `ai_model_registry.rs` reads the model catalog (bundled at
`src-tauri/resources/ai-models.json`, refreshed from the CDN on each listing)
and marks each model a provider returns as verified, blocked with a reason, or
untested. Nothing is filtered out any more, so a model the catalog has not
caught up with still shows in the picker. `ai_model_metadata.rs` attaches a
trimmed models.dev snapshot: context window, output limit, modalities, tool
support, cost. The snapshot comes from the bundled copy, a disk cache under
`catalogs/` in the data directory, or a daily CDN refresh, and a listing never
waits on that fetch. `agent_probe_model` runs one bounded tool call round trip
against a model and stores the verdict in the config, where later listings and
the run path pick it up. Before the assistant sends its first request,
`agent_run` refuses a blocked model. It also refuses an untested model whose
metadata says it cannot call tools, but only when the run declares tools: the
composer's chat-only mode sends no tools and goes through. Each listed model
also says where its trust came from (`trustSource` is `catalog` or `probe`),
so the shell can tell a catalog verdict from one of the user's own probes.

## Security boundary

- Rust resolves user paths through the sandbox before filesystem, process, Git,
  or export operations.
- Long-lived credentials use encrypted app-managed storage.
- MCP binds to loopback and uses a bearer token plus the normal approval model.
  Renderer sessions coordinate tools while a window is connected. The Rust
  backend handles the safe native subset when no renderer is connected.
- Downloaded runtimes are pinned and verified. `tinytex_archive.rs` validates
  the exact reviewed member manifest before extracting into staging.
- Hosted integrations are opt-in. The local workflow remains useful offline.

## Repository maintenance

- Keep reusable logic in the smallest applicable package.
- Add or change a port before coupling a package to an app service.
- Update engine descriptors and capability tests together.
- Keep templates, sidecars, and manifests deterministic and checksum-pinned.
- Add unit tests for parser and store changes, Rust tests for filesystem and
  process boundaries, and end-to-end coverage for cross-layer workflows.
- Run the frontend, package, Rust, language-server, and dependency checks
  listed in `docs/development.md` before a release.

## Module resolution and extraction

Workspace packages are consumed as TypeScript source. When a package is added,
keep the aliases in `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts` in
sync, add the workspace dependency at the root, and include package sources in
the Tailwind scan. Tests move with the package. Compatibility shims may remain
at old app paths when a public import path would otherwise churn.

## Detailed references

- [Architecture and package details](architecture.md)
- [Development workflow](development.md)
- [Compilation engines](CompilationEngines.md)
- [Language-server toolchain](language-server-toolchain.md)
- [Contribution registry](architecture.md#the-contribution-registry)
