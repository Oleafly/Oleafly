import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";

/** Holds the active CodeMirror view so other UI can drive it. */
let view: EditorView | null = null;

export function setEditorView(v: EditorView | null) {
  view = v;
}

export function getEditorView(): EditorView | null {
  return view;
}

/** Current cursor line number (1-based). */
export function getCurrentLine(): number | null {
  const v = getEditorView();
  if (!v) return null;
  return v.state.doc.lineAt(v.state.selection.main.head).number;
}

/** Move the cursor to a line (1-based), scroll it to center, focus. */
export function gotoLine(line: number) {
  const v = getEditorView();
  if (!v) return;
  const n = Math.min(Math.max(1, line), v.state.doc.lines);
  const lineObj = v.state.doc.line(n);
  v.dispatch({
    selection: EditorSelection.single(lineObj.from),
    effects: EditorView.scrollIntoView(lineObj.from, { y: "center" }),
  });
  v.focus();
}

/**
 * Inverse-SyncTeX refinement: find `word` in the source near `line` and select
 * it, so a PDF Cmd-click lands on the exact word instead of the line start (which
 * often sits on a `\begin`/`\end` or the box origin). Searches the target line
 * first, then outward a few lines, preferring a whole-word match. Returns false
 * if the word isn't found in the window so the caller can fall back to the line.
 */
export function selectWordNearLine(line: number, word: string): boolean {
  const v = getEditorView();
  if (!v) return false;
  const needle = word.trim();
  if (!needle) return false;
  const doc = v.state.doc;
  const total = doc.lines;
  const target = Math.min(Math.max(1, line), total);
  const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

  const findInLine = (ln: number): { from: number; to: number } | null => {
    if (ln < 1 || ln > total) return null;
    const l = doc.line(ln);
    const text = l.text;
    let whole = -1;
    let anySub = -1;
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
      if (anySub < 0) anySub = i;
      if (!isWordChar(text[i - 1]) && !isWordChar(text[i + needle.length])) {
        whole = i; // prefer a standalone occurrence
        break;
      }
    }
    const idx = whole >= 0 ? whole : anySub;
    return idx < 0 ? null : { from: l.from + idx, to: l.from + idx + needle.length };
  };

  const WINDOW = 12;
  for (let d = 0; d <= WINDOW; d++) {
    for (const ln of d === 0 ? [target] : [target - d, target + d]) {
      const m = findInLine(ln);
      if (m) {
        v.dispatch({
          selection: EditorSelection.single(m.from, m.to),
          effects: EditorView.scrollIntoView(m.from, { y: "center" }),
        });
        v.focus();
        return true;
      }
    }
  }
  return false;
}

/** Select a document offset range, scroll it to center, and focus. */
export function gotoRange(from: number, to: number) {
  const v = getEditorView();
  if (!v) return;
  const max = v.state.doc.length;
  const a = Math.min(Math.max(0, from), max);
  const b = Math.min(Math.max(0, to), max);
  v.dispatch({
    selection: EditorSelection.single(a, b),
    effects: EditorView.scrollIntoView(a, { y: "center" }),
  });
  v.focus();
}

/** Insert text at the current cursor/selection and refocus the editor. */
export function insertAtCursor(text: string) {
  const v = getEditorView();
  if (!v) return;
  const sel = v.state.selection.main;
  v.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + text.length },
  });
  v.focus();
}

/** Replace a specific document range with text (used to insert a generated
 *  figure over the paragraph it was generated from). Clamped to doc bounds so a
 *  stale range from before an edit can't throw. */
export function replaceRange(from: number, to: number, text: string) {
  const v = getEditorView();
  if (!v) return;
  const len = v.state.doc.length;
  const a = Math.max(0, Math.min(from, len));
  const b = Math.max(a, Math.min(to, len));
  v.dispatch({
    changes: { from: a, to: b, insert: text },
    selection: { anchor: a + text.length },
  });
  v.focus();
}

/** Wrap the current selection with `before`...`after`. */
export function wrapSelection(before: string, after: string) {
  const v = getEditorView();
  if (!v) return;
  const sel = v.state.selection.main;
  const selected = v.state.sliceDoc(sel.from, sel.to);
  v.dispatch({
    changes: {
      from: sel.from,
      to: sel.to,
      insert: `${before}${selected}${after}`,
    },
    selection: {
      anchor: sel.from + before.length,
      head: sel.to + before.length,
    },
  });
  v.focus();
}

export function focusEditor() {
  getEditorView()?.focus();
}

/** Undo / redo the last editor change. */
export function editorUndo() {
  const v = getEditorView();
  if (v) undo(v);
}
export function editorRedo() {
  const v = getEditorView();
  if (v) redo(v);
}

/** Open the in-editor find/replace panel. */
export function editorFind() {
  const v = getEditorView();
  if (v) openSearchPanel(v);
}

/** Insert text and leave the cursor at the end of the insertion. */
export function insertText(text: string) {
  insertAtCursor(text);
}
