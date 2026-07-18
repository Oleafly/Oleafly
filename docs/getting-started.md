# Getting started with Oleafly

In about two minutes you'll have a project open, compiled, and exporting a PDF. Everything runs locally, so you don't need an account or an internet connection to write or compile.

## 1. Install

Download the app for your platform from the [latest release](https://github.com/prajwal-svm/OpenLeaf/releases/latest): a `.dmg` for macOS (Apple Silicon), a `.msi` or `-setup.exe` for Windows, or an `.AppImage`, `.deb`, or `.rpm` for Linux. Open it and you're ready. The builds aren't signed yet, so your OS warns on first launch; the [install guide](install.md#first-launch) has the one-time unlock for each platform.

Prefer to build from source? See [Build from source](install.md#build-from-source) in the install guide.

The first compile fetches LaTeX packages (a few hundred MB) and caches them, so every compile after that is fully offline.

## 2. Create your first project

1. On the Library home, click New from template.
2. Pick a starter:
   - Blank document: a minimal article.
   - One-Page Resume: an ATS-safe single-page resume.
   - IEEE Research Paper: a two-column conference paper with a `.bib`.
3. Give it a name and open it.

## 3. Write and compile

Type in the editor on the left. Auto-compile runs a couple of seconds after you stop typing. Press ⌘↵ (Ctrl+Enter) to recompile immediately. The PDF on the right updates live, with zoom, fit-to-width, and page navigation.

## 4. Jump between source and PDF (SyncTeX)

Source to PDF: put your cursor somewhere and press ⌘⇧J (or click the arrow on the divider). The PDF scrolls to the matching spot and highlights it.

PDF to source: ⌘/Ctrl-click anywhere on the PDF to jump the cursor there in the editor.

## 5. Export

Click the Download icon in the toolbar, then Download as PDF. The output is ATS-clean by default: real selectable text, embedded subset fonts. For Word/HTML/Markdown, install pandoc and use the same menu.

You can also create a blank **Markdown** project from the library. Oleafly
compiles its `main.md` (or `main.markdown`) to PDF with Pandoc and the bundled
Tectonic engine. The first compile offers the same on-demand Pandoc download
used by document export. If that download is unavailable, the error links to
Pandoc's manual installation guide. Markdown projects keep the normal local
Git history and PDF preview, but do not offer SyncTeX, offline mode, or isolated
figure compilation.

## 6. Where your files live

Every project is a plain folder under `~/.openleaf/projects/<id>/` containing your `.tex`, `.bib`, images, and a real `.git` repository. They're just files, so you can browse, copy, or back them up with any tool.

---

Next: the full [Features](features.md) list, the [AI Assistant](ai-assistant.md), or [GitHub Sync](github-sync.md).
