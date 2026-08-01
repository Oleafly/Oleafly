// LaTeX structural editing commands:
//  - continueListOnEnter: Enter inside an itemize/enumerate/description list
//    continues the list with a new `\item`, or exits it on an empty item.
//  - closeEnvironmentAtCursor: inserts `\end{...}` for the innermost unclosed
//    environment above the cursor.
//  - surroundSelectionWithEnvironment: wraps the selection in a
//    `\begin{env}…\end{env}` snippet with mirrored environment-name fields.
//
// The pure helpers take an EditorState and return a TransactionSpec (or null
// when they do not apply), so they are directly unit-testable; the keymaps
// wrap them as view commands.

import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";
import { getEditorDocumentPath } from "./controller";

// EXTRA_KEYMAP (and the palette) are registered globally, for every document
// the shared editor shows. These commands only make sense in LaTeX sources,
// so each entry point re-checks the active document path and bows out
// otherwise, letting default keybindings (e.g. plain Enter) proceed.
const LATEX_PATH = /\.(tex|latex|ltx|sty|cls)$/i;

function isLatexDocument(): boolean {
  const path = getEditorDocumentPath();
  return !!path && LATEX_PATH.test(path);
}

/** Environments whose `\item` lines Enter should continue. */
const LIST_ENVIRONMENTS = /\\(begin|end)\{(itemize|enumerate|description)\*?\}/g;

/** Any `\begin{...}` / `\end{...}` pair; the name keeps a trailing star. */
const ANY_ENVIRONMENT = /\\(begin|end)\{([^{}]+)\}/g;

/** `\item` at the start of a line (after indentation), not `\itemize` etc. */
const ITEM_LINE = /^(\s*)\\item(?![a-zA-Z])/;

/** A line that is exactly an empty item: `\item` or `\item `. */
const EMPTY_ITEM_LINE = /^\s*\\item ?$/;

/** Upward scan bound for list detection (bytes). */
const LIST_SCAN_LIMIT = 8 * 1024;

/** Upward scan bound for environment-balance detection (bytes). */
const ENV_SCAN_LIMIT = 16 * 1024;

function leadingWhitespace(text: string): string {
  return /^\s*/.exec(text)![0];
}

/**
 * True when an upward, bounded scan from `pos` finds an unbalanced
 * `\begin{itemize|enumerate|description}` (starred variants included).
 */
function insideListEnvironment(state: EditorState, pos: number): boolean {
  const from = Math.max(0, pos - LIST_SCAN_LIMIT);
  const text = state.sliceDoc(from, pos);
  let depth = 0;
  LIST_ENVIRONMENTS.lastIndex = 0;
  for (let m = LIST_ENVIRONMENTS.exec(text); m; m = LIST_ENVIRONMENTS.exec(text)) {
    if (m[1] === "begin") depth++;
    else if (depth > 0) depth--;
  }
  return depth > 0;
}

/**
 * Continue (or exit) a LaTeX list on Enter.
 *
 * - On a non-empty `\item` line inside a list: insert `"\n" + indent + "\item "`
 *   at the cursor, preserving the current line's indentation.
 * - On a line that is exactly `\item` / `\item `: clear the line and insert a
 *   plain newline (exit the list).
 * - Anywhere else (cursor at line start, not in a list, multi-cursor,
 *   non-empty selection): null, so the default Enter behavior proceeds.
 */
export function continueListOnEnter(state: EditorState): TransactionSpec | null {
  if (!isLatexDocument()) return null;
  if (state.selection.ranges.length > 1) return null;
  const sel = state.selection.main;
  if (!sel.empty) return null;

  const line = state.doc.lineAt(sel.head);
  if (sel.head === line.from) return null;

  const item = ITEM_LINE.exec(line.text);
  if (!item) return null;
  if (!insideListEnvironment(state, line.from)) return null;

  if (EMPTY_ITEM_LINE.test(line.text)) {
    // Empty item: clear the line's content and break out of the list.
    return {
      changes: { from: line.from, to: line.to, insert: "\n" },
      selection: { anchor: line.from + 1 },
      scrollIntoView: true,
      userEvent: "input",
    };
  }

  const insert = `\n${item[1]}\\item `;
  return {
    changes: { from: sel.head, insert },
    selection: { anchor: sel.head + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  };
}

/**
 * Close the innermost unclosed environment above the cursor.
 *
 * Scans upward (bounded) tracking `\begin`/`\end` balance across all
 * environment names with a stack. Returns a spec inserting `\end{name}` at
 * the cursor — on its own correctly-indented line when the cursor line is
 * non-empty — or null when everything in range is balanced.
 */
export function closeEnvironmentAtCursor(state: EditorState): TransactionSpec | null {
  if (!isLatexDocument()) return null;
  const head = state.selection.main.head;

  const scanFrom = Math.max(0, head - ENV_SCAN_LIMIT);
  const text = state.sliceDoc(scanFrom, head);
  const stack: { name: string; pos: number }[] = [];
  ANY_ENVIRONMENT.lastIndex = 0;
  for (let m = ANY_ENVIRONMENT.exec(text); m; m = ANY_ENVIRONMENT.exec(text)) {
    if (m[1] === "begin") {
      stack.push({ name: m[2], pos: scanFrom + m.index });
    } else {
      // Close the nearest matching open environment; anything opened after it
      // is treated as implicitly closed. Stray \end entries are ignored.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === m[2]) {
          stack.length = i;
          break;
        }
      }
    }
  }

  const open = stack[stack.length - 1];
  if (!open) return null;

  const indent = leadingWhitespace(state.doc.lineAt(open.pos).text);
  const line = state.doc.lineAt(head);
  const closing = `\\end{${open.name}}`;
  // Non-empty line: put \end on its own line, indented like its \begin.
  // Empty line: adopt the \begin indent. Whitespace-only line: the existing
  // whitespace already serves as indentation.
  const insert =
    line.text.trim().length > 0
      ? `\n${indent}${closing}`
      : line.length === 0
        ? `${indent}${closing}`
        : closing;
  return {
    changes: { from: head, insert },
    selection: { anchor: head + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  };
}

/**
 * Escape text so it can be embedded verbatim in a CodeMirror snippet
 * template. Snippet syntax treats `${...}` / `#{...}` as fields and
 * `\{` / `\}` as literal-brace escapes, so escaping every brace both
 * neutralizes field-like sequences in user text and round-trips exactly.
 */
export function escapeSnippetText(text: string): string {
  return text.replace(/[{}]/g, (brace) => `\\${brace}`);
}

/**
 * Wrap the primary selection in a `\begin{env}…\end{env}` snippet whose two
 * `env` fields mirror each other while the snippet is active. With an empty
 * selection, inserts the template with an empty body field instead.
 */
export function surroundSelectionWithEnvironment(view: EditorView): boolean {
  if (!isLatexDocument()) return false;
  const { from, to } = view.state.selection.main;
  const template =
    from === to
      ? "\\begin{${1:env}}\n${2}\n\\end{${1:env}}"
      : `\\begin{\${1:env}}\n${escapeSnippetText(view.state.sliceDoc(from, to))}\n\\end{\${1:env}}`;
  snippet(template)(view, null, from, to);
  return true;
}

/**
 * Enter → continue/exit lists. Returns false when the command does not apply
 * so the default Enter binding still runs.
 */
export const latexListKeymap: KeyBinding[] = [
  {
    key: "Enter",
    run: (view) => {
      const spec = continueListOnEnter(view.state);
      if (!spec) return false;
      view.dispatch(spec);
      return true;
    },
  },
];

export const latexStructureKeymap: KeyBinding[] = [
  {
    key: "Mod-Alt-.",
    run: (view) => {
      const spec = closeEnvironmentAtCursor(view.state);
      if (!spec) return false;
      view.dispatch(spec);
      return true;
    },
  },
  { key: "Mod-Alt-e", run: surroundSelectionWithEnvironment },
];
