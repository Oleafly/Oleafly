import { EditorView } from "@codemirror/view";
import { EditorSelection, type Extension, type SelectionRange } from "@codemirror/state";
import { isolateHistory, undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { CodeMirror, getCM } from "@replit/codemirror-vim";
import type { SourceWord } from "./forward-sync";
import { renderedTex, sourceOffset } from "./tex-text";
import {
  contextMatches,
  contextScores,
  convincingFarMatch,
  type WordContext,
  type WordRange,
} from "./word-context";

export type { WordContext } from "./word-context";
export {
  findWordOnPages,
  linesFromAnchor,
  pickForwardLine,
  type PageRect,
  type PdfTextRun,
  type SourceWord,
  type SyncTexLine,
} from "./forward-sync";

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

export interface BackgroundDocumentChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export type BackgroundDocumentEditor = (
  path: string,
  base: string,
  changes: readonly BackgroundDocumentChange[],
) => boolean;

let backgroundDocumentEditor: BackgroundDocumentEditor | null = null;

export function registerBackgroundDocumentEditor(editor: BackgroundDocumentEditor): () => void {
  backgroundDocumentEditor = editor;
  return () => {
    if (backgroundDocumentEditor === editor) backgroundDocumentEditor = null;
  };
}

export function editBackgroundDocument(
  path: string,
  base: string,
  changes: readonly BackgroundDocumentChange[],
): boolean {
  return backgroundDocumentEditor?.(path, base, changes) ?? false;
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

/** `column` is 1-based, as compilers print it, and stops at the line end. */
export function gotoLine(line: number, column?: number) {
  const v = getEditorView();
  if (!v) return;
  const n = Math.min(Math.max(1, line), v.state.doc.lines);
  const lineObj = v.state.doc.line(n);
  const offset = column === undefined ? 0 : Math.min(Math.max(0, column - 1), lineObj.length);
  revealEditorRange(v, lineObj.from + offset);
}

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}\u200C\u200D]/u;

function characterBefore(text: string, index: number): string | undefined {
  return index > 0 ? Array.from(text.slice(Math.max(0, index - 2), index)).pop() : undefined;
}

function characterAt(text: string, index: number): string | undefined {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

/**
 * Lines on each side of the reported line searched for the clicked word.
 * SyncTeX names the right line for almost every word, but table cells come out
 * a row or two off and `\maketitle` text a few lines below `\title`.
 */
const NEAR_LINES = 3;
/**
 * Score taken off a candidate per line it is away from the reported line. A
 * context word right next to the click scores 1, so a neighbouring line has to
 * match clearly better; with less, a heading that repeats the end of the
 * paragraph above it lost to that paragraph.
 */
const LINE_PENALTY = 1.5;
/**
 * A near match whose context scores this much is taken without looking
 * further. Below it, a match elsewhere in the file can win, but only on the
 * evidence `convincingFarMatch` asks for: without that a generated word
 * ("Figure", a section number, a citation label) jumped to whatever spelled
 * the same anywhere in the file, since "of the" lines up almost everywhere.
 * This is what finds `\title` text, which SyncTeX puts on the `\maketitle` line.
 */
const NEAR_EVIDENCE = 3;

/**
 * The whole word when the clicked one is half of a word LaTeX hyphenated at a
 * line end ("sec-" then "tion"), with the other half taken out of the context.
 */
function rejoinHyphenated(word: string, context: WordContext | undefined) {
  if (!context) return null;
  const next = /^-\s+([\p{L}\p{M}]+)/u.exec(context.after);
  if (next) return { word: word + next[1], context: { ...context, after: context.after.slice(next[0].length) } };
  const previous = /([\p{L}\p{M}]+)-\s+$/u.exec(context.before);
  if (previous) {
    return { word: previous[1] + word, context: { ...context, before: context.before.slice(0, previous.index) } };
  }
  return null;
}

interface WordCandidate extends WordRange {
  /** Lines from the reported line. */
  distance: number;
  /** Whole word, not part of a longer word or a command name. */
  standalone: boolean;
}

function best<T>(items: readonly T[], score: (item: T, index: number) => number): T | undefined {
  let chosen: T | undefined;
  let chosenScore = Number.NEGATIVE_INFINITY;
  items.forEach((item, index) => {
    const value = score(item, index);
    if (value > chosenScore + 1e-9) {
      chosen = item;
      chosenScore = value;
    }
  });
  return chosen;
}

export function selectWordNearLine(line: number, word: string, context?: WordContext): boolean {
  const v = getEditorView();
  if (!v) return false;
  const clicked = word.trim().normalize("NFC");
  if (!clicked) return false;
  const doc = v.state.doc;
  const total = doc.lines;
  const target = Math.min(Math.max(1, line), total);
  const isWordChar = (c: string | undefined) => !!c && WORD_CHARACTER.test(c);

  const findInLine = (needle: string, ln: number): WordCandidate[] => {
    const l = doc.line(ln);
    const rendered = renderedTex(l.text);
    const text = rendered.text;
    const offset = (index: number, roundUp: boolean) => l.from + sourceOffset(rendered, index, roundUp);
    const found: WordCandidate[] = [];
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
      const before = characterBefore(text, i);
      const standalone = !isWordChar(before) && before !== "\\" && !isWordChar(characterAt(text, i + needle.length));
      // Part of a longer word: select that whole word, as the click meant it.
      let start = i;
      let end = i + needle.length;
      while (isWordChar(characterBefore(text, start))) start -= (characterBefore(text, start) as string).length;
      while (isWordChar(characterAt(text, end))) end += (characterAt(text, end) as string).length;
      found.push({ from: offset(start, false), to: offset(end, true), distance: Math.abs(ln - target), standalone });
    }
    return found;
  };

  const find = (needle: string, around: WordContext | undefined): WordCandidate | undefined => {
    // Nearest lines first, the line above before the one below, so that
    // without any context the old search order still decides.
    const near: WordCandidate[] = [];
    for (let d = 0; d <= NEAR_LINES; d++) {
      for (const ln of d === 0 ? [target] : [target - d, target + d]) {
        if (ln >= 1 && ln <= total) near.push(...findInLine(needle, ln));
      }
    }
    const whole = near.filter((candidate) => candidate.standalone);
    const pool = whole.length ? whole : near;
    const scores = contextScores(doc, pool, around);
    const nearest = best(
      pool.map((candidate, index) => ({ candidate, score: scores[index] })),
      (entry) => entry.score - LINE_PENALTY * entry.candidate.distance,
    );
    if (nearest && (!around || nearest.score >= NEAR_EVIDENCE)) return nearest.candidate;
    if (!around) return undefined;

    const far: WordCandidate[] = [];
    for (let ln = 1; ln <= total; ln++) {
      if (Math.abs(ln - target) > NEAR_LINES) {
        far.push(...findInLine(needle, ln).filter((candidate) => candidate.standalone));
      }
    }
    const ranked = contextMatches(doc, far, around)
      .map((match, index) => ({ candidate: far[index], ...match }))
      .sort((a, b) => b.score - a.score);
    const [first, second] = ranked;
    return convincingFarMatch(first, second) ? first.candidate : nearest?.candidate;
  };

  const joined = rejoinHyphenated(clicked, context);
  const chosen = (joined && find(joined.word, joined.context)) || find(clicked, context);
  if (!chosen) return false;
  revealEditorRange(v, chosen.from, chosen.to);
  return true;
}

/**
 * Selects the word at a 0-based column of a 1-based line when it is the word
 * that was clicked, and reports whether it did. Typst's preview server names
 * the clicked character exactly, but a click on link text can come back
 * elsewhere in the line.
 */
export function selectWordAt(line: number, column: number, word: string): boolean {
  const v = getEditorView();
  if (!v || line < 1 || line > v.state.doc.lines) return false;
  const l = v.state.doc.line(line);
  const text = l.text;
  const isWordChar = (c: string | undefined) => !!c && WORD_CHARACTER.test(c);
  let at = Math.min(Math.max(0, column), text.length);
  if (!isWordChar(characterAt(text, at)) && isWordChar(characterBefore(text, at))) {
    at -= (characterBefore(text, at) as string).length;
  }
  if (!isWordChar(characterAt(text, at))) return false;
  let start = at;
  let end = at;
  while (isWordChar(characterBefore(text, start))) start -= (characterBefore(text, start) as string).length;
  while (isWordChar(characterAt(text, end))) end += (characterAt(text, end) as string).length;
  const found = text.slice(start, end).normalize("NFC").toLowerCase();
  if (found !== word.trim().normalize("NFC").toLowerCase()) return false;
  revealEditorRange(v, l.from + start, l.from + end);
  return true;
}

/** Source text taken on each side of the cursor's word for `wordAtCursor`. */
const SOURCE_AROUND = 300;

/**
 * The word the cursor is in, or the one it just left, with the source text on
 * each side, so the PDF side can find the same spot. Null off a word and on a
 * command name, which never reaches the PDF.
 */
export function wordAtCursor(): SourceWord | null {
  const v = getEditorView();
  if (!v) return null;
  const doc = v.state.doc;
  const head = v.state.selection.main.head;
  const line = doc.lineAt(head);
  // Read the line as the PDF shows it, so a cursor in `caf\'e` looks for "café".
  const rendered = renderedTex(line.text);
  const text = rendered.text;
  const isWordChar = (c: string | undefined) => !!c && WORD_CHARACTER.test(c);
  let at = head - line.from;
  if (rendered.offsets) {
    let mapped = 0;
    for (const [source, shown] of rendered.offsets) {
      if (source > at) break;
      mapped = shown;
    }
    at = mapped;
  }
  if (!isWordChar(characterAt(text, at)) && isWordChar(characterBefore(text, at))) {
    at -= (characterBefore(text, at) as string).length;
  }
  if (!isWordChar(characterAt(text, at))) return null;
  let start = at;
  let end = at;
  while (isWordChar(characterBefore(text, start))) start -= (characterBefore(text, start) as string).length;
  while (isWordChar(characterAt(text, end))) end += (characterAt(text, end) as string).length;
  if (characterBefore(text, start) === "\\") return null;
  const from = line.from + sourceOffset(rendered, start, false);
  const to = line.from + sourceOffset(rendered, end, true);
  return {
    word: text.slice(start, end),
    before: doc.sliceString(Math.max(0, from - SOURCE_AROUND), from),
    after: doc.sliceString(to, Math.min(doc.length, to + SOURCE_AROUND)),
  };
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
