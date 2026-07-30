# End-to-end tests

Real user journeys against the real app: real WKWebView/WebKitGTK webview,
real Rust backend, real Tectonic compiles, real PDF rendering. Nothing is
mocked. If a test says the PDF compiled with zero errors, a user clicking the
same buttons gets a PDF with zero errors.

## How it works

- `tauri-plugin-playwright` (Rust) is compiled into the app **only** with
  `--features e2e-testing` and exposes a socket bridge to the webview.
  Its result channel is a plugin IPC command, allowed by a runtime capability
  granted only in e2e builds (see `lib.rs`).
- `@srsholmes/tauri-playwright` (npm) gives Playwright's test API
  (`test`, `expect`, locators, auto-waiting) over that bridge.
- `OLEAFLY_DATA_DIR` points the app at a throwaway directory, so runs are
  hermetic and never touch `~/.oleafly`.

## Running

One command (builds, launches, tests, tears down):

```bash
pnpm test:e2e:app
```

Run the book-scale editor performance gate independently:

```bash
pnpm test:editor:performance
```

The fixture is a deterministic, compilable manuscript rather than one copied
line repeated thousands of times. Its 6,200 lines contain 99% distinct
nonempty lines, more than 450,000 characters, 16+ chapters, 70+ sections, ten
formula families, theorems and proofs, tables, lists, quotations, footnotes,
citations, cross-references, prose, and deliberately detectable proofreading
findings. A surrounding project tree adds front matter, an appendix, editorial
notes, and a bibliography.

The deterministic performance gate uses three warm-up runs followed by 20
measured runs and enforces p95 budgets for that manuscript, a 200-file project
near 500,000 characters, project-backed citation completion, syntax
diagnostics, proofreading extraction, inline-math scanning, and completion at
the end of the book.

The native companion in `58-editor-core-stability.spec.ts` opens the Source
Tree and split workspace, compiles the real book with Tectonic, renders its PDF
beside CodeMirror, and keeps project intelligence, Harper, Hunspell, and inline
math active. It then measures repeated distant scrolling and 252 mixed
navigation, slow character-typing, multiline-paste, delete, undo, and redo
actions. Aggregate and per-action p95 ceilings are enforced, the source must be
restored byte-for-byte, and the run allows no blank viewport frames,
line-number drift, missing tree/editor/PDF surfaces, or browser-document scroll
leaks. The same spec also verifies completion stability, feature-surface
agreement, PDF controls, and current/stale SyncTeX behavior.

Or manually, keeping the app open between runs while writing tests:

```bash
# Terminal 1
OLEAFLY_DATA_DIR=$(mktemp -d) pnpm tauri dev --features e2e-testing
# Terminal 2
pnpm test:e2e
```

The suite is sequential (one worker, one app instance) and assumes a fresh
data dir: specs build on each other (02 creates the project that 03-06 use).
Rerunning against an already-used app instance is not supported — relaunch.

## Writing tests

- Prefer `data-testid` selectors; add ids to the app rather than matching
  Tailwind classes. `getByText` works for user-visible copy.
- The selector engine is CSS (`querySelector`) plus `getByTestId` /
  `getByText` / `getByLabel` / `getByRole` — no `:has-text()`.
- Global shortcuts (Cmd+K etc.): use `pressGlobal` from `helpers.ts`
  (dispatches a window keydown, which the app's real handlers receive).
- Typing into CodeMirror: `typeInEditor` (execCommand-based real input).
- Compile assertions: `.pdf-canvas` for a rendered page, the
  `compile-status` testid's `data-severity` attribute for zero-error runs,
  `.textLayer` for text that must appear in the PDF.
- Skip: native dialogs (export "Save as"), rendering inside secondary native
  windows, nondeterministic live AI replies, and the updater.
- **Idempotency**: tests may be re-run against a live app while iterating, so
  restore what you toggle (theme, vim, ignored words), use `\providecommand`
  instead of `\newcommand` for injected LaTeX, and make injected command
  names unique per run. CodeMirror anchors must live inside ONE syntax token
  (no backslash-prefixed anchors - highlighting splits text nodes).
- Rail tabs: use `openRailTab` (handles the persisted collapsed-sidebar state
  AND the re-click-collapses-the-active-tab trap).
- Settings: `openSettings(page, section)`; toggles are `[role="switch"]` with
  their label as `aria-label`.
- TEXTAREAS: the plugin's `fill()` only drives `<input>` (it throws
  "HTMLInputElement.value setter" on textareas) - use `fillTextarea` from
  `helpers.ts` (chat box, commit message, custom instructions).
- Hover-revealed controls (`opacity-0 group-hover`): the plugin's `click()`
  waits for visibility and never fires - click the element via `evaluate`
  (`el.click()` works fine on invisible elements).
- Panels that refresh on mount only (source control): after making an edit,
  loop "click Refresh -> check" rather than waiting once; the save-on-compile
  and the panel's own refresh both land asynchronously.
- A `data-severity="ok"` wait passes IMMEDIATELY if the chip is still "ok"
  from an earlier compile in the same test - don't use it as a "my second
  compile finished" signal; wait for the downstream effect instead.

## Opt-in env vars

Set them in your shell, or copy `e2e/.env.example` to `e2e/.env` (gitignored)
and fill in values - `fixtures.ts` loads it in every worker process (loading
it only from the Playwright config does NOT work: workers never see env vars
set while the main process evaluates the config).

| Var | Effect |
| --- | --- |
| `E2E_GITHUB_TOKEN` | Runs the source-control stage/diff/commit flow and the history restore round-trip (connects with the PAT) |
| `E2E_GIT_PUSH=1` | Runs the publish-to-GitHub test: creates a real `e2e-oleafly-*` repo, pushes, verifies over the API, then deletes it (grant the PAT the `delete_repo` scope, or delete the repo manually) |
| `E2E_SKIP_NETWORK=1` | Skips the font-download and template-font-pack tests |
| `E2E_AI_TOKEN` | Runs the real AI tests: provider connect, GLM-4.6 model pick, conversation, tool call, figure generation |
| `E2E_AI_PROVIDER` | Provider card name for the AI tests (default `Z.AI`) |
