---
title: "FAQ & troubleshooting"
description: "Common questions about accounts, offline use, ATS output, compiling, AI providers, GitHub sync, backups, and what to do when something misbehaves."
---

## General

### Do I need an account?
No. Oleafly has no accounts and no login. Install it and write. See the [Philosophy](/OpenLeaf/philosophy/).

### Does it need the internet?
Only for a few explicit things: fetching a LaTeX package the first time a document uses it, [citation lookups](/OpenLeaf/citations/), cloud AI providers (local Ollama excepted), GitHub sync, and update checks. Writing, compiling (after first fetch), spellcheck, grammar, diagrams, and Preflight all run offline. **Offline mode** (Settings, General) guarantees the compiler never touches the network.

### Where are my files?
Plain folders under `~/.openleaf/projects/`, each with your `.tex`, `.bib`, images, and a real `.git` repo. Back them up, copy them, or open them with other tools freely. See [Where your data lives](/OpenLeaf/where-your-data-lives/).

### Is the PDF output ATS-friendly?
Yes. The Tectonic engine emits real selectable Unicode text with embedded subset fonts, and the ATS-badged resume [templates](/OpenLeaf/templates/#resume-templates-and-ats) follow single-column, linear-reading-order rules. Then [Preflight](/OpenLeaf/preflight/) shows you exactly what a parser extracts from your PDF, so you're not taking anyone's word for it.

### How is this different from Overleaf?
Short answer: everything runs on your machine, offline, for free, with your files in real Git repos. Long answer with tables: [Why Oleafly](/OpenLeaf/why-oleafly/).

## Install

### macOS says the app is damaged or can't be checked
The builds aren't notarized yet. Right-click the app and choose **Open**, or clear the quarantine flag once; the exact commands are in the [install guide](/OpenLeaf/install/#first-launch).

### Windows SmartScreen blocks it
Click **More info**, then **Run anyway**. Same cause: unsigned builds, on the roadmap.

### Which Linux distributions work?
Anything 2024-era or newer (glibc 2.39+): Ubuntu 24.04+, Fedora 40+, Debian 13+. AppImage, deb, and rpm are all published.

## Compiling

### My first compile is slow
That's the one-time package fetch: Tectonic downloads what your document needs and caches it. Every compile after that is fast and offline. See [Compiling](/OpenLeaf/compiling/#packages-fetched-once-cached-forever).

### A package is missing and the compile errors out
If Offline mode is on, turn it off for one compile so the package can be fetched and cached, then turn it back on.

### The compile succeeded but with warnings. Do I care?
You still got a PDF (the amber chip tells you). Click **Logs** to read them; undefined references and citations are the warnings most worth fixing, and [Preflight](/OpenLeaf/preflight/#references--assets) pinpoints those precisely.

### An error I don't understand
Open **Logs** for the parsed error list, or just ask the AI: "fix the LaTeX errors" runs a compile-read-fix-verify loop with your approval on every change.

### Word/HTML/Markdown export needs pandoc?
Yes, and Oleafly downloads it for you automatically on first use. No manual install. See [Export formats](/OpenLeaf/export/).

## AI assistant

### Which providers work?
OpenAI, Anthropic, Z.AI (GLM), Groq, OpenRouter, DeepSeek, Mistral, xAI, and Ollama for fully local models. Models and setup: [Set up AI](/OpenLeaf/ai-setup/).

### The AI says it has no key / errors on send
Open Settings, AI Assistant and check that a provider has a saved key and the green **Active** badge. The error messages themselves usually say what's wrong: invalid key, empty balance, or rate limit.

### Can I run it fully offline?
Yes: install Ollama, `ollama pull llama3.2`, then **Check for Ollama** in settings. No key, no cloud.

### Can the AI change my files without asking?
No. Every file-changing tool pauses for your approval with a diff, and the assistant checkpoints your project in Git before its first edit. See [Chat & tools](/OpenLeaf/ai-chat/#you-approve-every-change).

## GitHub sync

### I don't see a device code when connecting
Try again in a moment, or use the PAT route under "Advanced: use a personal access token" in Settings, GitHub.

### Push fails with "No remote 'origin'"
Publish the project first (Source Control, **Publish to GitHub**). Push and Pull need a remote to exist.

### Push says the remote has commits
Pull first, then push. The ahead/behind indicator next to the branch pill warns you before this happens.

### Can I sync across two computers?
Yes: push on one, pull on the other. The workflow is spelled out in [GitHub sync](/OpenLeaf/github-sync/#two-computers).

### A pull hit a merge conflict
Oleafly shows the raw Git message and leaves resolution to you: fix it with any Git tool (the project is a normal repo), then keep working in the app.

## Data & backups

### How do I back everything up?
Add `~/.openleaf/projects/` to your normal backup, export a `.zip` per project, or push to GitHub. All three, ideally. See [Where your data lives](/OpenLeaf/where-your-data-lives/#backing-up).

### I deleted a project. Can I get it back?
Deleting removes the folder from disk, so: from your backup or from GitHub if you pushed it. Files deleted *inside* a project can come back via [Git history](/OpenLeaf/git-history/#history-and-restore) if they were ever committed.

### Can I edit project files with another editor?
Yes, they're plain files. Do it while the project is closed in Oleafly (or reopen it afterward), so the app's autosave doesn't overwrite your external changes with what it had in memory.

## Still stuck?

- Search the [issues](https://github.com/prajwal-svm/OpenLeaf/issues).
- The app logs errors to `~/.openleaf/app.log`; include the relevant snippet in a report.
- Open a [new issue](https://github.com/prajwal-svm/OpenLeaf/issues/new) with steps to reproduce and your OS.
