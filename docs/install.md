# Installing OpenLeaf

There are two ways to get OpenLeaf: download a ready-to-run app for your
platform, or build it from source. Downloading is the fast path and works for
almost everyone. Building from source is for contributors, or for anyone on a
platform we don't ship a prebuilt app for yet.

## Download the app

Grab the latest installer from the [releases page](https://github.com/prajwal-svm/OpenLeaf/releases/latest).

| Platform | Download | What to do |
|---|---|---|
| macOS (Apple Silicon) | `.dmg` | M1 or newer. Open the dmg, drag OpenLeaf to Applications. |
| Windows (x86_64) | `.msi` or `-setup.exe` | Run either installer and follow the prompts. |
| Linux (x86_64) | `.AppImage`, `.deb`, or `.rpm` | AppImage runs anywhere; use the deb or rpm if you'd rather go through your package manager. |

That's the whole install. Open the app and you're in. No account, no sign-in.

## First launch

The apps aren't code-signed or notarized yet, so the first time you open one the
OS puts up a warning. The app is safe to open; you just have to tell the OS you
meant it. Signing is planned, and once it ships this step goes away.

**macOS.** Double-clicking may say *"OpenLeaf is damaged and can't be opened"* or
*"can't be opened because Apple cannot check it"*. Either:

- Right-click (or Control-click) the app in Applications and choose **Open**, then
  **Open** again in the dialog, or
- Run this once in Terminal to clear the quarantine flag (the full path avoids a
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

## Build from source

For contributors, or to run OpenLeaf on a platform we don't ship a prebuilt app
for. It's built with [Tauri 2](https://tauri.app) (Rust + React).

### Prerequisites

- Node.js 20+ and pnpm
- Rust (stable), installed via [rustup](https://rustup.rs)
- Tauri 2 system dependencies for your OS, see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)
- Optional, for Word/HTML export: [pandoc](https://pandoc.org/installing.html)

### Run the dev app

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

### Build a production bundle

```bash
pnpm tauri build      # produces a .dmg / .msi / .AppImage in src-tauri/target/release/bundle
```

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
