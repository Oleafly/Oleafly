import { EditorView } from "@codemirror/view";
import { EditorSelection, type Extension, type SelectionRange } from "@codemirror/state";
import { isolateHistory, undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { CodeMirror, getCM } from "@replit/codemirror-vim";

let view: EditorView | null = null;
let documentPath: string | null = null;

type DocumentReadyListener = (path: string | null, view: EditorView | null) => void;
const documentReadyListeners = new Set<DocumentReadyListener>();

function publishDocumentReady() {
  for (const listener of documentReadyListeners) listener(documentPath, view);
}

export function setEditorView(v: EditorView | null) {
  view = v;
  if (!v) documentPath = null;
  publishDocumentReady();
}

export function getEditorView(): EditorView | null {
  return view;
}

/**
 * Marks the source document currently installed in the shared EditorView.
 *
 * File navigation must wait for this signal instead of guessing how long the
 * React/CodeMirror file-swap effect will take. Callers can therefore select a
 * project range immediately after the matching document is actually ready.
 */
export function setEditorDocumentPath(path: string | null) {
  documentPath = path;
  publishDocumentReady();
}

export function getEditorDocumentPath(): string | null {
  return documentPath;
}

/**
 * Observes which document the shared EditorView holds, for callers that have to
 * re-attach to the view itself rather than wait for one document.
 *
 * The listener fires immediately with the current state, so a subscriber that
 * mounts after the editor is already up does not sit idle until the next file
 * swap.
 */
export function subscribeEditorDocument(
  listener: DocumentReadyListener,
): () => void {
  documentReadyListeners.add(listener);
  listener(documentPath, view);
  return () => {
    documentReadyListeners.delete(listener);
  };
}

export function waitForEditorDocument(
  path: string,
  signal?: AbortSignal,
): Promise<EditorView | null> {
  if (documentPath === path && view) return Promise.resolve(view);
  if (signal?.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    const finish = (readyView: EditorView | null) => {
      documentReadyListeners.delete(onReady);
      signal?.removeEventListener("abort", onAbort);
      resolve(readyView);
    };
    const onReady: DocumentReadyListener = (readyPath, readyView) => {
      if (readyPath === path && readyView) finish(readyView);
    };
    const onAbort = () => finish(null);
    documentReadyListeners.add(onReady);
    signal?.addEventListener("abort", onAbort, { once: true });

    // Close the subscribe/check race if the editor became ready between the
    // first check and listener registration.
    if (documentPath === path && view) finish(view);
  });
}

export function getCurrentLine(): number | null {
  const v = getEditorView();
  if (!v) return null;
  return v.state.doc.lineAt(v.state.selection.main.head).number;
}

/**
 * Centers a document position by moving only CodeMirror's own scroll surface.
 * This also serves embedded and diff editors that aren't the global editor.
 */
export function scrollEditorPositionLocally(
  v: EditorView,
  position: number,
) {
  const target = Math.min(
    Math.max(0, position),
    v.state.doc.length,
  );
  v.requestMeasure({
    read(currentView) {
      const block = currentView.lineBlockAt(target);
      return Math.max(
        0,
        block.top -
          (currentView.scrollDOM.clientHeight - block.height) / 2,
      );
    },
    write(scrollTop, currentView) {
      currentView.scrollDOM.scrollTop = scrollTop;
    },
  });
}

function centerInEditorScroller(
  v: EditorView,
  range: SelectionRange,
  options: { readonly y: string },
): boolean {
  if (options.y !== "center") return false;
  const block = v.lineBlockAt(range.head);
  const scroller = v.scrollDOM;
  const box = scroller.getBoundingClientRect();
  const middle = v.documentTop + block.top + block.height / 2;
  const target = box.top + scroller.clientTop + scroller.clientHeight / 2;
  scroller.scrollTop += (middle - target) / v.scaleY;
  return true;
}

export const centerWithinEditor: Extension = EditorView.scrollHandler.of(centerInEditorScroller);

/**
 * Reveal a source range without invoking the browser's ancestor-scrolling
 * algorithm.
 *
 * CodeMirror's `scrollIntoView` effect is useful in ordinary pages, but a
 * desktop split-pane shell must never allow a source jump to move the document
 * root. In WebKit, a far-away PDF/outline jump can otherwise center the editor
 * by scrolling every scrollable ancestor, which pulls the application toolbar
 * above the viewport. Measure the document position through CodeMirror, then
 * move only its own `.cm-scroller`.
 */
export function revealEditorRange(
  v: EditorView,
  from: number,
  to: number = from,
) {
  const max = v.state.doc.length;
  const a = Math.min(Math.max(0, from), max);
  const b = Math.min(Math.max(a, to), max);

  if (v.state.facet(EditorView.scrollHandler).includes(centerInEditorScroller)) {
    v.dispatch({
      selection: EditorSelection.single(a, b),
      effects: EditorView.scrollIntoView(a, { y: "center" }),
    });
  } else {
    v.dispatch({
      selection: EditorSelection.single(a, b),
    });
    scrollEditorPositionLocally(v, a);
  }

  // CodeMirror prevents scrolling and synchronizes the DOM selection while
  // suppressing its observer. Focusing contentDOM directly can restore the
  // old browser selection and overwrite this navigation when focus returns
  // from a toolbar or another editor on Windows.
  v.focus();
}

export function gotoLine(line: number) {
  const v = getEditorView();
  if (!v) return;
  const n = Math.min(Math.max(1, line), v.state.doc.lines);
  const lineObj = v.state.doc.line(n);
  revealEditorRange(v, lineObj.from);
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
        revealEditorRange(v, m.from, m.to);
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
  revealEditorRange(v, a, b);
}

export function insertAtCursor(text: string) {
  const v = getEditorView();
  if (!v) return;
  const sel = v.state.selection.main;
  v.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + text.length },
    annotations: isolateHistory.of("full"),
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
    annotations: isolateHistory.of("full"),
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
    annotations: isolateHistory.of("full"),
  });
  v.focus();
}

export function insertTemplate(template: string, selStart: number, selEnd: number) {
  const v = getEditorView();
  if (!v) return;
  const sel = v.state.selection.main;
  v.dispatch({
    changes: { from: sel.from, to: sel.to, insert: template },
    selection: { anchor: sel.from + selStart, head: sel.from + selEnd },
    annotations: isolateHistory.of("full"),
  });
  v.focus();
}

export function wrapSelectionOrPlaceholder(before: string, after: string, placeholder: string) {
  const v = getEditorView();
  if (!v) return;
  const sel = v.state.selection.main;
  const content = sel.from !== sel.to ? v.state.sliceDoc(sel.from, sel.to) : placeholder;
  insertTemplate(`${before}${content}${after}`, before.length, before.length + content.length);
}

export function insertEnvironment(name: string) {
  const v = getEditorView();
  if (!v) return;
  const sel = v.state.selection.main;
  const inner = v.state.sliceDoc(sel.from, sel.to);
  const head = `\\begin{${name}}\n  `;
  const template = `${head}${inner}\n\\end{${name}}\n`;
  const cursor = head.length + inner.length;
  insertTemplate(template, cursor, cursor);
}

export function insertListEnvironment(name: string) {
  const v = getEditorView();
  if (!v) return;
  const sel = v.state.selection.main;
  const items = v.state
    .sliceDoc(sel.from, sel.to)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const body = items.length > 0 ? items.map((item) => String.raw`  \item ${item}`).join("\n") : String.raw`  \item `;
  const head = `\\begin{${name}}\n`;
  const cursor = head.length + body.length;
  insertTemplate(`${head}${body}\n\\end{${name}}\n`, cursor, cursor);
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

/**
 * Runs history through the Vim adapter when the published source view is in
 * Vim mode. The adapter also restores Vim's expected cursor/selection state,
 * which CodeMirror's bare history commands cannot do on their own.
 */
export function editorVimUndo(): boolean {
  const v = getEditorView();
  const cm = v ? getCM(v) : null;
  if (!cm?.state.vim) return false;
  cm.operation(() => CodeMirror.commands.undo(cm));
  return true;
}

export function editorVimRedo(): boolean {
  const v = getEditorView();
  const cm = v ? getCM(v) : null;
  if (!cm?.state.vim) return false;
  cm.operation(() => CodeMirror.commands.redo(cm));
  return true;
}

export function editorFind() {
  const v = getEditorView();
  if (v) openSearchPanel(v);
}

export function insertText(text: string) {
  insertAtCursor(text);
}
