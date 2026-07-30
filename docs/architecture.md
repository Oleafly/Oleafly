# Product architecture

Oleafly is a pnpm monorepo with a React and TypeScript desktop frontend and a
Rust Tauri backend. The architecture keeps product surfaces composable while
making document engines, filesystem policy, and external integrations explicit.

## Monorepo map

| Area | Responsibility |
| --- | --- |
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
- `@oleafly/registry` owns contribution contracts; it is an internal registry,
  not a dynamic third-party plugin SDK.

The app creates the concrete host adapters in `src/`. A package must not import
Zustand stores, Tauri APIs, or `@/` application modules. This keeps package
tests runnable without a desktop runtime and prevents dependency cycles.

## Compilation boundary

`DocumentEngine` is the single capability contract for LaTeX, Typst, and
Markdown. It declares source extensions, formatting profile, compile policy,
SyncTeX/offline/isolated-compile capabilities, and conversion exports. The UI
must not infer engine behavior from a filename extension.

## Security boundary

- Rust resolves user paths through the sandbox before filesystem, process, Git,
  or export operations.
- Long-lived credentials use encrypted app-managed storage.
- MCP binds to loopback and uses a bearer token plus the normal approval model.
- Downloaded runtimes are pinned, verified, and extracted with allowlisted
  archive members.
- Hosted integrations are opt-in; the local workflow remains useful offline.

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
the Tailwind scan. Tests move with the package; compatibility shims may remain
at old app paths when a public import path would otherwise churn.

## Detailed references

- [Architecture and package details](architecture.md)
- [Development workflow](development.md)
- [Compilation engines](CompilationEngines.md)
- [Language-server toolchain](language-server-toolchain.md)
- [Contribution registry](architecture.md#the-contribution-registry)
