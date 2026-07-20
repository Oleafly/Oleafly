---
title: "Download & install"
description: "Get Oleafly running on macOS, Windows, or Linux in a minute: download, first-launch unlock, and what the first compile fetches."
---

Installing Oleafly is a download and a double-click. No account, no sign-in, and no separate LaTeX distribution to install: the compiler ships inside the app.

## Download the app

Grab the latest installer from the [releases page](https://github.com/Oleafly/Oleafly/releases/latest).

| Platform | Download | What to do |
|---|---|---|
| macOS (Apple Silicon) | `.dmg` | M1 or newer. Open the dmg, drag Oleafly to Applications. |
| Windows (x86_64) | `.msi` or `-setup.exe` | Run either installer and follow the prompts. |
| Linux (x86_64) | `.AppImage`, `.deb`, or `.rpm` | AppImage runs anywhere recent; use the deb or rpm if you'd rather go through your package manager. |

On Linux, Oleafly needs glibc 2.39 or newer, which means a 2024-era distribution or later (Ubuntu 24.04+, Fedora 40+, Debian 13+).

## First launch

The builds aren't code-signed or notarized yet, so the first time you open the app the OS shows a warning. The app is safe to open; you just have to tell the OS you meant it. Signing is on the [roadmap](https://github.com/Oleafly/Oleafly/blob/main/README.md#roadmap), and once it ships this step goes away.

**macOS.** Double-clicking may say *"Oleafly is damaged and can't be opened"* or *"can't be opened because Apple cannot check it"*. Either:

- Right-click (or Control-click) the app in Applications and choose **Open**, then **Open** again in the dialog, or
- Run this once in Terminal to clear the quarantine flag (the full path avoids a non-Apple `xattr` some setups have in PATH):

  ```bash
  /usr/bin/xattr -dr com.apple.quarantine /Applications/Oleafly.app
  ```

**Windows.** SmartScreen may show *"Windows protected your PC"*. Click **More info**, then **Run anyway**.

**Linux.** Make the AppImage executable, then run it:

```bash
chmod +x Oleafly_*.AppImage && ./Oleafly_*.AppImage
```

## The first compile downloads TeX packages

The first time you compile a document, the bundled Tectonic engine downloads the LaTeX packages that document needs and caches them locally. This needs an internet connection and can take a minute, so the first build is slower than every build after it. From then on, compiles are fast and fully offline. See [Compiling](/Oleafly/compiling/) for details, including the strict Offline mode.

Your files, tokens, and AI keys never leave your machine. See the [Philosophy](/Oleafly/philosophy/) page for how Oleafly treats your data.

## Staying up to date

Oleafly updates itself: it checks a signed release feed, shows you the release notes, and installs in place when you confirm. You can always check manually from Settings, Help & About. Details in [Updates](/Oleafly/updates/).

## Build from source

Contributors (or anyone on a platform without a prebuilt app) can build Oleafly themselves; it's a Tauri 2 app (Rust + React):

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
./scripts/fetch-tectonic.sh all   # fetch the compiler sidecar
pnpm install
pnpm tauri dev
```

The full guide, including prerequisites and production builds, is in [Development](/Oleafly/engineering/development/) under Engineering.

## Next steps

- [Getting started](/Oleafly/getting-started/): first project to first PDF in about two minutes.
- [Templates](/Oleafly/templates/): the 19 starting points that ship with the app.
