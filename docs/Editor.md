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
   labels, citation keys, environments, bibliography styles, and project file
   paths, while compile and parser diagnostics remain attached to source
   locations.
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
  column specification where the environment needs one. Environments that take
  arguments, such as `alignat`, `array`, `tabularx` and `minipage`, arrive with
  them filled in. Two toggles in Settings > Appearance > Editor control this:
  Auto-close math and Auto-close environments. Both sit under Auto-close
  brackets: switch that one off and the LaTeX pairing and the Enter `\end` go
  with it.
- Sized delimiters: a `(`, `[`, `<`, `|`, `\{` or `\|` typed after `\left`,
  `\bigl`, `\Bigl`, `\biggl` or `\Biggl` brings its closer, and `\big`,
  `\Big`, `\bigg` and `\Bigg` do the same for the glyphs that have a distinct
  closer. The caret lands between the two halves. Nothing pairs after
  `\middle`, `\bigm` or a closing command, and a `\big|` stays a single bar.
  The closer is skipped when the caret sits right in front of a word or a
  command such as `\frac`, so a `\left(` typed in front of `x^2` stays open
  for you to close by hand. Typing the closing glyph steps over the closer the
  editor wrote, an inner `(a+b)` keeps its own parenthesis, and spelling the
  whole closer out, `\right)` or `\right\}`, replaces the pending one instead
  of leaving two. Backspace between an empty pair removes both halves.
  Autocomplete offers the named delimiters as pairs too: `\left\langle`
  writes `\right\rangle` with it, `\langle` on its own writes `\rangle`, and
  once `\left\`, `\middle\` or `\right\` is typed the list narrows to the
  delimiters that can follow. Accepting `\right\rangle` while that closer is
  already pending replaces it rather than adding a second one.
- Turning the syntax check off: a comment line that reads `%novalidate` and
  nothing else silences the LaTeX syntax check for the whole file, wherever
  it sits. `%begin novalidate` and `%end novalidate` silence a region, and
  the text between them is not read at all, so an environment that generated
  code opens in there is never reported as unclosed. A `.bib` file uses two
  percent signs for the same three markers. The marker has to be the whole
  comment, so `% novalidate later, not yet` stays an ordinary comment.
  Compile errors, spelling, grammar and project diagnostics carry on as
  before.
- Rich hovers: references whose label sits in a math environment render the
  equation (KaTeX), `\includegraphics` targets show a thumbnail, and labels
  display their number and page from the last successful compile. Label
  completions carry the same compile-derived number.
- Word count (toolbar popover and command palette) uses the spellchecker's
  prose mask, so math bodies, verbatim blocks, and machine arguments are not
  counted; a non-empty selection adds a selection count.

## Visual editor

Inline and display math render through KaTeX. Click any formula to edit its
source in place; Enter (or Ctrl+Enter for display math) commits, Escape
cancels. Footnotes show as a marker that opens a small editor. Theorem-like
environments, including ones declared with `\newtheorem` in the preamble,
render with their name and optional title. Every sectioning command from
`\part` to `\subparagraph` is a heading, and `\textcolor` and `\colorbox`
show their colours.

Figures render the image from the project (with or without an extension, as
LaTeX resolves it) with width, label and caption controls. Tables render as
editable grids; a toolbar above the table adds or removes rows and columns,
sets column alignment, switches between no borders, horizontal rules, all
borders and booktabs rules, places the caption above or below, sets the
label, toggles the header row and merges or splits cells. Merged cells
serialize as `\multicolumn`.

Pasting formatted text from a browser or an office suite converts it to bold,
italic, lists and tables. Pasting text that already contains LaTeX inserts it
as native nodes. Pasting or dropping an image file saves it into the project
(`figures/` when that folder exists, otherwise next to the main document) and
inserts a figure with the caption focused. The same works in the source
editor, which inserts the figure snippet instead.

Insert figure opens a dialog in both editors: choose an image from the
project or import one from disk, pick a width, and decide whether to add a
caption and a label. Citations, references, labels and unknown commands stay
as raw source chips, and so do `\multirow`, `\cline`, `tabular*`, `tabularx`,
`figure*`, subfigures and `\caption[short]`, which round-trip untouched.

## LaTeX controls at a glance

The LaTeX toolbar keeps common source operations close to the editor. It does
not replace the source: each action inserts ordinary LaTeX that remains
readable in Git and other editors.

| Group | Available controls |
| --- | --- |
| Modes and history | Code view, Visual view, undo, redo |
| Structure | Six heading levels, from `\part` through `\paragraph` |
| Inline text | Bold, italic, underline, and monospace text |
| References | Links, citations, cross-references, and footnotes |
| Blocks | Quotes, figures with captions and labels, tables, itemized and numbered lists, `equation`, `align`, and fractions |
| Intelligence | Go to definition, find references, and project-wide rename |
| Symbols | A searchable palette with 236 unique commands across 13 categories |

<div align="center">
  <img src="assets/readme/latex-editor-toolbar.png" alt="Oleafly LaTeX editor toolbar with formatting, references, figures, tables, lists, equations, and symbol controls" width="100%" />
</div>
<p align="center"><em>Insert common LaTeX structures without leaving the source editor.</em></p>

The symbol palette groups Greek letters, operators, relations, arrows, set
theory, logic, calculus, functions, brackets, accents, dots and spacing, and
miscellaneous symbols. Search by symbol or command, then insert it at the
current cursor. The full [symbol catalog in the README](../README.md#searchable-latex-symbol-palette)
lists every category and command.

<div align="center">
  <img src="assets/readme/latex-symbols.png" alt="Oleafly searchable LaTeX symbol palette with categorized mathematical commands" width="100%" />
</div>
<p align="center"><em>Browse or search the symbol catalog, then insert the command where you are writing.</em></p>

## Proofreading

- Two checkers share one worker pass. Hunspell owns spelling against the
  selected dictionary pack. Harper owns grammar and style.
- Five dictionary packs ship with the app: English (United States, United
  Kingdom, Australia), German and French. The rest of the list, more than
  sixty languages, downloads on demand and then stays on disk, so it works
  offline afterwards. Every download is checked against its published
  SHA-256 before it is used, and a language that is not installed says so
  instead of falling back to another one.
- A project can pin its own spell-check language in the Project info panel.
  The choice lives in `project.json`, travels with the project, and overrides
  the app setting for that project only. The grammar checker's English
  dialect still follows the app setting.
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
- When a Harper call fails, the worker throws that engine instance away and
  builds a new one for the next pass, because a panic inside the WebAssembly
  module leaves the old instance unusable. The failure reason goes to the
  console once. `HARPER_PANICKING_RULES` in `lint-profile.ts` lists rules that
  are forced off for the pinned Harper release (BoringWords in harper.js
  2.10.0). A test against the installed Harper fails when the rule stops
  panicking, which is the cue to unblock it.
- A partial pass, where one engine finished and the other did not, is not
  announced with a toast. The Project info panel keeps the counts, and the
  worker logs the reason. Errors that need a retry keep their sticky toast.
- Deferred, not planned for 0.4.1: a general way to mute an informational
  notice from the toast itself, with a Settings list of muted notices and a
  reset button (toasts that need action would stay unmutable), and an upstream
  report of the BoringWords panic to the Harper project.
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

## Editor settings

Settings > Appearance > Editor holds the editor's own preferences. All of
them are stored locally, survive a reload, and go back to their defaults with
Reset appearance.

- Keybindings: Default, Vim or Emacs. See
  [KeyboardShortcuts.md](KeyboardShortcuts.md) for what each mode binds.
- Editor font size, editor font and editor theme.
- Tab size: 2, 4 or 8 spaces. It sets the indent unit and the width a
  literal tab renders at.
- Line height: compact (1.4), normal (1.7) or wide (2.0).
- Wrap long lines: on by default. Turn it off and the editor scrolls
  sideways instead.
- Auto-complete, auto-close brackets, auto-close math, auto-close
  environments, inline suggestion, non-blinking cursor and sticky scroll.

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
