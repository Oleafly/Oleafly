# Installing OpenLeaf

OpenLeaf is built with [Tauri 2](https://tauri.app) (Rust + React).

**Just want to use it?** Download a prebuilt installer from the [latest release](https://github.com/prajwal-svm/OpenLeaf/releases/latest) (macOS, Windows, Linux). Those builds aren't code-signed/notarized yet (that's on the [roadmap](../README.md#roadmap)); see [First run](#first-run-running-a-downloaded-build) below for the one-time unlock. The rest of this page is for building from source.

## Prerequisites

- Node.js 20+ and pnpm
- Rust (stable), installed via [rustup](https://rustup.rs)
- Tauri 2 system dependencies for your OS, see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)
- Optional, for Word/HTML export: [pandoc](https://pandoc.org/installing.html)

## Run from source

```bash
git clone https://github.com/prajwal-svm/OpenLeaf.git
cd OpenLeaf

# 1. Fetch the Tectonic compiler sidecar for your platform
./scripts/fetch-tectonic.sh all     # or: aarch64-apple-darwin / x86_64-pc-windows-msvc / ...

# 2. Install frontend deps
pnpm install

# 3. Launch the dev app
pnpm tauri dev
```

## Build a production bundle

```bash
pnpm tauri build      # produces a .dmg / .msi / .AppImage in src-tauri/target/release/bundle
```

## First run (running a downloaded build)

Current builds are **not code-signed or notarized yet** (that's on the roadmap),
so the OS will warn the first time you open the app. It's safe to open; here's how
to get past the warning.

**macOS.** Double-clicking may say *"OpenLeaf is damaged and can't be opened"* or
*"can't be opened because Apple cannot check it"*. Either:

- Right-click (or Control-click) the app in Applications and choose **Open**, then
  **Open** again in the dialog, or
- Run once in Terminal to clear the quarantine flag (the full path avoids a
  non-Apple `xattr` that some setups have in PATH, which lacks `-r`):

  ```bash
  /usr/bin/xattr -dr com.apple.quarantine /Applications/OpenLeaf.app
  ```

**Windows.** SmartScreen may show *"Windows protected your PC"*. Click **More info**,
then **Run anyway**.

**Linux.** Make the AppImage executable, then run it:

```bash
chmod +x OpenLeaf_*.AppImage && ./OpenLeaf_*.AppImage
```

### The first compile downloads TeX packages

The first time you compile a document, the bundled Tectonic engine downloads the
LaTeX packages your document needs and caches them. This needs an internet
connection and can take a minute, so the first build is slower than the rest.
Every compile after that is fast and works offline. (A pre-warmed offline bundle
for a true zero-internet first run is on the roadmap.)

Your files, tokens, and AI keys never leave your machine.

## The 30-second tour

1. Open the app and pick a template (try One-Page Resume).
2. Edit on the left, watch the PDF build on the right.
3. `⌘↵` to recompile, `⌘K` for the command palette, `⌘⇧J` to jump to the PDF.
4. Done? Download PDF. It's ATS-clean by default.

## Next steps

- [Getting Started](getting-started.md): first project to first PDF in 2 minutes
- [Features](features.md): what the editor can do
- [AI Assistant](ai-assistant.md): connect a model, or run locally with Ollama
- [Development](development.md): architecture and how to contribute
