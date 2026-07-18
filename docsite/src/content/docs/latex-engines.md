---
title: "LaTeX engines & packages"
description: "Tectonic for everyday compiles, LuaLaTeX for tagged accessible PDFs: system TeX Live detection, the self-contained TinyTeX install, and the built-in package manager."
---

Oleafly ships one engine and can manage a second. Understanding the split takes a minute and explains everything in Settings, LaTeX Engine.

## Tectonic: the everyday engine

Everything on the [Compiling](/OpenLeaf/compiling/) page runs on **Tectonic**, the XeTeX-based engine bundled inside the app. It's fast, needs zero installation, fetches packages on demand, caches them for offline use, and produces clean Unicode PDFs with embedded fonts. For writing, previewing, and exporting, Tectonic is all you ever touch, and it is not configurable away.

One thing Tectonic cannot do: produce **tagged PDFs**, the structure layer that screen readers and Section 508 / PDF-UA compliance require. That takes LuaLaTeX.

## LuaLaTeX: the tagging engine

Settings, **LaTeX Engine** ("Tagged / accessible export") manages it, and there are two ways to have it:

1. **You already have TeX Live.** Oleafly detects a system LuaLaTeX and shows "Using a system LuaLaTeX / TeX Live". Nothing to install.
2. **You don't.** One button, **Install TinyTeX (~100 MB)**, downloads a self-contained TeX Live into `~/.openleaf/tinytex` with live progress. No admin rights, no system changes, and **Delete TinyTeX to free space** removes it entirely whenever you like.

With an engine present, the [Preflight](/OpenLeaf/preflight/) panel's **Compile tagged and verify** button can produce a tagged PDF with LuaLaTeX and immediately audit it, in one step. Prefer your own toolchain? Preflight's **Prepare for accessible export** rewrites your source for tagging and you compile it with any LuaLaTeX (TeX Live 2025 or newer) outside the app.

## The package manager

Below the engine status sits a filterable **Packages** list for the LuaLaTeX side, powered by `tlmgr`:

- **Add** or **Remove** packages with one click (available once an engine is installed).
- Each package shows a description and, where relevant, a tagging-compatibility badge: **tagging: caution** (amber) for packages that can degrade tag quality, and **breaks tagging** (red) for ones that defeat it. You find out before the compile, not after.

This manager is about the tagging engine. Tectonic needs no package management at all: it resolves and caches packages automatically per document.

## Which engine compiled my PDF?

- The preview, exports, and everything routine: **Tectonic**.
- The tagged PDF produced via Preflight's tagged-compile flow: **LuaLaTeX**. It lands in the same build location, so the preview and download pick it up like any other build.

## Templates and packages

Templates declare the packages they need (IEEEtran, acmart, elsarticle, beamer, tikzposter, natbib, and friends), and Tectonic fetches them on first compile. Templates with on-demand fonts handle those separately; see [Templates](/OpenLeaf/templates/#on-demand-fonts-the-setup-badge).
