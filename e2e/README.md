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
- `OPENLEAF_DATA_DIR` points the app at a throwaway directory, so runs are
  hermetic and never touch `~/.openleaf`.

## Running

One command (builds, launches, tests, tears down):

```bash
pnpm test:e2e:app
```

Or manually, keeping the app open between runs while writing tests:

```bash
# Terminal 1
OPENLEAF_DATA_DIR=$(mktemp -d) pnpm tauri dev --features e2e-testing
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
- Skip: native dialogs (export "Save as"), AI conversations, the updater —
  not automatable / nondeterministic by design.
