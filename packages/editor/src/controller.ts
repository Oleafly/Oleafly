import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";

let view: EditorView | null = null;

export function setEditorView(v: EditorView | null) {
  view = v;
}

export function getEditorView(): EditorView | null {
  return view;
}

export function getCurrentLine(): number | null {
  const v = getEditorView();
  if (!v) return null;
  return v.state.doc.lineAt(v.state.selection.main.head).number;
}

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

  const furthestLine = Math.max(target - 1, total - target);
  for (let d = 0; d <= furthestLine; d++) {
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

// Clamped to doc bounds so a stale range from before an edit can't throw.
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

export function editorUndo() {
  const v = getEditorView();
  if (v) undo(v);
}
export function editorRedo() {
  const v = getEditorView();
  if (v) redo(v);
}

export function editorFind() {
  const v = getEditorView();
  if (v) openSearchPanel(v);
}

export function insertText(text: string) {
  insertAtCursor(text);
}
