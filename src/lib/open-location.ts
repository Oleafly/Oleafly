import { revealSourceEditor } from "@/components/editor/wysiwyg/controller";
import { isBinaryProjectPath } from "@/lib/project-paths";
import { useFilesStore, type TabOpener } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useVisualModeStore } from "@/store/visual-mode";

export interface ProjectLocation {
  path: string;
  line?: number;
  column?: number;
  range?: { from: number; to: number };
}

export interface OpenLocationOptions {
  keepFocus?: boolean;
  keepSelection?: boolean;
  showEditor?: boolean;
  pdfView?: "editor" | "split";
  opener?: TabOpener;
}

export const EDITOR_DOCUMENT_WAIT_MS = 4000;
const VISUAL_SOURCE = /\.(?:tex|latex|ltx|md|markdown)$/i;
const MARKDOWN = /\.(?:md|markdown)$/i;

type EditorController = typeof import("@/components/editor/cm/controller");
type ReadyView = NonNullable<Awaited<ReturnType<EditorController["waitForEditorDocument"]>>>;
type StillCurrent = (state?: ReturnType<typeof useFilesStore.getState>) => boolean;

let pending: AbortController | null = null;

function inEditor(node: Element | null | undefined): boolean {
  return !!node?.closest?.(".cm-editor");
}

function centre(editor: EditorController, view: ReadyView, target: ProjectLocation) {
  if (target.range) editor.scrollEditorPositionLocally(view, target.range.from);
}

function reveal(editor: EditorController, view: ReadyView, target: ProjectLocation) {
  if (target.range) {
    const max = view.state.doc.length;
    const from = Math.min(Math.max(0, target.range.from), max);
    const to = Math.min(Math.max(from, target.range.to), max);
    editor.revealEditorRange(view, from, to);
  } else if (target.column === undefined) {
    editor.gotoLine(target.line ?? 1);
  } else {
    editor.gotoLine(target.line ?? 1, target.column);
  }
}

/**
 * Where a jump shows a file while the user stays in Visual mode: in
 * CodeMirror, which draws Visual mode for LaTeX and Typst and shows Markdown
 * beside its preview, or in the Markdown Visual editor. Null when the jump
 * should switch to Code, which it does unless "Stay in Visual mode" is on.
 */
export function keptVisualEditor(path: string): "codemirror" | "tiptap" | null {
  if (!useSettingsStore.getState().editorKeepVisualMode) return null;
  const visual = useVisualModeStore.getState();
  if (!visual.enabled) return null;
  return MARKDOWN.test(path) && !visual.markdownSplit ? "tiptap" : "codemirror";
}

/** Runs `show`, cancelling it when the jump goes stale or the editor takes too long. */
async function whileCurrent<T>(abort: AbortController, current: StillCurrent, show: () => Promise<T>): Promise<T> {
  const unsubscribe = useFilesStore.subscribe((state) => {
    if (!current(state)) abort.abort();
  });
  const giveUp = setTimeout(() => abort.abort(), EDITOR_DOCUMENT_WAIT_MS);
  try {
    return await show();
  } finally {
    clearTimeout(giveUp);
    unsubscribe();
  }
}

function revealInVisualEditor(
  target: ProjectLocation,
  options: OpenLocationOptions,
  abort: AbortController,
  current: StillCurrent,
): Promise<boolean> {
  return whileCurrent(abort, current, async () => {
    const visual = await import("@/components/editor/wysiwyg/reveal");
    if (!current()) return false;
    return visual.revealVisualLocation(target, abort.signal, {
      select: !options.keepSelection,
      focus: !options.keepSelection && !options.keepFocus,
    });
  });
}

/**
 * Shows the location in the Markdown Visual editor when the user stays in
 * Visual mode there, and otherwise switches to Code unless Visual mode is
 * drawn in CodeMirror. True when the Visual editor already showed it.
 */
async function showInVisualMode(
  target: ProjectLocation,
  options: OpenLocationOptions,
  abort: AbortController,
  current: StillCurrent,
): Promise<boolean> {
  const kept = keptVisualEditor(target.path);
  if (kept === "tiptap" && (await revealInVisualEditor(target, options, abort, current))) return true;
  if (kept !== "codemirror" && current()) revealSourceEditor();
  return false;
}

async function revealInCodeEditor(
  target: ProjectLocation,
  options: OpenLocationOptions,
  abort: AbortController,
  current: StillCurrent,
): Promise<boolean> {
  const editor = await import("@/components/editor/cm/controller");
  if (!current()) return false;
  return whileCurrent(abort, current, async () => {
    const view = await editor.waitForEditorDocument(target.path, abort.signal);
    if (!view || !current()) return false;
    if (options.keepSelection) centre(editor, view, target);
    else if (options.keepFocus) keepingFocus(editor, () => reveal(editor, view, target));
    else reveal(editor, view, target);
    return true;
  });
}

function openTab(
  files: ReturnType<typeof useFilesStore.getState>,
  path: string,
  opener: TabOpener | undefined,
): Promise<void> {
  return opener ? files.openFile(path, { opener }) : files.openFile(path);
}

function showEditor(pdfView: OpenLocationOptions["pdfView"]) {
  const settings = useSettingsStore.getState();
  if (pdfView === "editor" && settings.viewMode === "pdf") settings.setViewMode("editor");
  else settings.revealEditor();
}

function keepingFocus(editor: EditorController, move: () => void) {
  if (typeof document === "undefined") {
    move();
    return;
  }
  const restore = document.activeElement as HTMLElement | null;
  move();
  if (restore && !inEditor(restore) && typeof restore.focus === "function") {
    restore.focus({ preventScroll: true });
  }
  if (!inEditor(restore) && inEditor(document.activeElement)) {
    editor.getEditorView()?.contentDOM.blur();
  }
}

export async function openProjectLocation(
  target: ProjectLocation,
  options: OpenLocationOptions = {},
): Promise<boolean> {
  pending?.abort();
  const abort = new AbortController();
  pending = abort;
  try {
    return await openLocation(target, options, abort);
  } finally {
    if (pending === abort) pending = null;
  }
}

async function openLocation(
  target: ProjectLocation,
  options: OpenLocationOptions,
  abort: AbortController,
): Promise<boolean> {
  const before = useFilesStore.getState();
  const projectId = before.projectId;
  if (!projectId || !target.path) return false;
  if (options.showEditor !== false) showEditor(options.pdfView);
  if (before.activePath !== target.path) await openTab(before, target.path, options.opener);

  const current: StillCurrent = (state = useFilesStore.getState()) =>
    !abort.signal.aborted && state.projectId === projectId && state.activePath === target.path;
  if (!current()) return false;
  if (isBinaryProjectPath(target.path)) return true;
  const visualSource = options.showEditor !== false && VISUAL_SOURCE.test(target.path);
  if (visualSource && (await showInVisualMode(target, options, abort, current))) return true;
  return revealInCodeEditor(target, options, abort, current);
}
