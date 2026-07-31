# Editor

The editor is a CodeMirror 6 surface backed by a project-wide index. It is not
just a text box: the editor receives syntax, diagnostics, symbol, reference,
and completion data from the active document engine and the shared project
analysis services.

## Core capabilities

These nine capabilities are the editor support contract. The stable IDs and
acceptance criteria live in `test/fixtures/editor-support/contract.json` and
are exercised by `src/lib/editor-support-contract.test.ts`.

1. **Advanced syntax highlighting**: engine-aware highlighting for LaTeX,
   Typst, Markdown, and BibTeX, including math, commands, environments, and
   comments.
2. **Live reference checking**: resolves labels, references, citations,
   macros, environments, and included files across the project index.
3. **Integrated PDF viewer**: keeps the compiled artifact beside the source
   and exposes source-to-PDF navigation when SyncTeX data is available.
4. **Live inline preview**: renders supported inline math and visual content
   without replacing the editable source representation.
5. **LaTeX command completion and syntax checking**: completes commands,
   labels, citation keys, environments, and project file paths, while compile
   and parser diagnostics remain attached to source locations.
6. **Live grammar checking**: runs the configured offline proofing pipeline on
   prose while excluding commands, comments, and mathematical syntax.
7. **Local and global structure view**: exposes headings, symbols, labels,
   citations, macros, and file relationships for the current file and project.
8. **Citation checking and completion**: indexes BibTeX entries and reports
   undefined or duplicate references before compilation.
9. **Spellchecking**: uses the shipped dictionary contract, user additions,
   and truthful active-dialect state.

## Editing surfaces

- Code view is the canonical source surface for all engines.
- Visual editing is available where the engine descriptor declares it.
- Markdown and LaTeX formatting actions operate through engine-aware ports;
  they do not infer behavior from a file extension alone.
- Vim mode, find and replace, code folding, multi-file tabs, and slash-command
  insertion are application contributions rather than editor parser logic.
- LaTeX structural helpers: Enter continues `\item` lists (an empty item
  exits), `Mod-Alt-.` closes the innermost open environment, and
  `Mod-Alt-e` surrounds the selection with an environment (both also in the
  command palette). `@`-prefixed math shortcuts complete Greek letters and
  symbols inside math contexts.
- Rich hovers: references whose label sits in a math environment render the
  equation (KaTeX), `\includegraphics` targets show a thumbnail, and labels
  display their number and page from the last successful compile. Label
  completions carry the same compile-derived number.
- Word count (toolbar popover and command palette) uses the spellchecker's
  prose mask, so math bodies, verbatim blocks, and machine arguments are not
  counted; a non-empty selection adds a selection count.

## Engineering boundaries

- `packages/editor/` contains parser, proofing, highlighting, and editor-port
  logic that can run without Tauri or application stores.
- `src/store/project-index.ts` owns project-wide indexing and invalidation.
- `src/lib/analysis/` coordinates language-service requests and stale-result
  rejection.
- `src-tauri/src/document_engine.rs` publishes the active engine descriptor.
- `src/contributions/` registers commands and editor-facing tools.

## Correctness and performance contract

The contract requires all acceptance criteria for all nine features. Results
are rejected when they belong to an older project revision. Performance gates
are measured separately from cross-platform functional gates and use the fixed
reference methodology recorded in the test fixture.
