---
title: "The library"
description: "Your home screen: projects as books with covers and colors, bookmarks, hover previews, forking, renaming, deleting, and search across everything."
---

The library is Oleafly's home screen. Every project appears as a book on a shelf, sorted by most recently modified, and everything you need to manage projects happens here.

## The shelf

Each project is a colored book with a spine and page edges, showing the project name and when it was last updated. Hovering a book tilts it in 3D; the ink color adjusts automatically so names stay readable on any cover color.

The grid adapts to your window: two, three, or four columns.

![The library shelf with project books](/OpenLeaf/media/library-shelf.png)

First time in the app? You'll see a welcome card instead: **"Create your first project"** opens the [template gallery](/OpenLeaf/templates/).

## Creating a project

Click **New project** in the header. The template gallery opens with 19 starting points across categories like CVs & Resumes, Journals & Conferences, Theses & Reports, and Presentations. Pick one, name the project, choose a cover color, and you're writing. The gallery is covered in detail on the [Templates](/OpenLeaf/templates/) page.

You can also open the gallery from anywhere with the search omnibar: press **⌘⇧F** (Ctrl+Shift+F) and type `/create`.

## Hover previews

Hover a book and the first page of its last compiled PDF slides across the cover, so you can tell your papers apart at a glance. Previews come from the real compiled output and are cached, so the shelf stays fast.

If you'd rather not see them, turn off **Preview PDF on hover** in Settings, Appearance.

## Bookmarks

Hover a book and click its star to bookmark the project. The bookmark toggle in the header (**Show bookmarked only** / **Show all projects**) filters the shelf down to your starred set, which is handy once the shelf grows past a dozen projects.

## The right-click menu

Right-click any book:

- **Open project**
- **Change book color**: eleven cover swatches (Blue, Cream, Peach, Rose, Pink, Lilac, Sky, Aqua, Cyan, Mint, Spring). The color is stored in the project itself, so it travels with the project if you sync it to another machine.
- **Fork project**: copies the project and its full Git history into a new project. The dialog suggests `<name> (copy)`; give it any name you like. Forking is the fastest way to start "version 2" of a resume or to experiment on a paper without touching the original.
- **Delete project**: removes the whole project folder from disk after a confirmation. This cannot be undone, so if the project matters, [push it to GitHub](/OpenLeaf/github-sync/) first.

## Renaming a project

Open the project and click its title in the top toolbar. It becomes editable in place: type the new name and press Enter. The rename is saved to the project's own metadata.

## Search from the library

The header's search icon (or **⌘⇧F** / Ctrl+Shift+F anywhere) opens the search omnibar, which finds projects by name and searches the full text of every document in every project, jumping straight to the matching file and line. Type `/` in the omnibar for scoped commands like `/projects`, `/docs`, or `/create`.

## Also in the header

- **Theme toggle**: switch light and dark mode.
- **Settings**: the gear opens the full [settings](/OpenLeaf/settings/) window.

## Where the shelf lives on disk

Every book is a plain folder under `~/.openleaf/projects/`, with a human-readable random name like `flying-pink-pikachu`. Nothing about the library is proprietary: see [Where your data lives](/OpenLeaf/where-your-data-lives/).
