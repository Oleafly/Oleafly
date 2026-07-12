---
title: "Files & folders"
description: "The Source Tree: creating, renaming, moving, and copying files, the main document, tabs, image and PDF views, and how autosave protects your work."
---

Every project is a real folder of files, and the **Source Tree** panel (the first tab in the left rail) is how you work with it. Multi-file projects are first-class: split chapters into their own `.tex` files, keep images in a folder, and OpenLeaf's compile, navigation, and search all follow along.

## The Source Tree panel

Folders sort first, then files alphabetically. Click a folder to expand or collapse it, click a file to open it in a tab, and use the arrow keys plus Enter for full keyboard navigation. The project's **main document** (the file the compiler starts from) is marked with a star.

Two buttons in the panel header create things: **New file** and **New folder**. Both create inside the currently selected folder, or at the project root if nothing is selected. Type the name inline and press Enter; new files open immediately.

Housekeeping is invisible: internal folders like `.git` and the build cache never appear in the tree, and symlinks are not followed.

## The right-click menu

On a **file**:

- **Open**
- **Set as main document** (available for `.tex` files): makes this file the compile entry point and moves the star.
- **Rename**: edit the name inline. Open tabs, unsaved edits, and the main-document pointer all follow the rename.
- **Make a copy**: creates `name copy.tex` next to the original. Works byte-for-byte, so images and other binaries copy safely.
- **Delete**: removes the file after a confirmation. This cannot be undone from the app, though [Git history](/OpenLeaf/git-history/) can bring back anything you had committed.

On a **folder**: **New file**, **New folder**, **Rename**, **Make a copy** (copies the whole folder recursively), and **Delete**.

## Moving things: drag and drop

Drag any file or folder onto another folder to move it inside, or onto the empty area at the bottom of the tree to move it to the project root. Drop targets highlight as you hover. OpenLeaf refuses moves that would put a folder inside itself.

## Tabs

Open files appear as tabs above the editor, in the order you opened them. A dot on the tab means unsaved changes are pending (they'll autosave in a moment). Git [diff views](/OpenLeaf/git-history/#the-diff-viewer) open as tabs in the same strip, labeled with the file name plus `(Index)` or `(Working Tree)`.

Closing the active tab activates the previous one. Undo history never crosses files: each file keeps its own.

## How different file types open

- **LaTeX and text files** (`.tex`, `.sty`, `.cls`, `.bib`, `.md`, and friends) open in the editor with syntax highlighting matched to the extension.
- **Images** (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`, and more) open as a rendered picture.
- **PDFs** open in the PDF viewer.
- **Opaque binaries** (`.zip`, `.eps`, font files) show a "Binary file. No preview available." notice rather than risking corruption by loading them as text.
- **`.bib` files** are also parsed in the background the moment a project opens, which is what powers [citation autocomplete](/OpenLeaf/citations/#autocomplete-from-your-bib).

## Autosave

You never press save. Edits write to disk about 1.5 seconds after you pause typing, and OpenLeaf goes further than a simple timer:

- Edit file A, switch to file B before the timer fires, and A still saves.
- Closing or reloading the app flushes every pending save first, so a quit inside the debounce window loses nothing.
- Compiling saves the active file first, so the PDF always reflects what you see.

## Adding existing files

Files currently enter a project by being created in the app, saved from the [PDF preview](/OpenLeaf/pdf-preview/#save-the-pdf-into-the-project), produced by the [diagram composer](/OpenLeaf/figures-diagrams/), or written by the [AI assistant](/OpenLeaf/ai-chat/). There is no upload button yet.

Because a project is a plain folder, the practical workaround is direct: drop your images or `.bib` into `~/.openleaf/projects/<project>/` with your file manager, then reopen the project so OpenLeaf picks them up. Do the copy while the project is closed (or reopen right after), since the app's autosave writes what it has in memory.
