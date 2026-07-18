---
title: "Where your data lives"
description: "The ~/.openleaf folder explained: project layout, metadata, caches, logs, and how to back up or migrate everything with ordinary tools."
---

Oleafly keeps everything in one place, in plain files you can inspect, copy, and back up with any tool you already use. This page is the map.

## The layout

```
~/.openleaf/
├── projects/
│   └── flying-pink-pikachu/      one folder per project, random readable name
│       ├── main.tex              your source files, at the root
│       ├── references.bib
│       ├── figures/
│       ├── project.json          project metadata (see below)
│       ├── .openleaf/build/      compile cache (PDF, logs, SyncTeX)
│       └── .git/                 the project's real Git repository
├── assets/                       fonts downloaded on demand for templates
├── bin/                          helper tools fetched on demand (pandoc)
├── tinytex/                      the optional LuaLaTeX engine, if installed
└── app.log                       the app's error log
```

## Projects are the folder, full stop

A project is exactly its folder under `~/.openleaf/projects/`. Copy the folder and you've copied the project, history included. Delete it and it's gone. There is no hidden database that has to stay in sync.

`project.json` holds the small amount of metadata Oleafly tracks per project: the display name, which file is the main document, the cover color you picked in the library, the project kind, and your export history. It's ordinary JSON; the worst that happens if you edit it badly is that Oleafly regenerates sensible defaults.

The `.openleaf/build/` subfolder is a disposable compile cache (the compiled PDF, the log, SyncTeX data). It's ignored by Git and safe to delete anytime; the next compile recreates it.

## Backing up

Three good options, in increasing order of robustness:

1. **Copy the folder.** `~/.openleaf/projects/` into your normal backup routine (Time Machine, restic, a synced drive) covers everything.
2. **Use the zip export.** The Export menu's **Export source (.zip)** produces a clean archive of one project's sources, without caches.
3. **Push to GitHub.** [GitHub sync](/OpenLeaf/github-sync/) gives each project an off-machine copy with full history, and it's the right tool for moving between computers.

## Moving to a new machine

Install Oleafly, then either pull your projects from GitHub or copy your old `~/.openleaf/projects/` folder into place. Cover colors, main-document choices, and history all travel with the folders. App-level preferences (theme, fonts, AI keys) are per-machine and take a minute to reset in [Settings](/OpenLeaf/settings/).

## The log file

`~/.openleaf/app.log` records errors the app hits. If you ever report a bug, the relevant snippet from this file is the single most useful thing to include. Settings, Help & About has a **Report a crash** shortcut that points you to it.

## What never leaves this folder

Your documents, your Git history, your AI keys, and your GitHub token all live locally. The [Philosophy](/OpenLeaf/philosophy/) page covers exactly which features talk to the network and what they send.
