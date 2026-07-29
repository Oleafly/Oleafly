# E2E coverage matrix

Every interactive surface, mapped to the spec that exercises it. Status:
**✓** covered · **🔑** opt-in (env-gated: credentials/network) · **✋ manual**
(native OS dialogs, OS drag-drop, nondeterministic AI output - not
automatable by design) · **—** not yet covered (listed at the bottom).

Editor evidence levels are intentionally separate:
**A** activates the production control and verifies its UI/source effect;
**C** performs a real engine compile; **R** inspects the resulting PDF through
real pdf.js text items/coordinates/font identities, annotations, outline, or
operator-list names. A source assertion alone is never labeled Render.

## Library & projects
| Surface | Interactions | Spec |
| --- | --- | --- |
| Library | welcome state, book grid | 01, 21 |
| Template gallery | open/close, cards, search rail, name+color step, create | 01, 02 |
| Every bundled template | create + compile with zero errors (all 19, incl. modern-resume's font-pack download) | 30 |
| Export menu per document kind | beamer offers pptx (not epub), book offers epub (not pptx), plain doc offers neither, image project offers PNG and hides doc formats | 30 |
| Book | open project, favorite toggle (hover-revealed) | 02, 21 |
| Bookmark-only filter | header toggle filters the grid, empty-state hint | 21 |
| Hover PDF preview | slides in for compiled projects, disabled via the appearance setting | 21 |
| Auto-compile on open | split/pdf layouts render the PDF without pressing compile | 02 |
| Book context menu | fork (unique name), delete (scoped confirm override) | 21 |
| Project metadata dialogs | details and export history open/close without leaving a blocking layer | 21 |
| Advanced project filters | abandoned select interaction keeps the popover open; metadata filters update the shelf | 21 |
| Project rename (toolbar inline) | edit, save, revert | 22 |
| Back to library / reopen | project-close dirty-buffer flush survives reopen | 22, 50 |
| Direct project switch | dirty editor buffer is flushed before the target project loads | 50 |
| Change book color / open via Enter | | — (low risk; color is cosmetic) |

## Editor
| Surface | Interactions | Spec |
| --- | --- | --- |
| CodeMirror | typing (anchored, real input), content round-trip across files | 03, 08 |
| Toolbar (legacy smoke) | bold on selection, undo/redo, insert figure/table, add-citation dialog; source/UI assertions only | 16 |
| Toolbar inventory activation | italic, underline, inline code, link, cross-reference, footnote, blockquote, align, equation, fraction, all 6 heading levels, both list kinds, symbol search/insertion, word count, find; source/UI assertions only | 33 |
| Toolbar compiled/rendered semantics | class-valid book Part/Chapter; article Section/Subsection/Subsubsection/Paragraph; bold/italic/underline/code; URL annotation; resolved ref; footnote; quote; undo/redo absence/presence; deterministic citation + `.bib` + bibliography; real PNG figure; toolbar-generated 2×2 table structure/captions/cells/geometry; lists; align/equation/fraction; representative symbol from every category plus every inventory macro compiled | 51 |
| Toolbar workflow semantics | exact word-count mutation; complete Find/Replace filters, navigation, selection, disclosure, close and preserve-case actions; definition/references + committed rename + resolved compile; WYSIWYG toolbar/keyboard history; every native and raw-backed Visual formatting branch serialized and compiled | 52 |
| Toolbar code intelligence (legacy smoke) | go to definition, find references, rename dialog cancel | 33 |
| Toolbar overflow | ResizeObserver-driven overflow moves controls into the More menu and keeps them available | 47 |
| Toolbar image transcription | real toolbar invokes its hidden input in both Code and Visual views; valid synthetic PNG (native-picker seam) -> local mock vision model -> production transcription -> compile/render | 41 |
| Toolbar view switch | LaTeX and Markdown Code/Visual round-trip; supported LaTeX WYSIWYG formatting compiles/renders in 52 | 49, 52 |
| Toolbar SyncTeX | source-only view -> Go to PDF -> split view and PDF location | 47 |
| File types | project.json/.txt open with no LaTeX toolbar; .ttf/.otf/.woff open a binary notice (was: silent failure, fixed) | 33 |
| Code folding | fold gutter collapses and restores a region | 34 |
| Editor tabs | close button removes the tab, main.tex stays active | 34 |
| Context menu | every LaTeX insertion/heading/list action; Ask AI widget; SyncTeX; definition/references/rename activation; every Typst/Markdown profile action | 53 (activation/navigation), 16 (legacy smoke) |
| File tabs | created by file switching | 08 |
| File tree | root + nested row new file/folder, open/switch, file/folder rename, recursive copy/delete, active-file fallback, set-main marker, backend/reopen persistence | 08, 54 |
| Outline | section listed | 08 |
| Spellcheck/dictionary | squiggle -> hover tooltip -> ignore -> settings chip -> un-ignore -> squiggle returns | 14 |
| Code intel: go-to-definition, find-references, rename dialog | context menu + Shift+F12, real index over a seeded label/ref pair | 23 |
| Book-scale editor stability | realistic 6,200-line, 450–500k-character LaTeX book with 99% distinct nonempty lines, 16+ chapters, 70+ sections, ten formula families, theorems, proofs, tables, lists, quotes, footnotes, citations and cross-references; a real Tectonic compile produces the multi-page PDF while Source Tree, split editor, PDF preview, project intelligence, Harper, Hunspell and inline math remain mounted. The test performs repeated long-distance scrolling plus 252 measured navigation, character-typing, multiline-paste, delete, undo and redo actions, enforces per-action and aggregate p95 ceilings, restores the source byte-for-byte, and permits zero blank frames, line/gutter drift, missing surfaces or document-scroll leaks. Slow `\tex` typing also keeps caret/scroll position stable and opens completion. | 58 |
| Unified editor intelligence | one real multi-file project proves Source/Visual structure, resolved references, resolved citations, LaTeX completion, citation completion, grammar, spelling, live inline math and the integrated PDF controls all agree on the same project revision | 58 |
| File tree row actions | real `More actions for …` three-dot controls activate rename, copy, set-main, delete, and nested create/import actions | 26, 54 |
| File tree collision handling | rename/move conflict, Cancel, Keep both, Replace, content preservation | 26 |
| File tree drag-and-drop | move into folder and collision-safe Keep both flow | 26 |
| File/folder import | real header + row import actions; DEV-only picker-result seam supplies exact external paths; root files, row files, recursive folders, binary/text byte equality, exact nested destination, reopen persistence | 54 |
| File mutation failure/race invariants | delete keeps unrelated autosave live, restores dirty state on failure, respects a live tab/project switch; repeated/concurrent copies publish complete uniquely named entries; deep-copy failure cleans staging; multi-source import preflights all inputs and rolls back an injected mid-publish failure | `files.engine-transition.test.ts`, Rust `project::tests` |
| Inline AI (Cmd+L) | provider-gated | ✋ [ai] |

### Editor action evidence

| Action group | Evidence | Spec | Notes |
| --- | --- | --- | --- |
| Undo / redo | A + C + R | 51, 52 | Code view checks PDF absence → presence across separate compiles; Visual view checks toolbar Undo/Redo and Ctrl/Cmd-Z/Shift-Z through serialized source and fresh PDF compiles. Loaded files and file switches reset Visual history in component tests. |
| Part / Chapter | A + C + R | 51 | Fresh `book` fixture; PDF text and outline entries. |
| Section / Subsection / Subsubsection / Paragraph | A + C + R | 51 | Fresh `article` fixture; rendered text and applicable outline hierarchy. |
| Bold / italic / inline code | A + C + R | 51 | Rendered text items must use font identities distinct from regular text. |
| Underline | A + C + R | 51 | Isolated clean baseline versus underlined compile: the text geometry stays stable while constructed-path rule operators increase. |
| Link | A + C + R | 51 | Exact external URL appears in a real PDF link annotation. |
| Cross-reference | A + C + R | 51 | Rendered reference is resolved and has an internal-link destination. |
| Footnote / blockquote | A + C + R | 51 | Text coordinates prove smaller footnote text and quote indentation. |
| Citation | A + C + R | 51 | Toolbar dialog is activated; deterministic BibTeX bypasses network lookup but calls production `addCitation`, verifies persisted `.bib`, then renders citation/bibliography. |
| Figure / table | A + C + R | 51 | Real PNG paint operator; toolbar-generated `tabular{ll}` structure is preserved, populated, compiled, and verified through caption/cell text plus two-row/two-column coordinates. Unit coverage exhausts all 80 table-size generator outputs and picker boundaries. |
| Bulleted / numbered list | A + C + R | 51 | Both production list controls and rendered item text. |
| Align / equation / fraction | A + C + R | 51 | Production controls wrap/insert valid math and rendered operands are asserted. |
| Greek / Arrows / Operators / Relations / Misc symbols | A + C + R | 51 | One real picker value per category; source macros and extracted PDF glyphs. |
| Every symbol inventory item | C (+ exhaustive insertion unit) | 51, `SymbolPicker.test.tsx` | Every production inventory value passes through the production insertion function in unit coverage; one generated document compiles every macro and preserves a deterministic marker for each. Glyph-level Render evidence remains the representative category row above. |
| Image to LaTeX | A + C + R | 41 | Both Code and Visual toolbar/input paths are activated. Native picker chrome is the only synthetic seam; production AI insertion, source, compile, and rendered tokens are real. |
| Word count | A | 52 | Exact words/characters/lines before and after a source mutation; no PDF claim. |
| Find / Replace | A | 52 | Next/previous, replace-next/all, case, whole-word, regex/invalid-regex, select-all exact ranges, preserve-case, disclosure, close button/Escape, live status and keyboard-visible focus are asserted; no PDF claim. |
| Code intelligence | A + C + R | 52 | Definition/references and committed rename; both label/ref mutate and the recompiled PDF remains resolved. |
| WYSIWYG native formatting | A + C + R | 52 | Bold, italic, code, Section/Subsection/Subsubsection, both list kinds, and blockquote use toolbar controls, serialize to LaTeX, then render with outline/font/coordinate evidence. |
| WYSIWYG raw-backed actions | A + C + R | 52 | Part/Chapter/Paragraph, underline, link, ref, footnote, citation, figure, table, align, equation, fraction and symbol controls serialize after placeholder entry and compile together; word-count UI is activated. Source-only Find/code-intelligence/SyncTeX controls are hidden in Visual view and unit-asserted. |
| Go to PDF (SyncTeX) | A | 47, 53 | Verifies source-only → split view and a PDF location highlight; it does not mutate document content. |
| LaTeX context-menu insertions | A | 53 | Every direct action plus all six heading and both list submenu actions; semantic compile assertions are shared with 51. |
| Typst / Markdown context menus | A | 53 | Every profile-appropriate action and Ask AI widget activation; source effects only. |

## Compile & preview
| Surface | Interactions | Spec |
| --- | --- | --- |
| Compile | button + Cmd+Enter, zero-error status chip, PDF renders | 02, 10 |
| Error loop | break -> error status -> fix -> recover | 11 |
| Logs tab | real log shown; exact clipboard payload; animated scroll reaches exact top/bottom boundaries | 11, 17 |
| Preview toolbar (full inventory) | single/two-page layouts, previous/next, valid + empty/non-numeric/zero/out-of-range page input, zoom in/out, all 7 presets, fit width/height, invert/restore, logs/PDF toggle, save actions | 17 |
| Empty preview | real Recompile control invokes the compile handler | `PreviewPane.test.tsx` |
| Preview window controls | native detached-window creation plus browser component harness for single/two-page, previous/input/next bounds, zoom +/−, invert, and layout state | 17, 56 |
| Preview recovery/races | detached A→B retarget clears A immediately, rejects late A completion, and fails closed when B has no PDF; spread navigation advances by two; a new compiled byte payload resets a crashed scoped preview boundary | `PreviewWindow.test.tsx`, `ErrorBoundary.test.tsx` |
| Save PDF/image into project | in-app dialog; exact requested nested relative path; PDF bytes equal compiled output and `%PDF-`; PNG signature/dimensions/nonblank pixels; invalid path surfaces standard failure UX | 17 |
| SyncTeX forward (Cmd+Shift+J) | highlight appears on PDF | 10 |
| SyncTeX inverse (Cmd-click PDF) | Cmd-click via text-layer coordinates lands the caret on the word | 24 |
| Stale and exact-reversion SyncTeX | stale forward mapping and nearest unchanged-anchor inverse mapping remain productive without recompiling; restoring the exact compiled source clears the stale state without changing the output revision | 58 |
| Export menu | opens, all formats listed per doc type | 22, 30 |
| Export artifacts | real production menu actions with DEV-only one-shot save destination: ZIP entries/assets/internal exclusions; PDF signature/text marker; DOCX OOXML marker; standalone embedded-resource HTML; Markdown/TXT semantics; Beamer PPTX slide marker; book EPUB stored mimetype/package/TOC/content; vector PDF and nonblank PNG; SVG explicitly absent | 55 |
| Converter downloads | real `.tex`, `.zip`, and extracted-figure buttons; exact source/ZIP equality, ZIP assets, PNG signature/dimensions/byte equality | 40 |
| Converter request/project transactions | close/newer-PDF invalidation prevents stale extraction success or failure from replacing the current conversion; project creation is one staged backend publication rather than piecemeal frontend writes | `import.test.ts`, Rust staged-project command |
| DOCX import | managed pinned Pandoc is installed on demand; real DOCX converts into an editable project without a conditional skip | 40 |

## Diagram composer
| Surface | Interactions | Spec |
| --- | --- | --- |
| Open/close, starter compile -> preview | 06 |
| Palette place shape, node select -> inspector, canvas theme, minimap | 19 |
| Canvas zoom in/out + fit view (viewport transform) | 19 |
| Code tab + TikZ snippets | 19 |
| Insert as code -> document + figures/*.tikz | 19 |
| Insert as image, save-as-project, load-existing, Fix with AI | | — image variant / 🔑 [ai] |
| Image projects (kind=image) | tailored rail/toolbar, figure compile, save-image control | 25 |
| Color pickers (fill/border/background) | | ✋ [native] |

## Rail, commands, settings
| Surface | Interactions | Spec |
| --- | --- | --- |
| Rail tabs + panels (files/search/git/preflight/refs/ai) | visibility, panel render, collapsed-sidebar recovery | 05 |
| Agentic AI (no live model) | settings tools + PDF capture toggle, plan checklist, sticky memory, handoff hook, MCP activity rail | 36 |
| Command palette | open, full command inventory, run (theme), filter | 04, 07 |
| Omnibar | open, keyword commands, /docs, /projects search | 04, 09 |
| Shortcuts | Cmd+K, Cmd+Shift+F, Cmd+Enter, Cmd+Shift+J, Cmd+/ | 04, 09, 10 |
| Hotkeys reference | open + search filter | 10, 18 |
| Word count / History / About modals | open/close | 18 |
| Settings modal | all sections render, toggle effect (compile label), persistence across restart (vim) | 07 |
| Appearance matrix | EVERY option: editor/app font sizes, app/editor fonts, accent colors, open-projects-in (all 3 layouts), show-file-tree-on-open | 32 |
| General matrix | offline mode (real --only-cached compile), shortcuts row, reset-to-defaults round-trip | 32 |
| Rail chrome | theme toggle, sidebar collapse/restore, editor/preview resize handle | 34 |
| Settings dictionary section | chip remove round-trip | 14 |
| Fonts (Offline & Downloads) | download -> installed -> remove (hermetic assets dir) | 15 |
| TinyTeX engine install | | 🔑 [net, ~100MB] |
| Editor font size select | every option restyles CodeMirror live, restores | 32 |
| Dark-mode toggle in settings | flips the real theme | 32 |
| Reset to defaults, app-font/accent selects | | — (cosmetic) |

## Git & GitHub
| Surface | Interactions | Spec |
| --- | --- | --- |
| Unconnected gate | onboarding panel asserted | 12 |
| Stage / diff / commit | `E2E_GITHUB_TOKEN` connects via PAT then full flow | 12 🔑 |
| Publish to GitHub | creates a real repo, pushes, verifies main.tex on the remote over the API, deletes the repo (delete_repo scope) and unlinks | 12 🔑 (`E2E_GIT_PUSH=1`) |
| History restore | two real commits, restore back (edit vanishes), roll forward (edit returns), restored doc recompiles clean | 29 🔑 |
| Device-flow connect, pull, discard | | 🔑 (same gate; extend 12 as needed) |
| History modal | opens from the palette | 18 |

## Preflight & AI
| Surface | Interactions | Spec |
| --- | --- | --- |
| Preflight tab visibility (tex vs image project) | 05 |
| Per-category independent Run | each lens runs alone; compiled resume reader text reaches ATS parsing and accessibility findings | 13 |
| ATS project-section aliases | a real compiled `GitHub Projects` heading is detected in reader text, store report, and accessible UI status; canonical matcher unit coverage includes singular/plural, 19 prefixes, Unicode/PDF run normalization, punctuation, and prose false positives | 13, `resume-sections.test.ts` |
| Reader view, prep-export apply, tagged compile | | — / 🔑 [engine] |
| AI keyless onboarding (connect buttons -> settings AI) | 20 |
| AI provider connect (settings UI), real conversation, real tool call | `E2E_AI_TOKEN` | 28 🔑 |
| AI model selection (GLM-4.6) persists in settings | `E2E_AI_TOKEN` | 28 🔑 |
| AI figure generation (figure mode -> preview_figure -> approve -> insert_figure lands TikZ) | `E2E_AI_TOKEN` | 31 🔑 |
| Chat sessions | new chat clears, history restores the conversation | 35 🔑 |
| Copy message button | hover control copies a bubble, flashes confirmation | 35 🔑 |
| Live reasoning blocks | interleaved thought cards with durations | ✋ [ai] nondeterministic (model may answer without thinking) |
| Custom instructions | saved in settings, verifiably steer a real reply | 35 🔑 |
| References rail panel | empty-state guidance (populated flow in 23) | 35 |
| Destructive tool approvals | Approve clicked live in 31; a Reject path test | — |

## Known manual-only checks
OS drag-and-drop from outside the app; native picker chrome itself; native color
pickers; attaching automation to the secondary Tauri WebView; auto-updater; AI
conversations end-to-end. Picker-trigger actions and resulting files are covered
through a DEV-only one-shot path-result seam (40, 54, 55). Secondary-preview
creation is covered natively and the production component/handlers are covered
in the browser harness (17, 56). The remaining OS chrome is exercised by release
smoke-testing.
