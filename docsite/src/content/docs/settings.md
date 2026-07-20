---
title: "Settings reference"
description: "Every Oleafly setting: General, Appearance, Dictionary, Data Storage, AI Assistant, LaTeX Engine, Offline & Downloads, GitHub, Keyboard Shortcuts, MCP, and Help & About."
---

Open Settings from the gear in the rail, `/settings` in the search omnibar, or **Open settings** in the ⌘K palette. General appears first. Turn on **Show Advanced** at the bottom of the navigation to reveal every section.

## General

| Setting | Type | Default | What it does |
|---|---|---|---|
| **Enable tour guides** | Expandable toggle | On | Shows the five context-aware guides. Expand it to enable or disable Home, Workspace, Settings, AI Assistant, and Diagram Composer separately, see progress, or dismiss all tours. Re-enabling starts the current Home or Project guide from the beginning. |
| **Vim mode** | Toggle | Off | Full Vim keybindings in the editor. |
| **Spellcheck** | Toggle | On | Hunspell spelling underlines; active only when Harper is off. |
| **Spelling, grammar & style (Harper)** | Toggle | On | The full offline [grammar checker](/Oleafly/spellcheck-grammar/). |
| **Regionalism suggestions** | Toggle | On | Flag British vs. American usage (shown when Harper is on). |
| **Word-choice suggestions** | Toggle | On | Catch word mix-ups like "too" vs. "to" (shown when Harper is on). |
| **Offline mode** | Toggle | Off | Compile with `--only-cached`; the compiler never touches the network, and [citation lookups](/Oleafly/citations/) are blocked. |

**Reset settings** restores Appearance and General preferences to their defaults after confirmation.

## Appearance

| Setting | Type | Default | What it does |
|---|---|---|---|
| **Dark mode** | Toggle | Follows your OS | Light or dark theme. Also togglable from the rail and the ⌘K palette. |
| **Editor font size** | 11 to 20 px | 13px | Text size in the code editor. |
| **App font size** | 13 to 20 px | 16px | Scales the whole interface: menus, panels, buttons. |
| **App font** | Select | System default | Interface font: Inter, Helvetica Neue, Segoe UI, Georgia, or system. |
| **Editor font** | Select | System default | Editor monospace: JetBrains Mono, Fira Code, Cascadia Code, SF Mono, Menlo, Consolas, or system. |
| **Open projects in** | Select | Split view | The layout a project opens with: Split view, Editor only, or PDF only. |
| **Show file tree on open** | Toggle | On | Reveal the Source Tree whenever a project opens. |
| **Preview PDF on hover** | Toggle | On | The library's page-one [hover previews](/Oleafly/library/#hover-previews). |
| **Accent color** | Swatches | Blue | The highlight color everywhere: Blue, Green, Purple, Rose, Orange, or Teal. |

## Dictionary

Every word you told the [spellchecker](/Oleafly/spellcheck-grammar/#fixing-and-ignoring) to ignore, in two groups: **This project** and **All projects**. Remove a chip to start flagging that word again.

## Data Storage

Shows where your library lives on disk (`~/.openleaf/projects`) and explains the local-first layout, with a shortcut to the GitHub section. Development builds also provide a Finder shortcut beside the path. Cloud sync is listed as coming soon. The full storage story is on [Where your data lives](/Oleafly/where-your-data-lives/).

## AI Assistant

Provider cards for all nine providers, the model picker, the Ollama detector, custom instructions, and a reference list of the assistant's tools. Documented in depth on [Set up AI](/Oleafly/ai-setup/).

## LaTeX Engine

The tagged/accessible export engine: system LuaLaTeX detection, the one-click **Install TinyTeX (~100 MB)** (and its delete button), and the `tlmgr` package manager with tagging-compatibility badges. Documented on [LaTeX engines & packages](/Oleafly/latex-engines/).

## Offline & Downloads

The on-demand font packs used by richer [templates](/Oleafly/templates/#on-demand-fonts-the-setup-badge): each row shows the font, its size, its open-source license, and a **Download** or **Remove** button, plus a **Download all** for pre-loading everything before a flight. (The LuaLaTeX engine has its own section above.)

## GitHub

Account connection (device flow or personal access token) and, with a project open, that project's repository controls: remote URL, **Push**, **Pull**, **Unlink**, and **Create & link**. Documented on [GitHub sync](/Oleafly/github-sync/).

## Keyboard Shortcuts

Shows the complete searchable shortcut reference and lets you record new key combinations for Recompile, Command palette, Search all documents, Go to PDF, and Shortcut reference. Select the displayed keys to start recording, press the new combination, or use the reset control for one shortcut or all application shortcuts. Editor-native shortcuts remain managed by the editor. See [Keyboard shortcuts](/Oleafly/keyboard-shortcuts/).

## MCP

Turn Oleafly into a local MCP server so an external agent (Claude Desktop, Claude Code, Cursor, Grok) can drive your project with no API key. **Enable MCP server**, the automatically selected local port, bearer-token controls, copy-paste connection snippets, the **approval policy**, **Read-only mode**, and pointers to the `mcp.json` on disk all live here. The restart icon reuses the current port when available or selects another free port. Documented on [Connect via MCP](/Oleafly/mcp/).

## Help & About

- Version info and the **Check for updates** flow ([Updates](/Oleafly/updates/)).
- **Copy version & system info**: one click to copy exactly what a bug report needs.
- Resources: Start tour, Documentation, Report a bug, Report a crash (with log pointers), What's new, and the License.

## Where settings live

App preferences are per-machine (stored locally, like everything else). Project-specific state (name, main document, cover color) lives in each project's own `project.json`, so it travels with the project.
