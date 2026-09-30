import { revealSourceEditor } from "@/components/editor/wysiwyg/controller";
import { isBinaryProjectPath } from "@/lib/project-paths";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export interface ProjectLocation {
  /** Project-relative path. */
  path: string;
  /** 1-based. */
  line?: number;
  /** 1-based; clamped to the line length. */
  column?: number;
  /** Character offsets into the document; wins over line and column. */
  range?: { from: number; to: number };
}

export interface OpenLocationOptions {
  /** Hand keyboard focus back to where it was, for jumps the user did not start. */
  keepFocus?: boolean;
  /** Bring the source editor forward from a layout that hides it. Defaults to true. */
  showEditor?: boolean;
  /** From the PDF-only view, show the editor beside the PDF or in its place. Defaults to "split". */
  pdfView?: "editor" | "split";
}

export const EDITOR_DOCUMENT_WAIT_MS = 4000;
// Visual mode renders LaTeX and Markdown; a cursor jump needs their source.
const VISUAL_SOURCE = /\.(?:tex|latex|ltx|md|markdown)$/i;

type EditorController = typeof import("@/components/editor/cm/controller");
type ReadyView = NonNullable<Awaited<ReturnType<EditorController["waitForEditorDocument"]>>>;

let pending: AbortController | null = null;

function inEditor(node: Element | null | undefined): boolean {
  return !!node?.closest?.(".cm-editor");
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

/**
 * Opens a project file and moves the cursor to a line, column or range once
 * CodeMirror has installed that document. A newer call cancels an older one,
 * so a slow file read can never move the cursor in a tab the user has left.
 * PDFs and images open in their viewer tab with no cursor move. Resolves true
 * when the location is on screen.
 */
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
  if (before.activePath !== target.path) await before.openFile(target.path);

  const current = (state = useFilesStore.getState()) =>
    !abort.signal.aborted && state.projectId === projectId && state.activePath === target.path;
  if (!current()) return false;
  if (isBinaryProjectPath(target.path)) return true;
  // Turning Visual mode off is saved for the whole project, so do it only for
  // a file Visual mode renders, never for a PDF, a script or a data file.
  if (options.showEditor !== false && VISUAL_SOURCE.test(target.path)) revealSourceEditor();

  // Loaded on demand so callers outside the editor do not pull CodeMirror in.
  const editor = await import("@/components/editor/cm/controller");
  if (!current()) return false;
  const unsubscribe = useFilesStore.subscribe((state) => {
    if (!current(state)) abort.abort();
  });
  const giveUp = setTimeout(() => abort.abort(), EDITOR_DOCUMENT_WAIT_MS);
  try {
    const view = await editor.waitForEditorDocument(target.path, abort.signal);
    if (!view || !current()) return false;
    if (options.keepFocus) keepingFocus(editor, () => reveal(editor, view, target));
    else reveal(editor, view, target);
    return true;
  } finally {
    clearTimeout(giveUp);
    unsubscribe();
  }
}
