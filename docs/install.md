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

OpenLeaf 0.2.5 is an unsigned developer beta. The apps are not code-signed or
notarized, so operating systems can warn or block them. Download artifacts only
from the official releases page and verify published checksums before opening
them.

**macOS.** Double-clicking may say *"OpenLeaf is damaged and can't be opened"* or
*"can't be opened because Apple cannot check it"*. Download it again from the
official release if the source is uncertain. Otherwise:

- Right-click (or Control-click) the app in Applications and choose **Open**, then
  **Open** again in the dialog.

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

- Node.js 22.13+ and pnpm 11.9+ (the exact pnpm version is declared in
  `package.json`)
- Rust (stable), installed via [rustup](https://rustup.rs)
- Tauri 2 system dependencies for your OS, see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)
- Optional until first use, for Markdown PDF compilation and Word/HTML export:
  [pandoc](https://pandoc.org/installing.html). OpenLeaf can download its pinned
  Pandoc 3.9.0.2 archive on demand on macOS Apple Silicon, Linux x64, and
  Windows x64. OpenLeaf pins each supported GitHub release asset's SHA256,
  verifies it before extraction, accepts only the exact regular executable
  member, applies size and network time limits, verifies `pandoc --version`, and
  publishes the executable atomically. Other OS/architecture combinations fail
  closed with a manual-install message.

### Run the dev app

```bash
git clone https://github.com/prajwal-svm/OpenLeaf.git
cd OpenLeaf

./scripts/fetch-tectonic.sh all     # or: aarch64-apple-darwin / x86_64-pc-windows-msvc / ...
./scripts/fetch-typst.sh all

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
