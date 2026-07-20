---
title: "PDF preview"
description: "The built-in PDF viewer: zoom and pinch, single or two-page spreads, a detached window for a second monitor, fullscreen, invert colors, and text you can select."
---

The right-hand pane is a full PDF reader built for the write-compile loop: it updates on every build, stays smooth on documents hundreds of pages long, and supports the reading habits a desktop viewer should.

The viewer is virtualized: only pages near your viewport are rasterized, so a 300-page thesis scrolls as lightly as a one-page letter.

![Two-page spread view in the PDF preview](/Oleafly/media/pdf-preview-spread.png)

## The toolbar, left to right

- **Logs**: flips to the [compile log view](/Oleafly/compiling/#reading-the-logs), with an error/warning badge.
- **Single page view / Two-page view**: continuous scrolling in one column, or side-by-side spreads like an open book. Spreads are ideal for proofing facing pages of a thesis or book.
- **Page navigation**: previous, next, and a "N of M" box. Type a number and press Enter to jump; the counter tracks your scroll position automatically.
- **Zoom out / Zoom in** with a live percentage, from 40% to 400%. Zoom is instant (existing pages scale immediately, then re-render crisply a moment later).
- **Save PDF to project**: writes the compiled PDF into your project tree under a name you choose, committed via Git so it shows up in [history](/Oleafly/git-history/). For image projects this becomes **Save image to project** and saves a high-resolution PNG.
- **Invert PDF preview colors**: a dark-reading filter for late-night sessions. Toggle **Restore colors** to go back.
- **Open preview in a new window**: see below.
- **Fullscreen preview**: the preview takes the whole screen; **Esc** exits. In fullscreen you can also hide the toolbar entirely (a floating button brings it back).

## Trackpad and mouse zoom

Pinch on a trackpad to zoom, exactly like a native PDF app, or hold Ctrl and scroll. Regular two-finger scrolling is untouched, so navigation never fights zooming. The same 40% to 400% range applies everywhere.

## A second monitor: the detached preview window

**Open preview in a new window** pops the PDF into its own OS window with its own toolbar (layout, page navigation, zoom, invert). It reloads automatically after every compile and follows you when you switch projects, so you can write full-screen on one display and watch the typeset result on the other.

## Text is real

Every page has a selectable text layer: select and copy straight from the preview. Hyperlinks in the PDF are clickable and open in your system browser.

## Jumping between source and PDF

Hold ⌘ (Ctrl) and click any word in the PDF to jump to that word in your source, or press **⌘⇧J** (Ctrl+Shift+J) in the editor to light up the matching spot in the PDF. Full details on the [SyncTeX](/Oleafly/synctex/) page.

## Layout controls around the preview

The top toolbar's segmented control switches between **Source**, **Split**, and **PDF** views; the divider between panes drags to resize; and Settings, Appearance, **Open projects in** picks which layout a project opens with.

## What the preview is not

There's no in-preview text search, outline sidebar, or print button yet. For searching your document, **⌘F** in the source and **⌘⇧F** across the project cover the writing loop; for print-grade reading, **Export as PDF** and open the file in your system viewer.
