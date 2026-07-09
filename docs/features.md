# Features

What OpenLeaf can do. All of it runs on your machine.

## Editor (CodeMirror 6)

- LaTeX autocomplete for commands, `\ref`/`\label`, and `\cite` (parsed from your `.bib`), plus file names from the tree. Press Ctrl-Space to trigger.
- Slash commands: type `/` for a Notion-style insert menu with `/figure`, `/table`, `/section`, `/cite`, and `/math`.
- Find and replace with `⌘F`: a VSCode-style widget with case, whole-word, and
  regex toggles, a live match count, and a collapsible replace row. Go to line
  with `⌘⇧L`.
- Code folding: click the gutter arrow to collapse a `\begin…\end` environment or
  a section (folds until the next same-or-higher-level section).
- Vim mode, toggled in Settings → Appearance (or the `⌘/` shortcuts).
- Spellcheck via Hunspell (WASM). It underlines misspellings and skips commands, math, and comments.
- Linting: compile errors show up as red squiggles and gutter marks. Click one to jump to it.

## Code intelligence

OpenLeaf understands your whole project, not just the open file.

- Go to definition: press F12 (or Cmd/Ctrl-click) on a `\ref`, `\cite`, `\gls`,
  a custom macro, or a `\begin{env}` to jump to where it is defined, across files.
- Find references: Shift-F12 (or right-click, Find references) lists every use of
  a label, citation, or macro in a side panel; click to jump.
- Rename symbol: F2 renames a label, citation key, or macro and updates every use
  across the project in one step, and warns if the new name already exists.
- Hover intelligence: hover a `\ref`, `\cite`, or macro to see what it points to
  and where it is defined. Hold Cmd/Ctrl to underline it as a clickable link.
- The AI assistant can call a project map tool to see the outline, labels,
  citations, macros, and file graph, so it reasons about the whole paper.

## Compile pipeline

- Tectonic (XeTeX) runs as a bundled sidecar and produces ATS-clean output with embedded subset fonts.
- Auto-compile is debounced at roughly 2.5s. Recompile manually with `⌘↵`.
- Offline mode (Settings → General) compiles with `--only-cached` and never touches the network.
- The error log is parsed into editor diagnostics, and the AI can read and fix them.

## PDF preview (pdf.js)

- Continuous scroll, zoom in and out, fit-to-width, fit-to-height, page navigation, and fullscreen.
- Download PDF (with a custom filename) and download source as a `.zip`.
- SyncTeX overlay for bidirectional source↔PDF navigation.

## Preflight: ATS and accessibility checks

Open the Preflight panel (the shield icon in the sidebar) to see how ready your
document is for the two audiences that fail on the same underlying defects:
automated resume parsers (ATS) and screen readers.

- Two scores: ATS readiness and Accessibility, each out of 100.
- Source checks: two-column and multi-column layouts, missing image alt text,
  font icons that hide your email or phone, tables or TikZ used for layout,
  contact info stuck in a page header, non-descriptive link text, missing
  document language or PDF title, skipped heading levels, and more.
- Output checks (after you compile): columns that read across in the PDF,
  garbled or unmapped text, pages with no selectable text, and missing PDF
  language or title.
- What the reader sees: a plain-text preview of the compiled PDF in reading
  order, the same thing a parser or screen reader gets.
- What a parser extracted: for resumes, a simulation of what an Applicant
  Tracking System pulls out of your PDF (name, email, phone, links, and which
  standard sections it detected), so you can spot missing contact details or a
  Work Experience section that a parser cannot see.
- Output accessibility verdict: after compiling, a clear answer on whether the
  PDF is Section 508 / PDF-UA ready, with a full tag-tree audit when a tagged
  PDF is present.
- References & assets check: finds undefined citations and cross-references,
  duplicate labels, and missing figure or included files, before they break your
  PDF at submission.
- Each check is independent: an accordion with a checkbox to enable it, a Run
  button for that check, and a Run button for all enabled checks together. The
  panel opens instantly and the relevant check is pre-selected from your document
  type. An info icon explains what each check does.
- Prepare for accessible export: one click rewrites your document with the setup
  a tagging engine needs (the \DocumentMetadata first line, unicode-math, and
  alt-text placeholders) and shows every change before you apply it. Compile the
  prepared source with LuaLaTeX (TeX Live 2025 or newer) to get a tagged,
  Section 508 / PDF-UA oriented PDF, then re-check it here.
- Optional LuaLaTeX engine: Settings, LaTeX Engine uses a TeX Live you already
  have, or installs TinyTeX (about 100 MB) on demand with no admin rights, so
  Preflight can compile a tagged PDF and verify it in one step. It includes a
  package manager, and you can delete the engine any time to free space. The
  default Tectonic engine is unchanged if you do not need tagging.
- Source-level issues also show as inline squiggles in the editor.

A clean check means your document is ready for parsers and screen readers. It is
a readiness aid, not a formal accessibility certification.

## Projects and library

- Library home lists all projects with thumbnails, last-edited time, and export history.
- Templates: Blank, One-Page Resume, and IEEE Paper.
- Source tree: create, rename, delete, duplicate, drag-drop, upload, and pick the main document.
- Multi-file support for `\input`, images (PNG/JPG/PDF/EPS), `.bib`, and editor tabs.
- Autosave writes your changes to disk shortly after you stop typing.

## History (Git-backed)

Every project is a git repo, and OpenLeaf auto-commits on save. So you get:

- A history view with the full commit log.
- Side-by-side diffs, unified or split.
- Restore: one click rolls a file back to any commit.

## Source control and sync

- See changed files, stage or discard them, write a message, and Commit, Push, or Pull.
- Publish to GitHub: create a new repo or link an existing one, then push. See [GitHub Sync](github-sync.md).
- Ahead/behind indicators tell you when to pull.

## AI assistant

A chat assistant that can actually _do_ things to your project:

- Read and write files, find-and-replace, create, rename, and delete.
- Compile, read the log, and extract PDF text to verify output.
- Search across all projects, set the main doc, and toggle the theme.
- Every file-changing edit pauses for approval with a red/green diff preview, and the decision stays visible in the chat.
- Add your own custom instructions, sandboxed so they cannot reveal or override the built-in prompt.

Bring any provider: OpenAI, Anthropic, Groq, OpenRouter, DeepSeek, Mistral, xAI, Z.AI, or run locally with Ollama. See [AI Assistant](ai-assistant.md).

## Export

- PDF, always, ATS-clean.
- Word (.docx), HTML, and Markdown via pandoc, which you install separately.

## Theming

Light and dark mode (it respects your system setting) with Geist design tokens. Toggle it anytime from the rail or Settings.

## Command palette

Press `⌘K` to fuzzy-search every action: new file, compile, switch view, go-to-line, toggle theme, insert figure, and more.
