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

import {
  countColumn,
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Line,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { indentString } from "@codemirror/language";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { snippet } from "@codemirror/autocomplete";
import { getEditorDocumentPath } from "./controller";
import { inLatexIgnoredRegion, latexMaskedSlice } from "./latex-lexical";

// EXTRA_KEYMAP (and the palette) are registered globally, for every document
// the shared editor shows. These commands only make sense in LaTeX sources,
// so each entry point re-checks the active document path and bows out
// otherwise, letting default keybindings (e.g. plain Enter) proceed.
const LATEX_PATH = /\.(tex|latex|ltx|sty|cls)$/i;

export function isLatexDocument(): boolean {
  const path = getEditorDocumentPath();
  return !!path && LATEX_PATH.test(path);
}

interface VimStateHost {
  cm?: { state?: { vim?: { insertMode?: boolean } } };
}

export function vimOwnsInput(view: { state: EditorState }): boolean {
  const vim = (view as VimStateHost).cm?.state?.vim;
  return vim !== undefined && vim.insertMode !== true;
}

/** Environments whose `\item` lines Enter should continue. */
const LIST_NAMES = new Set(["itemize", "enumerate", "description"]);

/** Any `\begin{...}` / `\end{...}` pair; the name keeps a trailing star. */
const ANY_ENVIRONMENT = /\\(begin|end)\{([^{}]+)\}/g;

/** `\item` at the start of a line (after indentation), not `\itemize` etc. */
const ITEM_LINE = /^(\s*)\\item(?![a-zA-Z])/;

/** A line that is exactly an empty item: `\item` or `\item `. */
const EMPTY_ITEM_LINE = /^\s*\\item(?![a-zA-Z])\s*(?:\[\s*\])?\s*$/;

const ITEM_MARKER = /^(\s*)(\\item(?![a-zA-Z])(\s*\[[^\]]*\])?)/;

const ITEM_MARKER_HEAD =
  /^(\s*)(\\item(?![a-zA-Z])(?:\[[^\]]*\])?[ \t]?)$/;

const UNFINISHED_LABEL = /^[ \t]*\[/;

const ENVIRONMENT_CLOSE_LINE = /^\s*\\end\{([^{}]+)\}\s*$/;

const LINE_WINDOW = 2 * 1024;

/** Upward scan bound for list detection (bytes). */
const LIST_SCAN_LIMIT = 4 * 1024;

const LIST_CLOSE_SCAN_LIMIT = 4 * 1024;

/** Upward scan bound for environment-balance detection (bytes). */
const ENV_SCAN_LIMIT = 16 * 1024;

function leadingWhitespace(text: string): string {
  return /^\s*/.exec(text)![0];
}

interface ListContext {
  env: string;
  beginIndent: string;
  itemIndent: string | null;
}

interface ContinuationPlan {
  changes: ChangeSpec[];
  head: number;
}

function listScanStart(state: EditorState, upTo: number): number {
  const limit = Math.max(0, upTo - LIST_SCAN_LIMIT);
  if (limit === 0) return 0;
  const line = state.doc.lineAt(limit);
  return line.from === limit ? limit : Math.min(upTo, line.to + 1);
}

function listContexts(state: EditorState, upTo: number): ListContext[] {
  const from = listScanStart(state, upTo);
  const text = latexMaskedSlice(state, from, upTo);
  const stack: ListContext[] = [];
  for (const lineText of text.split("\n")) {
    const indent = leadingWhitespace(lineText);
    ANY_ENVIRONMENT.lastIndex = 0;
    for (
      let m = ANY_ENVIRONMENT.exec(lineText);
      m;
      m = ANY_ENVIRONMENT.exec(lineText)
    ) {
      const env = m[2].replace(/\*$/, "");
      if (!LIST_NAMES.has(env)) continue;
      if (m[1] === "begin") {
        stack.push({ env, beginIndent: indent, itemIndent: null });
        continue;
      }
      for (let level = stack.length - 1; level >= 0; level--) {
        if (stack[level].env === env) {
          stack.length = level;
          break;
        }
      }
    }
    if (stack.length > 0 && ITEM_LINE.test(lineText)) {
      stack[stack.length - 1].itemIndent = indent;
    }
  }
  return stack;
}

function insideListEnvironment(state: EditorState, pos: number): boolean {
  return listContexts(state, pos).length > 0;
}

function indentLike(state: EditorState, whitespace: string): string {
  return indentString(state, countColumn(whitespace, state.tabSize));
}

function itemMarker(env: string): { text: string; caret: number } {
  return env === "description"
    ? { text: "\\item[] ", caret: "\\item[".length }
    : { text: "\\item ", caret: "\\item ".length };
}

function lineWindow(state: EditorState, line: Line): string {
  return state.sliceDoc(
    line.from,
    Math.min(line.to, line.from + LINE_WINDOW),
  );
}

function closerBelowBlankLines(
  state: EditorState,
  line: Line,
  env: string,
): Line | null {
  const limit = Math.min(state.doc.length, line.to + LIST_CLOSE_SCAN_LIMIT);
  for (let number = line.number + 1; number <= state.doc.lines; number += 1) {
    const next = state.doc.line(number);
    if (next.from > limit) return null;
    if (next.length > LINE_WINDOW) return null;
    if (lineWindow(state, next).trim().length === 0) continue;
    const closer = ENVIRONMENT_CLOSE_LINE.exec(
      latexMaskedSlice(
        state,
        next.from,
        Math.min(next.to, next.from + LINE_WINDOW),
      ),
    );
    if (!closer) return null;
    return closer[1].replace(/\*$/, "") === env ? next : null;
  }
  return null;
}

function planEmptyItem(
  state: EditorState,
  line: Line,
  text: string,
  contexts: ListContext[],
): ContinuationPlan {
  const inner = contexts[contexts.length - 1];
  const outer = contexts[contexts.length - 2];
  const closing = outer
    ? closerBelowBlankLines(state, line, inner.env)
    : null;
  if (outer && closing) {
    const indent = indentLike(
      state,
      outer.itemIndent ?? outer.beginIndent,
    );
    const marker = itemMarker(outer.env);
    const removedTo = Math.min(line.to + 1, state.doc.length);
    return {
      changes: [
        { from: line.from, to: removedTo },
        { from: closing.to, insert: `\n${indent}${marker.text}` },
      ],
      head:
        closing.to -
        (removedTo - line.from) +
        1 +
        indent.length +
        marker.caret,
    };
  }
  if (outer) {
    const kept = line.from + leadingWhitespace(text).length;
    return {
      changes: [{ from: kept, to: line.to }],
      head: kept,
    };
  }
  return {
    changes: [{ from: line.from, to: line.to, insert: "\n" }],
    head: line.from + 1,
  };
}

function planItemContinuation(
  state: EditorState,
  pos: number,
): ContinuationPlan | null {
  const line = state.doc.lineAt(pos);
  if (pos === line.from) return null;
  if (inLatexIgnoredRegion(state, pos)) return null;
  const contexts = listContexts(state, line.from);
  const context = contexts[contexts.length - 1];
  if (!context) return null;

  const text = lineWindow(state, line);
  const item = ITEM_MARKER.exec(text);
  if (!item) {
    if (context.itemIndent === null) return null;
    const indent = indentLike(state, leadingWhitespace(text));
    return {
      changes: [{ from: pos, insert: `\n${indent}` }],
      head: pos + 1 + indent.length,
    };
  }
  const markerEnd = line.from + item[0].length;
  if (pos < markerEnd) return null;
  const closedLabel = item[3] !== undefined;
  if (!closedLabel) {
    const label = UNFINISHED_LABEL.exec(text.slice(item[0].length));
    if (label && pos >= markerEnd + label[0].length - 1) return null;
  }

  if (line.length <= LINE_WINDOW && EMPTY_ITEM_LINE.test(text)) {
    return planEmptyItem(state, line, text, contexts);
  }

  const indent = indentLike(state, item[1]);
  const marker = itemMarker(context.env);
  return {
    changes: [{ from: pos, insert: `\n${indent}${marker.text}` }],
    head: pos + 1 + indent.length + marker.caret,
  };
}

export function continueListOnEnter(state: EditorState): TransactionSpec | null {
  if (!isLatexDocument()) return null;
  if (state.selection.ranges.some((range) => !range.empty)) return null;

  const plans = state.selection.ranges.map((range) =>
    planItemContinuation(state, range.head),
  );
  if (plans.some((plan) => plan === null)) return null;

  let index = 0;
  return {
    ...state.changeByRange(() => {
      const plan = plans[index++]!;
      return {
        changes: plan.changes,
        range: EditorSelection.cursor(plan.head),
      };
    }),
    scrollIntoView: true,
    userEvent: "input",
  };
}

export function deleteItemMarkupBackward(view: EditorView): boolean {
  const state = view.state;
  if (!isLatexDocument() || state.readOnly) return false;
  if (vimOwnsInput(view)) return false;
  const plans = state.selection.ranges.map((range) => {
    if (!range.empty) return null;
    const line = state.doc.lineAt(range.head);
    if (range.head - line.from > LINE_WINDOW) return null;
    const head = ITEM_MARKER_HEAD.exec(
      state.sliceDoc(line.from, range.head),
    );
    if (!head) return null;
    if (inLatexIgnoredRegion(state, range.head)) return null;
    if (!insideListEnvironment(state, line.from)) return null;
    return {
      from: line.from + head[1].length,
      to: range.head,
      insert: " ".repeat(head[2].length),
    };
  });
  if (plans.some((plan) => plan === null)) return false;

  let index = 0;
  view.dispatch({
    ...state.changeByRange(() => {
      const plan = plans[index++]!;
      return {
        changes: [{ from: plan.from, to: plan.to, insert: plan.insert }],
        range: EditorSelection.cursor(plan.to),
      };
    }),
    scrollIntoView: true,
    userEvent: "delete.backward",
  });
  return true;
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

  const indent = leadingWhitespace(
    lineWindow(state, state.doc.lineAt(open.pos)),
  );
  const line = state.doc.lineAt(head);
  const closing = `\\end{${open.name}}`;
  // Non-empty line: put \end on its own line, indented like its \begin.
  // Empty line: adopt the \begin indent. Whitespace-only line: the existing
  // whitespace already serves as indentation.
  const insert =
    line.length > LINE_WINDOW || lineWindow(state, line).trim().length > 0
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

export const latexListKeymap: KeyBinding[] = [
  {
    key: "Enter",
    run: (view) => {
      if (vimOwnsInput(view)) return false;
      const spec = continueListOnEnter(view.state);
      if (!spec) return false;
      view.dispatch(spec);
      return true;
    },
  },
  {
    key: "Shift-Enter",
    run: (view) =>
      isLatexDocument() && !vimOwnsInput(view)
        ? insertNewlineAndIndent(view)
        : false,
  },
  { key: "Backspace", run: deleteItemMarkupBackward },
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
