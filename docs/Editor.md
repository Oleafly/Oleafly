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
- LaTeX structural helpers: Enter continues `\item` lists. A description item
  comes out as `\item[] ` with the caret in the label. An empty item deletes
  its marker. When the inner list closes right below it, the item moves out to
  the enclosing list instead. Shift-Enter stays a plain newline, and Backspace
  behind a marker blanks it before deleting it.
  Enter at the end of a `\begin{...}` line writes the matching `\end`.
  `Mod-Alt-.` closes the innermost open environment and `Mod-Alt-e` surrounds
  the selection with an environment (both also in the command palette).
  `@`-prefixed math shortcuts complete Greek letters and symbols inside math
  contexts.
- LaTeX input pairing: typing `$` writes the closing `$` too, and a second `$`
  inside empty math opens a display block. `\(` and `\[` expand with their
  closing delimiter, and Backspace between a fresh pair removes both halves.
  Comments, verbatim blocks and an escaped `\$` are left as typed. Environment
  completions insert the matching `\end`, with a first `\item`, caption or
  column specification where the environment needs one. Two toggles in
  Settings > Appearance > Editor control this: Auto-close math and Auto-close
  environments. Both sit under Auto-close brackets: switch that one off and the
  LaTeX pairing and the Enter `\end` go with it.
- Rich hovers: references whose label sits in a math environment render the
  equation (KaTeX), `\includegraphics` targets show a thumbnail, and labels
  display their number and page from the last successful compile. Label
  completions carry the same compile-derived number.
- Word count (toolbar popover and command palette) uses the spellchecker's
  prose mask, so math bodies, verbatim blocks, and machine arguments are not
  counted; a non-empty selection adds a selection count.

## Proofreading

- Two checkers share one worker pass. Hunspell owns spelling against the
  selected dictionary pack. Harper owns grammar and style.
- LaTeX reaches Harper through a prose mask the same length as the source, so
  a lint span is already a document offset. Markup that reads as a noun in the
  sentence, such as a citation, a reference, a `\gls` term or inline math,
  becomes a placeholder noun padded with spaces. Markup that prints nothing,
  such as an opaque environment, display math, a comment or a preamble
  command, becomes spaces. Prose arguments stay: `\section{}`, `\emph{}`,
  `\textbf{}`, `\caption{}`, `\footnote{}` and `\item[]` keep their text
  while the command name and braces go.
  Deleting markup instead of replacing it used to join the words on either
  side and manufacture findings that were not in the document.
- A finding is shown only when it sits entirely in prose the mask kept. One
  that reaches across a masked construct or a placeholder is dropped, because
  its suggestion would rewrite the markup underneath.
- Typst goes through Harper's own Typst parser. Markdown and plain text use
  the existing masks.
- Harper is tuned for chat and email. The academic profile in
  `src/lib/proofreading/lint-profile.ts` turns off the rules that fight
  scholarly prose: sentence length, hedging, contractions, shorthand
  expansion, comma style, dash style, and the whitespace rules that a masked
  document always trips. Each profile rule carries a one-line reason and an
  example of what it would flag, and Settings shows both next to a switch.
  Settings keeps two lists on top of it, one of rules the writer turned off
  and one of profile rules they turned back on.
- A finding is only ever as wide as the thing it is about. A spelling finding
  wider than 40 characters, or one that crosses a line, is dropped. A grammar
  finding stops at the end of its sentence and at 300 characters. The same
  word cannot be reported more than 20 times in one document.
- The card names what was found. Spelling says "Not in dictionary" or offers a
  replacement; everything else shows the checker's own message with the rule
  name under it.
- Dismissing. The card lists its actions as rows with an icon each. A
  misspelling can be ignored in this project (the project dictionary),
  ignored everywhere (the personal dictionary), or ignored for now, which
  covers this document until the app restarts. A grammar finding can be
  ignored in this project, which the project remembers by rule plus a digest
  of the sentence, or its rule can be turned off everywhere.
  Dismissing clears every finding over the same text, since removing one can
  reveal another underneath. Those cleared findings stay hidden for the rest
  of the session, so the next pass does not bring them back.
  A selection too long or too strange to store as a word is hidden for the
  session instead, with a toast saying so. Nothing is ever a silent no-op.
- Settings > Dictionary lists the rules the writer turned off and the number
  of findings dismissed in the open project, and takes either back. Under
  them it lists every rule the academic profile turns off, each with a switch
  that turns it back on.

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
