# Windows v0.4.0 validation

This audit started from `65bfadcd1` after updating to the published v0.4.0
line. Tests use temporary project libraries and synthetic documents. The host
is Windows x64, build 26200, with Node 22.23.1 and WebView2.

## Fixes found during validation

- Secret-file hardening launched `icacls` for each lock-file access. Native
  Windows ACL calls now install the same protected, current-user-only access
  without a child process or environment-based account-name lookup. Tests
  inspect the resulting ACL and preserve Unicode paths and file contents.
- Template listing and preview reads could block the UI thread on disk I/O.
  They now run on blocking workers.
- Research task list, create, edit, retry, transcript, and preview commands
  also performed synchronous storage work on the UI thread. Blocking workers
  preserve their validation, errors, and event notifications.
- Settings persistence and project renaming now leave the UI thread before
  waiting for filesystem locks and writing metadata.
- Windows atomic saves now tolerate temporary non-delete-sharing readers for
  up to eight seconds without truncating or removing the previous document.
  A native regression holds such a reader for three seconds.
- Repeated Git refreshes coalesce, and staging admits one pending action at
  a time, preventing a growing queue of worktree lock requests.
- Markdown compilation incorrectly rejected a valid PDF because Pandoc
  forwarded a nonfatal Tectonic Fontconfig initialization message. That
  message remains visible as a warning; PDF errors and failed exit codes
  still fail compilation.
- An open working-tree diff retained its old INDEX baseline after staging or
  committing. Both working and staged diffs now refresh when Git changes.
- CRLF compiler output missed anchored diagnostic patterns in the Rust log
  parser. It now removes the carriage-return line terminator before parsing;
  every golden log is checked with both LF and CRLF endings.

Windows test corrections cover CRLF fixture offsets, platform-specific
shortcuts and shell commands, Python executable discovery, locale-dependent
timestamps, and cold lazy-module imports. The native runner can also exercise
a packaged test binary instead of rebuilding the development app per spec.

## Completed checks

| Area | Evidence |
| --- | --- |
| Production frontend | Typecheck and build passed; bundle budget passed with one PDF worker, 59 KaTeX fonts, and zero development hook tokens |
| Static checks | Biome lint passed with one pre-existing warning; Rust formatting and workspace Clippy passed |
| Native application unit tests | 1,315 passed in the broad run; two startup-timeout cases passed on isolated rerun; five existing ignored tests |
| Windows atomic save | 11 sandbox tests passed, including a three-second held-reader regression |
| Settings persistence | 66 native tests passed, including encrypted-secret retention and endpoint changes |
| Browser preview | Nine checks passed across Chromium, Firefox, and WebKit for PDF selection, Markdown math/fonts, and detached preview |
| Source Control concurrency | 31 frontend tests passed, including 20 rapid refresh and staging clicks |
| Native regression sweep | 41 cases passed across create/compile, Git, editor toolbar, preview controls, library, SyncTeX, file collisions, and Git restore, including isolated reruns of two corrected Git waits; one remote-publish case skipped |
| Template compilation | All 26 cases passed across the gallery and image/export checks, including the Markdown regression rerun |
| Research task storage and recovery | 42 passed after the worker change, including a regression that checks execution leaves the calling thread and preserves errors |
| Research command boundary | Task create/list/edit/cancel-retry, transcript reads, and preview error preservation passed through the asynchronous commands |
| Command-line integration | 11 passed, including build output contracts and watch recovery |
| Language services | TexLab 5.26.0 and Tinymist 0.15.2 passed seven rapid document revisions with no stale diagnostic regression |
| Other Rust workspace crates | 312 passed: agent 237, CLI 23, core 28, history 24 |
| Checkpoint storage integration | 41 passed, including atomic archive import/export, duplicate imports, corruption rejection, retention, and cancellation |
| Compiler log integration | 22 passed after fixing CRLF diagnostic parsing; golden logs now check both line-ending forms |
| Live Z.AI assistant | Nine passed: model discovery, real streamed replies, usage, reasoning, file tools, delegated task and transcript, custom gateway, selection persistence, catalog refresh, and rejected key handling |
| Local Ollama | Six passed using `llama3.2:3b`: discovery, real response, usage, file tool, trailing slash, and host persistence |
| Manual native UI | Visual LaTeX edit, undo/redo, source round trip, compile and PDF text; detached preview fit, rotation, inversion, reader mode and close; project fork, staging, local commit and Git history; terminal pane startup |
| Focused frontend regressions | 79 chat/Markdown/diagram/project-setup tests, 118 assistant-loop tests, six dock tests, and 37 compile-store tests passed |

The live checks assert assistant output rather than matching text in the user
prompt. Credentials stay outside the repository and are not included in test
artifacts or this report.

## Compiler matrix

`node scripts/smoke-document-engines.mjs` exercises actual compiler processes,
checks PDF headers for valid documents, and checks diagnostic failures with no
PDF for invalid documents. All 13 cases passed on this host. Setting
`OLEAFLY_TEX_BIN_DIR` includes TeX Live.

| Engine | Valid cases | Invalid case |
| --- | --- | --- |
| Tectonic 0.16.9 | Standard document and `fontspec` with Arial | Undefined command |
| Typst 0.15.0 | Standard document, Libertinus Serif, and Windows Arial | Unknown function |
| pdfLaTeX | Standard document through latexmk | Undefined command |
| XeLaTeX | Arial through fontspec and latexmk | Undefined command |
| LuaLaTeX | Arial through fontspec and latexmk | Undefined command |

Valid fixtures include another source file, equations, references, and tables.
Typst font checks reject an unknown-font warning so fallback cannot produce a
false pass. These are representative font and engine cases, not every font
installed on every Windows machine. Build and test contention makes timings
from the functional matrix unsuitable as performance benchmarks.

## Remaining validation record

The packaged full-flow sweep, browser-only harness checks, final frontend and
workspace totals, and production/performance gates are recorded here when
their runs finish.

The test binary deliberately includes E2E hooks and must not be distributed.
Windows symlink-creation tests require Developer Mode or the relevant privilege;
this host does not grant it. Remote publishing and account integrations need
their respective credentials and are separate from local Git versioning.
