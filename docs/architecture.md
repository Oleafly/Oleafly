# Frontend architecture

Oleafly's frontend is a pnpm workspace: the app shell lives at the repo root
(`src/`), and the engines it is built from live in `packages/*` as nine
focused packages. The Rust backend (`src-tauri/`) is unchanged by this split;
see the [README's architecture diagram](../README.md#architecture) for the
frontend/Rust/sidecar picture and [Development](development.md) for day-to-day
commands.

This document covers: what each package is, the dependency-inversion rules
that keep them pure, the contribution registry that wires features into the
shell, how module resolution works, and how to add or extract a package.

## Why a workspace

Every feature used to reach directly into the app's Zustand stores, the Tauri
IPC client, and the shadcn UI kit. That made features inseparable from the
shell: nothing could be tested, reused, or reasoned about in isolation. The
workspace inverts that. Packages hold the feature logic and declare narrow
interfaces ("ports") for everything they need; the app implements those ports
over its stores and Tauri client and injects them. The app depends on
packages, never the reverse.

Packages are consumed **as TypeScript source** (their `main` points at
`src/index.ts`). There is no build step, no publishing, and no version skew:
Vite, Vitest, and `tsc` all resolve `@oleafly/*` straight to the package
sources via aliases (see [Module resolution](#module-resolution)).

## The packages

| Package | What it is | Injected ports | Notable deps |
| --- | --- | --- | --- |
| `@oleafly/latex` | Pure LaTeX/figure logic: the diagram model, TikZ serializer (`modelToTikz`, embedded-model round-trip), standalone-doc builder (`buildStandaloneDoc`), figure name/byte helpers | none (pure) | none |
| `@oleafly/ai-core` | AI provider catalog and resolution (`resolveActiveModel`, `hasConfiguredProvider`), vision-capability detection, the figure system prompt | none (pure) | `ai`, `@ai-sdk/*` |
| `@oleafly/registry` | The contribution registry: rail tabs, palette/omnibar commands, AI toolsets ([details below](#the-contribution-registry)) | none (contributions carry their own behavior) | react (types) |
| `@oleafly/preflight` | The preflight engine: document typing, source/PDF/reference rules, ATS parsing, accessible-export prep, scoring. `pdf-extract` ships as the `@oleafly/preflight/pdf-extract` subpath so pdf.js stays out of node test graphs | none (pure) | `pdfjs-dist` (subpath only) |
| `@oleafly/editor` | The CodeMirror LaTeX core: `CodeMirrorEditor`, the editor-view controller (`insertAtCursor`, `gotoLine`, …), language + completions, theme, folding, linters, latex-mask, math preview, search panel, spelling/grammar linters | `EditorHost` (document model + settings, hook-shaped), `SpellHost` (spellchecker/Harper/dictionary), `setBibKeysProvider`, `extraExtensions`/`extraKeymap` | `@codemirror/*`, `@replit/codemirror-vim`, `katex` |
| `@oleafly/preview` | The virtualized pdf.js viewer (`PdfViewer`), the SyncTeX page controller (`gotoRect`, `pageClickToBp`), the pdf.js worker, and the WebView polyfills (`@oleafly/preview/polyfills`, imported first in `main.tsx`) | `onOpenLink` prop (system-browser links), `setPdfLogger` | `pdfjs-dist` |
| `@oleafly/diagram` | The visual diagram composer: React Flow canvas, shape inspector, Draw/Code tabs, compile-preview-insert flow | `DiagramHost` (compile, file IO, editor insert, AI fix), `DiagramKit` context (Button/Tooltip/Select/toast/theme) | `@xyflow/react`, `@codemirror/*`, `@oleafly/latex` |
| `@oleafly/ai-tools` | The AI agent toolsets: project tools (read/write/compile/search/`project_map`, approval-gated edits) and figure-studio tools (`preview_figure`, `insert_figure`) | `AiToolsHost` (files, compile, symbol index, figure pipeline, editor) | `ai`, `@oleafly/latex` |
| `@oleafly/templates` | The new-project template gallery (two-step wizard, categories, previews, one-time asset downloads with progress) | `TemplatesHost` (previews, asset downloads, logging), `TemplatesKit` (Button/Tooltip), color options as props | none beyond UI utils |

Dependency direction, strictly enforced:

```
app (src/)  ──▶  @oleafly/*  ──▶  @oleafly/latex, @oleafly/ai-core (leaves)
```

A package must never import from `src/` (`@/…`), a Zustand store, `@tauri-apps/*`,
or the app's UI components. The purity check is part of extraction hygiene:

```bash
grep -rn 'from "@/\|@tauri\|zustand' packages/*/src   # must return nothing
```

## The port pattern

Packages declare interfaces; the app implements them once, usually as a
module-level adapter object closing over its stores. Four recurring shapes:

**Host ports**: one `interface XHost` per package covering the services it
needs. The app builds the adapter with imperative store reads:

```ts
// src/lib/ai-tools.ts (app adapter, abridged)
const HOST: AiToolsHost = {
  getProjectId: () => useFilesStore.getState().projectId,
  readFileContent,                       // Tauri client passthrough
  recompile: () => useCompileStore.getState().recompile(),
  insertAtCursor,                        // editor controller
  // ...
};
export const createOleaflyTools = (opts?) => createOleaflyToolsCore(HOST, opts);
```

Keeping app-only concerns inside the adapter also keeps dependencies out of
packages: the AI-SDK `generateText` call for the diagram "Fix with AI" lives
in the app adapter, so `@oleafly/diagram` has no `ai` dependency.

**UI kits**: a React context (or prop) of structurally-typed components:
`Button: ComponentType<{ variant?: …; onClick?: () => void }>`. The app passes
its shadcn components through unchanged; structural subsets make that free.
Kits also carry `toast` and a `useThemeMode()` hook.

**Hook-shaped ports**: for packages that must *subscribe* to app state. The
editor's `EditorHost` has hook members (`useActivePath()`, `useSettings()`)
plus imperative twins (`getActivePath()`) for event listeners. Rules: the host
object must be module-level (stable identity) and its `use*` members must call
hooks unconditionally.

**Module singletons**: for cross-cutting glue, `setPdfLogger(fn)`,
`setSpellHost(host)`, `setBibKeysProvider(fn)` have no-op defaults and are
installed by the app shim as an import side effect.

### Shims

Every extraction left a thin file at the old `@/…` path that re-exports (or
wraps) the package, so consumers and existing `vi.mock(...)` paths never
churned. Examples: `src/components/editor/cm/controller.ts` (re-export),
`src/components/pdf/PdfViewer.tsx` (wrapper injecting the shell-plugin link
opener), `src/lib/ai-tools.ts` (adapter + original factory signatures). New
code may import `@oleafly/*` directly; shims exist for compatibility, not as
the preferred path.

## The contribution registry

`@oleafly/registry` is how features plug into the app shell without the shell
knowing them. Three contribution kinds:

- **Rail tabs** (`registerRailTab`): icon, section (`explore` / `review` /
  `assist`, dividers drawn between non-empty sections), optional `when(ctx)`
  visibility, optional `useBadge()` hook (e.g. the Git change count), and the
  sidebar `panel` component.
- **Commands** (`registerCommand`): served to the command palette (Cmd+K,
  grouped by `group`) and/or the omnibar (Cmd+P) via `surfaces`. Labels and
  icons may be functions of the context (e.g. "Switch to light theme").
- **AI toolsets** (`registerAiToolset`): a chat mode (`"chat"`, `"figure"`)
  mapped to a toolset factory; the chat panel looks up the active mode's
  toolset instead of hard-coding one.

`AppContext` (`{ projectId, projectKind, theme }`) is built by each rendering
surface from its own subscriptions, so `when`/`label` conditions stay reactive.

Registration is **static**: `src/contributions/` registers every built-in
(tabs, commands, toolsets) and `main.tsx` calls `registerContributions()` once
before the shell mounts. `Rail`, `Sidebar`, `CommandPalette`, `SearchOmnibar`,
and `ChatPanel` render only what is registered.

To add a feature's tab or command, register it. No shell edits:

```ts
// src/contributions/my-feature.tsx (called from src/contributions/index.ts)
registerRailTab({
  id: "review", label: "Review", icon: MessageSquare,
  section: "review", order: 55,
  when: (ctx) => ctx.projectKind !== "image",
  panel: ReviewPanel,
});
registerCommand({
  id: "omnibar.review", surfaces: ["omnibar"], order: 45,
  label: "Open review", keywords: "review comments",
  run: () => useSettingsStore.getState().setRailTab("review"),
});
```

This is an internal API, not a plugin SDK: shapes may change freely, and
nothing loads dynamically. Deferred until a real consumer exists: export-menu
formats, settings schemas, and project-kind behaviors as contributions.

## Module resolution

Because packages are consumed as source, the same alias is declared in three
places, and all three must stay in sync when a package is added:

1. `tsconfig.json` → `compilerOptions.paths` (`"@oleafly/x": ["./packages/x/src/index.ts"]`;
   subpaths like `@oleafly/preflight/pdf-extract` need their own explicit entry).
2. `vite.config.ts` → `resolve.alias` (`"@oleafly/x": …/packages/x/src`; string
   aliases prefix-match, so subpaths resolve for free).
3. `vitest.config.ts` → the same `resolve.alias`, **plus** `test.include` must
   cover `packages/**/*.test.ts`. Otherwise moved tests silently drop out of
   the run.

Also: the root `package.json` depends on each package via `"workspace:*"`, and
`src/styles/globals.css` has `@source "../../packages"` so Tailwind v4 scans
package sources for class names.

Vite-only imports (`?worker&url` workers, CSS imports) work unchanged from
package sources because the aliases point at source. Keep anything that drags
in pdf.js out of barrels that node-environment tests import: that is why
`pdf-extract` and the preview package's viewer are reachable only where the
DOM exists.

## Working on packages

- **Tests** live next to the source (`packages/*/src/*.test.ts`) and run in the
  same `pnpm test` as app tests. Watch the test *count* when moving files.
- **Dependencies** are declared loosely (`"react": "*"`); pnpm dedupes against
  the root, where the real version floors live. Don't declare deps the package
  doesn't import.
- **Gates for any package change**: `pnpm exec tsc --noEmit`, `pnpm build`,
  `pnpm test` (unchanged count), and the purity grep above.
- **Extracting something new**: move files with `git mv` (history follows),
  define the ports, leave shims at old paths, wire the three aliases, then run
  the gates. Don't extract a feature while actively iterating on it.
- **Licensing**: every package is `AGPL-3.0-or-later`, same as the app.

## What stays in the app

`src/` keeps everything that is genuinely the app: the Zustand stores, the
Tauri IPC client (`src/lib/tauri.ts`), the shadcn UI kit, layout/shell
components, the port adapters and shims, `src/contributions/`, and
feature glue that is store-coupled by nature (the preflight panel UI, the
inline-AI editing plugin, code/hover intel, injected into the editor as
`extraExtensions`). The Rust side (`src-tauri/`) is a single crate and stays
that way until backend-heavy work justifies a cargo workspace split.
