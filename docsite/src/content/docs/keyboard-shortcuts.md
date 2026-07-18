---
title: "Keyboard shortcuts"
description: "The complete shortcut reference for macOS, Windows, and Linux, from compile and SyncTeX to code intelligence and the slash menu."
---

Oleafly is comfortable to drive entirely from the keyboard. Press **⌘/** (Ctrl+/) inside the app anytime for a searchable version of this list.

![The searchable in-app keyboard shortcuts reference](/OpenLeaf/media/keyboard-shortcuts.png)

macOS shortcuts are listed first; the Windows/Linux equivalent swaps ⌘ for Ctrl.

## Global

| macOS | Windows / Linux | Action |
|---|---|---|
| ⌘K | Ctrl+K | Command palette |
| ⌘⇧F | Ctrl+Shift+F | Search omnibar: projects, all documents, `/` commands |
| ⌘↵ | Ctrl+Enter | Recompile |
| ⌘⇧J | Ctrl+Shift+J | Jump to PDF (SyncTeX forward) |
| ⌘/ | Ctrl+/ | Keyboard shortcuts reference |

## Editor

| macOS | Windows / Linux | Action |
|---|---|---|
| ⌘F | Ctrl+F | Find & replace |
| ⌘B | Ctrl+B | Bold (`\textbf{}`) |
| ⌘I | Ctrl+I | Italic (`\textit{}`) |
| ⌘Z / ⌘⇧Z | Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| ⌘L | Ctrl+L | Ask AI to edit the selection ([inline edit](/OpenLeaf/ai-inline-edit/)) |
| Ctrl+Space | Ctrl+Space | Trigger autocomplete |
| `/` | `/` | Slash insert menu (`/figure`, `/table`, `/section`, ...) |
| Tab | Tab | Accept suggestion, otherwise indent |
| Alt-drag | Alt-drag | Rectangular (column) selection |
| Gutter arrow | Gutter arrow | Fold / unfold an environment or section |

In the find widget: **Enter** next match, **Shift+Enter** previous, **Esc** close.

## Code intelligence

| macOS | Windows / Linux | Action |
|---|---|---|
| F12 or ⌘-click | F12 or Ctrl-click | Go to definition (across files) |
| ⇧F12 | Shift+F12 | Find references (opens the References panel) |
| F2 | F2 | Rename symbol project-wide |
| ⌘-hover | Ctrl-hover | Underline symbols as clickable links |

## PDF preview

| macOS | Windows / Linux | Action |
|---|---|---|
| ⌘-click on the PDF | Ctrl-click on the PDF | Jump to source (SyncTeX inverse) |
| Pinch on trackpad | Ctrl+scroll | Zoom (40% to 400%) |
| Esc | Esc | Exit fullscreen preview |

## Inline AI review

While an [inline AI edit](/OpenLeaf/ai-inline-edit/) is showing its diff: **Enter** accepts, **Esc** rejects.

## Layout

The view is controlled from the toolbar rather than shortcuts: the **Source / Split / PDF** segmented control switches layouts, the divider drags to resize, and clicking the active rail tab collapses the sidebar.

## Vim mode

Toggle **Vim mode** in Settings, General (or via the ⌘K palette) for the full Vim keybinding set (`hjkl`, `i`, `:w`, `dd`, `ciw`, visual mode) alongside everything above. See [The editor](/OpenLeaf/editor/#vim-mode).

## Where else commands live

Almost everything with a shortcut also lives somewhere clickable: the [editor toolbar](/OpenLeaf/editor/#the-toolbar), the right-click menu, the **⌘K** command palette (fuzzy-searches every action: recompile, word count, add citation, insert figure, toggle theme, and more), and the **⌘⇧F** omnibar with its `/` scopes (`/create`, `/projects`, `/docs`, `/theme`, `/settings`).
