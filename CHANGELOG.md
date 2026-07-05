# Changelog

All notable changes to OpenLeaf are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/prajwal-svm/OpenLeaf/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/prajwal-svm/OpenLeaf/releases/tag/v0.1.0
