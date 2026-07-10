# Changelog

All notable changes to OpenLeaf are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **PDF page navigation** - the preview toolbar now shows the current page and
  total (like "6 of 100"), with previous and next buttons and a jump-to-page
  box, next to the zoom controls, so you can move through long documents without
  scrolling.
- **PDF view layouts** - a view toggle in the preview toolbar switches between
  single-page and two-page (spread) continuous scroll, like a desktop PDF
  reader.
- **Pinch to zoom the PDF** - a trackpad pinch zooms the preview in and out
  (only over the PDF area), alongside the existing zoom buttons.
- **Smooth large documents** - the PDF preview is virtualized: it only renders
  the pages near the viewport (with a hard cap, evicting the farthest), so a
  hundreds-of-pages thesis or book scrolls smoothly with bounded memory.
- **Auto-citation** - add a reference by pasting a DOI, arXiv id, or URL (fetched
  directly), or by typing a paper title to search Crossref and pick a result.
  OpenLeaf appends a correctly-keyed BibTeX entry to your project's .bib
  (deduplicated by DOI, so the same paper is never added twice) and inserts the
  \cite at your cursor. Open it from the command palette ("Add citation") or the
  citation button in the editor toolbar. Only the identifier or title is sent, to
  doi.org, arXiv, or Crossref, and it respects offline mode.
- **Duplicate bibliography detection** - the References check now flags two `.bib`
  entries that share a DOI (the same paper under two keys), and a References
  button was added to the sidebar rail to reopen the find-references results.

- **Code intelligence (project index)** - OpenLeaf now builds a live index of the
  whole project (sections, `\label`s, `\ref`/`\cite`s, `.bib` entries, `\newcommand`
  macros, theorems, glossary entries, and the `\input` graph). It powers:
  go-to-definition (F12 or Cmd/Ctrl-click) that jumps from a `\ref`, `\cite`, or
  macro use to its definition across files; find-references (Shift-F12) that lists
  every use in a side panel; and rename-refactor (F2) that renames a label,
  citation key, or macro and updates every use project-wide, with a collision
  check. The AI assistant also gains a project_map tool so it can reason about the
  whole document, not just the open file. The index rebuilds from an in-memory
  cache as you type, so it stays fresh without slowing editing. Hovering a
  reference shows what it points to, and Cmd/Ctrl-hover underlines it as a link.
- **VSCode-style find and replace** - `⌘F` now opens a compact widget with icon
  toggles for case, whole-word, and regex, a live match count, prev/next and
  select-all, and a collapsible replace row.
- **Code folding** - click the gutter arrow to collapse a `\begin...\end`
  environment or a section (folds until the next same-or-higher-level section);
  fold and unfold at the cursor with `Ctrl ⇧ [` / `Ctrl ⇧ ]`.

- **Preflight: ATS and accessibility checks** - a new Preflight panel (shield
  icon in the sidebar). It opens instantly and, like a page-speed report, lets
  you pick which checks to run: ATS readiness (for resumes) and Accessibility
  (for research and published PDFs), pre-selected to match your document. Run on
  demand and it reads your source and compiled PDF and reports how ready the
  document is: an ATS-readiness score and an accessibility score, flagging issues
  like two-column layouts, missing image alt text, icons that hide contact info,
  garbled ligatures, and missing PDF language or title, plus a "what the reader
  sees" plain-text preview of the compiled PDF. Source-level issues also appear
  as inline squiggles in the editor. Checks are a readiness aid, not a formal
  accessibility certification.
- **Preflight: what a parser extracted** - for resumes, Preflight now simulates
  what an Applicant Tracking System pulls from your compiled PDF: the name,
  email, phone, and links it captured, and which standard sections (Experience,
  Education, Skills, and so on) it could detect, so you can see at a glance if a
  parser would miss your contact details or work history.
- **Preflight: output accessibility verdict** - after compiling, Preflight gives
  a clear answer on whether the PDF is Section 508 / PDF-UA ready. When a tagged
  PDF is present it audits the tag tree (figure alt text, table headers, heading
  nesting); on untagged output it says so plainly instead of leaving you
  guessing. Findings are now grouped into Source and Compiled output.
- **Preflight: prepare for accessible export** - one click rewrites your
  document into a form a tagging engine can turn into a Section 508 / PDF-UA
  ready PDF: it adds the required \DocumentMetadata first line, unicode-math,
  and alt-text placeholders, and warns about packages that break tagging. It
  shows every change before you apply it, so nothing happens without your
  say-so. Compile the prepared source with LuaLaTeX (TeX Live 2025 or newer),
  then let Preflight verify the tagged output.
- **Optional LuaLaTeX engine for tagged export** - a new Settings, LaTeX Engine
  section. OpenLeaf uses a LuaLaTeX / TeX Live you already have, or installs
  TinyTeX (about 100 MB) on demand, in your home folder with no admin rights,
  and lets you delete it to free space. A built-in package manager (tlmgr) adds
  or removes LaTeX packages, with each package tagged for tagging compatibility.
  With an engine present, Preflight can compile a tagged PDF and verify it in one
  step. The default Tectonic engine is unchanged for everyone who does not need
  tagging.

### Fixed

- **Editor clipboard on macOS** - Cmd+C / Cmd+V / Cmd+X / Cmd+A work in the
  editor again. The custom application menu had replaced the default one and
  dropped the native Edit menu whose predefined items bind those shortcuts.

## [0.2.1]

### Added

- **Dedicated update window** - when a new version is available, OpenLeaf opens
  its own branded, frameless window (instead of a native OS dialog) showing the
  changelog for the new version, with a one-click Update now that downloads,
  installs, and restarts.
- **Streamlined macOS menu** - the menu bar now shows a single OpenLeaf menu
  with About OpenLeaf, Check for Updates, and Quit.
- **Update-check indicator** - the About panel now flags when an automatic
  update check has failed, so an otherwise-silent failure is visible.

### Changed

- **Release notes come from the changelog** - the update window and the GitHub
  release now lead with what actually changed (drawn from this file), with
  install help as a link rather than the headline.

## [0.2.0]

### Added

- **Diff-preview approval for agent edits** - when the assistant proposes a
  `write_file`, `replace_in_file`, or `create_file` change, the approval prompt
  now shows a real red/green diff of exactly what will change instead of a
  one-line summary. Approve or reject decisions leave a persistent trace in the
  chat (an Approved / Rejected badge on the tool step).
- **Custom AI instructions** - Settings → AI Assistant has a field for your own
  system prompt. It is sandboxed inside our prompt as untrusted preferences, so
  it tunes the assistant's behaviour without being able to override safety, the
  available tools, or reveal the built-in prompt.
- **Inline project rename** - click the project title in the top bar to rename
  it in place, with Save (Enter) and Cancel (Esc); clicking away cancels.
- **Developer context menu** - during `tauri dev`, right-clicking anywhere
  offers Refresh App and Inspect. It is stripped from production builds.

### Changed

- **Release notes render as markdown** - the in-app update prompt now formats
  release notes (headings, lists, links, code) instead of showing raw markdown.
- **Friendlier AI assistant** - the assistant now has a warmer personality, asks
  clarifying questions, and never uses em dashes.
- **AI provider settings collapse** - each provider is an accordion, and the
  active provider badge sits on the right.
- **Compile opens split view** - compiling while the PDF pane is closed now
  switches to split view so the result is visible.
- **Renamed panels** - "File Tree" is now "Source Tree" and "Editor View" is now
  "Source View".
- **No em dashes** - removed em dashes from all user-facing copy and AI output.

## [0.1.1]

### Fixed

- **Inverse SyncTeX across multiple files** - Cmd/Ctrl-clicking the PDF opens the
  correct source file (an `\input` child) before jumping to the line.

## [0.1.0]

### Security

- **Path traversal fixed** - file commands now reject absolute paths and
  validate project ids, so a crafted path or id can no longer read, write, or
  delete files outside a project directory. Added symlink-escape defense.
- **Reduced webview privileges** - removed the unused `shell:allow-execute` and
  `shell:allow-spawn` capabilities; the LaTeX compiler runs Rust-side and never
  needed them.
- **Content Security Policy** - added a restrictive CSP (`script-src 'self'`,
  `object-src 'none'`) as defense-in-depth against script injection.
- **GitHub token hardening** - the token is no longer embedded in git remote
  URLs (where it could appear in `ps`/reflogs); it's now supplied to `git` via
  an environment-backed credential helper.
- **GitHub token never enters the webview** - the authenticated GitHub REST
  calls (current user, list/create repos) now run in the Rust core, which reads
  the token from disk; `get_config` no longer returns the token to the
  frontend (only a `github_connected` flag). A webview/XSS compromise can no
  longer read or exfiltrate the token.
- **Config written securely** - `config.json` (GitHub token, AI keys) is now
  written atomically at mode `0600` from creation, closing the brief
  world-readable window left by the previous write-then-chmod approach.
- **Hardened shell-out & parsing** - the pandoc export passes `--` before the
  document path so a crafted filename can't be read as a flag; several
  `unwrap()`s on untrusted input (git porcelain, SyncTeX/`f64` sorts) are now
  panic-safe.

### Added

- **AI edit approval** - when the assistant wants to write, replace, delete, or
  rename a file, it now pauses and asks for your approval inline (approve /
  reject) before touching disk. Non-destructive tools (read, compile, search)
  still run automatically.
- **Chat attachments** - attach images or files to a message to the AI from the
  composer (images need a vision-capable model). Only lightweight metadata is
  stored in history; the bytes never touch the localStorage quota.
- **Error & success toasts** - user-triggered actions (export, download,
  create/fork/delete project, save PDF) now surface failures as a visible
  toast instead of only writing to `~/.openleaf/app.log`. Lightweight,
  dependency-free (`notifyError` logs *and* toasts).
- **In-app auto-updates** - OpenLeaf checks for new releases on launch (and via
  About → Check for updates), then downloads, signature-verifies, installs, and
  restarts. Releases now ship signed updater artifacts and a `latest.json` feed.
  See `docs/updates.md`.
- **Frontend lint gate** - Biome runs in CI (`pnpm lint`), blocking on
  correctness errors while surfacing an accessibility/style backlog as
  non-blocking warnings.
- Continuous integration (frontend build + Rust tests) on every PR; the Rust
  job now blocks on `cargo fmt --check` and `cargo clippy -D warnings`, and the
  frontend job runs the Biome lint gate.

### Fixed

- **Offline compile crashing with "unexpected argument '--only-cached'"** - the
  offline-mode flag was placed before Tectonic's `compile` subcommand instead of
  after it. Fixed and covered by tests.
- **GitHub push failing with "Repository not found"** on machines that already
  have a cached `github.com` credential (macOS keychain or a global git
  credential helper). Git consulted that stale/other-account credential before
  our token; auth failed and GitHub masked it as a 404. Push/pull now reset the
  credential-helper chain so only OpenLeaf's token is used.

### Changed

- **License changed from MIT to Apache-2.0**, © Prajwal S Venkateshmurthy and
  contributors. Still permissive (free for commercial and open-source use) but
  with stronger, explicit attribution (a `NOTICE` file redistributors must
  keep) and a patent grant. Harper is added to the credits.
- **Faster PDF preview** - compiled PDFs now transfer over IPC as raw bytes
  instead of base64 (drops the ~33% size inflation and a main-thread decode on
  every compile).
- **Smoother large documents** - the grammar/spell pass is skipped above a
  generous size threshold so a book-length file no longer janks the editor.
- Cross-platform release pipeline producing downloadable installers for macOS
  (Apple Silicon + Intel), Windows, and Linux.
- Contributor docs: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  issue/PR templates.
- Regression tests for path sandboxing (`resolve_within`, `validate_project_id`).

## [0.1.0]

- Initial release: local-first LaTeX & resume authoring with Tectonic
  compilation, SyncTeX, Git integration, GitHub sync, and bring-your-own-key AI
  assistance.

[Unreleased]: https://github.com/prajwal-svm/OpenLeaf/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/prajwal-svm/OpenLeaf/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/prajwal-svm/OpenLeaf/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/prajwal-svm/OpenLeaf/releases/tag/v0.1.1
[0.1.0]: https://github.com/prajwal-svm/OpenLeaf/releases/tag/v0.1.0
