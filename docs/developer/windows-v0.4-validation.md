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
The vendored native test bridge also returned early for asynchronous predicates:
it treated a Promise as truthy before the result arrived. It now awaits the
predicate before deciding whether to poll again. A real-app regression checks
false results, rejected promises, eventual success, and timeout behavior.

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
| Frontend suite | The broad Windows run passed 3,737 tests but encountered worker startup failures and platform/test-fixture failures. All 60 affected files passed in a clean 358-test rerun after corrections; CI passed all 4,027 tests on the preceding product revision |
| Git diff reload | A real CodeMirror component regression passed for staging and unstaging with a fast asynchronous Git backend |
| Checkpoint UI and archives | Tectonic, Typst, and Markdown passed compile deduplication, labels, source restore/recompile, encrypted export/import, password validation, and keep-latest retention; archive import preserved the working document |
| Compiler selection | Six native UI checks passed for Tectonic, explicit pdfLaTeX/XeLaTeX/LuaLaTeX, Auto, and project reopen persistence |
| Complete native flow coverage | 350 distinct cases passed across the broad sweep and corrected reruns. The final 20-case set passed with asynchronous bridge waits, including Git, assistant settings/history/instructions, live file tools, and all five ACP cases |
| Terminal | Six passed: real shell output and exit, multiple tabs, rename, close-others, ten-session limit, and configured shortcut routes |
| Research and ACP | Task execution/review, linked-folder access and unlink, project setup, conflict-preserving apply, ACP sign-in/model/permissions, history/reconnect, cooperative stop, and forced child-process termination passed |

The live checks assert assistant output rather than matching text in the user
prompt. Credentials stay outside the repository and are not included in test
artifacts or this report.
The Ollama file-tool check uses the app's tool picker to expose `read_file`
alone. An unconstrained repeat with the small local model selected a shell
command and waited for approval; this was model behavior, not an app hang.

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

## Editor performance

The existing performance gate passed all three tests with no concurrent local
build or native test sweep. Each measurement uses three warmups and 20 measured
runs. These are synchronous editor-operation timings on this host, not total
application startup or compiler timings.

| Operation | P95 | Existing budget |
| --- | ---: | ---: |
| 6,200-line document analysis | 69.71 ms | 750 ms |
| Syntax lint | 3.50 ms | 50 ms |
| Proofreading extraction | 95.29 ms | 2,000 ms |
| Inline math scan | 30.91 ms | 500 ms |
| 200-file project analysis | 52.44 ms | 750 ms |
| Citation completion | 0.033 ms | 250 ms |
| End-of-book command completion | 4.85 ms | 100 ms |

## Scope and exclusions

Three browser-only specs were run separately across Chromium, Firefox, and
WebKit. Native keyboard accelerators and the separate browser window cannot
be inspected through the app bridge and need computer-use checks. The native
sweep leaves those two bridge-only cases explicitly skipped, along with remote
GitHub publishing without its dedicated test credentials.

The test binary deliberately includes E2E hooks and must not be distributed.
Windows symlink-creation tests require Developer Mode or the relevant privilege;
this host does not grant it. Remote publishing and account integrations need
their respective credentials and are separate from local Git versioning.
