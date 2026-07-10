# Features

What OpenLeaf can do. All of it runs on your machine.

## Editor (CodeMirror 6)

- LaTeX autocomplete for commands, `\ref`/`\label`, and `\cite` (parsed from your `.bib`), plus file names from the tree. Press Ctrl-Space to trigger.
- Slash commands: type `/` for a Notion-style insert menu with `/figure`, `/table`, `/section`, `/cite`, and `/math`.
- Find and replace with `⌘F`: a VSCode-style widget with case, whole-word,
  regex, and preserve-case toggles, a live match count, and a collapsible replace
  row. Go to line with `⌘⇧L`.
- Code folding: click the gutter arrow to collapse a `\begin…\end` environment or
  a section (folds until the next same-or-higher-level section).
- Vim mode, toggled in Settings → Appearance (or the `⌘/` shortcuts).
- Spellcheck (Hunspell) and grammar (Harper) run entirely offline as WASM. They underline issues and skip commands, math, and comments.
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

- Continuous scroll with single-page or two-page (spread) layouts, switchable from the toolbar like a desktop PDF reader.
- Zoom in and out with the buttons or a trackpad pinch, plus fit-to-width and fit-to-height.
- Page navigation in the toolbar: the current page and total ("6 of 100"), previous and next, and a jump-to-page box.
- The viewer is virtualized: it only renders the pages near your viewport, so it stays smooth and light on memory even for documents hundreds of pages long, like a thesis or a book.
- Presentation (fullscreen) mode, and an invert-colors toggle for late-night reading.
- Download PDF (with a custom filename) and download source as a `.zip`.
- Bidirectional SyncTeX: Cmd/Ctrl-click a word in the PDF to land on that exact word in the source, or jump from the cursor to the matching spot in the PDF.

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
  duplicate labels, duplicate bibliography entries (two keys sharing a DOI), and
  missing figure or included files, before they break your PDF at submission.
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
- Template gallery: creating a project opens a browsable gallery, organized by
  category (CVs & Resumes, Journals & Conferences, Theses & Reports, Books,
  Presentations, Posters, Letters), with search, an ATS-friendly filter, and a
  page-1 preview of every template. Pick one, then name the project and choose a
  cover color. The starter set spans clean, ATS-friendly resumes, a polished
  software engineer resume, a Modern resume set in Lato, and a photo-and-sidebar
  design resume; a full worked IEEE paper, ACM and Elsevier journal articles, and
  a minimalist academic article; a thesis/report, a book, a Beamer deck, a
  research poster, a homework assignment, a two-column newsletter, a monthly
  calendar, a bibliography starter, and a formal letter. Templates ship as
  editable source.
- On-demand fonts: richer templates use premium open-source fonts (Lato, PT Sans,
  PT Serif) that download only when needed, so the app stays small. Creating such
  a template fetches the fonts (with progress) and copies them into the project's
  `fonts/` folder, so it stays self-contained and compiles offline. Manage these
  in Settings, Offline & Downloads (pre-download, or remove to free space).
- Source tree: create files and folders (nested to any depth), rename, delete, and duplicate (files and whole folders). Right-click a folder to add a file or folder inside it, and drag files and folders in and out of folders to reorganize. Upload files, and pick the main document.
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

## Citations

- Add citation: open it from the command palette ("Add citation") or the citation
  button in the editor toolbar. Paste a DOI, arXiv id, or URL to fetch the entry
  directly, or type a title to search Crossref and pick a result.
- OpenLeaf appends a correctly-keyed BibTeX entry to your project's `.bib`,
  deduplicated by DOI, and inserts the `\cite` at your cursor.
- Autocomplete for `\cite` keys is parsed from your `.bib` files as you type.
- Lookups send only the identifier or title (to doi.org, arXiv, or Crossref) and
  respect offline mode.

## AI assistant

A chat assistant that can actually _do_ things to your project:

- Read and write files, find-and-replace, create, rename, and delete.
- Compile, read the log, and extract PDF text to verify output.
- Search across all projects, set the main doc, and toggle the theme.
- Every file-changing edit pauses for approval with a red/green diff preview, and the decision stays visible in the chat.
- Add your own custom instructions, sandboxed so they cannot reveal or override the built-in prompt.

Bring any provider: OpenAI, Anthropic, Groq, OpenRouter, DeepSeek, Mistral, xAI, Z.AI, or run locally with Ollama. See [AI Assistant](ai-assistant.md).

## Draw with AI (figures)

Turn a description (or a selected paragraph) into a publication-quality figure. Toggle figure mode in the AI panel (the spark icon), pick "Generate a figure with AI" from the omnibar, or right-click a paragraph and choose "Generate figure from selection". The assistant drafts TikZ, compiles just the figure in isolation (so your main document is never disturbed), and inserts editable LaTeX at your cursor when you accept, along with a `figures/<name>.png` copy.

With AI it works at two levels:

- **Text-only models.** The assistant generates and refines from the compile errors and log, while you steer using the preview shown in the approval card.
- **Vision models.** After each compile the assistant looks at the rendered figure and fixes overlaps, spacing, and alignment on its own before you accept.

You can also drop a hand-drawn sketch into the project and ask the assistant to reproduce it as a clean figure.

## Insert diagram (visual editor + code, no AI)

Next to the compile button is an **Insert diagram** button (also in the omnibar) that opens a full-height composer with two ways to build a figure, and a live compiled preview on the right:

- **Draw** — a visual editor (drag rectangles, circles, ellipses, diamonds, and text; connect them with arrows; style fill, border, and colors; snap to grid; undo/redo). It generates clean TikZ as you draw, so you get GUI speed with LaTeX-native fonts and vector output.
- **Code** — a real LaTeX editor (syntax highlighting, gutter, TikZ snippet toolbar) for writing or fine-tuning TikZ by hand.

Give the diagram a name, then insert it **as vector code** (TikZ straight into your document) or **as an image** (`\includegraphics` of a saved `figures/<name>.png`, with a PNG scale and transparent-background option). Either way the source is preserved as `figures/<name>.tikz`.

Drawn diagrams **round-trip**: the saved `.tikz` embeds the diagram model, so the **Load** button re-opens it in the visual editor, fully editable (the way draw.io ships editable exports). The name prompt prevents overwriting an existing figure. No API key required, works offline.

## Export

- PDF, always, ATS-clean, and the full source as a `.zip`.
- Document formats via pandoc (downloaded on demand the first time): Word
  (`.docx`), a self-contained HTML file with MathML, Markdown, and plain text.
- Context-aware formats based on the document: presentations (Beamer) can export
  to PowerPoint (`.pptx`), with each frame becoming a slide; books, reports, and
  theses can export to EPUB (`.epub`) with a table of contents.

## Theming

Light and dark mode (it respects your system setting) with Geist design tokens. Toggle it anytime from the rail or Settings.

## Command palette

Press `⌘K` to fuzzy-search every action: new file, compile, switch view, go-to-line, toggle theme, insert figure, and more.

## Updates

Settings, Help & About shows the version you're running and checks for a newer release. When one is available, it downloads and installs in place from a signed update feed the app verifies first. You can also trigger a check from the app menu.
