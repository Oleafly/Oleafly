import {
  synctexForward,
  synctexInverse,
  synctexMapLine,
  type SynctexForwardHit,
  type SynctexRect,
} from "@/lib/tauri";
import {
  findWordOnPages,
  getCurrentLine,
  getEditorView,
  gotoLine,
  linesFromAnchor,
  pickForwardLine,
  selectWordAt,
  selectWordNearLine,
  wordAtCursor,
  type WordContext,
} from "@/components/editor/cm/controller";
import { gotoRect, pdfPageText, type PdfTextRun } from "@/components/pdf/pdfController";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";
import {
  isCompileCheckpointCurrent,
  type CompileSourceSnapshot,
  useCompileStore,
} from "@/store/compile";
import {
  sameCompileOutput,
  type CompileSuccessCheckpoint,
} from "@/lib/compile-checkpoint";
import {
  currentProjectSourcePaths,
  useIndexStore,
} from "@/store/project-index";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { engineSyncsPath } from "@/lib/document-engine";
import { resolveCompilePath } from "@/lib/compile-file-path";
import { logError } from "@/lib/log";
import { openProjectLocation } from "@/lib/open-location";

const loadTypstSync = () => import("@/features/typst-sync");

function cursorColumn(): number | null {
  const view = getEditorView();
  if (!view) return null;
  const head = view.state.selection.main.head;
  return head - view.state.doc.lineAt(head).from;
}

async function typstForward(
  projectId: string,
  mainDoc: string,
  file: string,
  line: number,
  column: number | null,
) {
  const sync = await loadTypstSync();
  sync.watchTypstSyncProject(projectId);
  return sync.typstForward({ projectId, mainDoc, file, line, column });
}

async function typstInverse(
  projectId: string,
  mainDoc: string,
  page: number,
  x: number,
  y: number,
) {
  const sync = await loadTypstSync();
  sync.watchTypstSyncProject(projectId);
  return sync.typstInverse({ projectId, mainDoc, page, x, y });
}

type SyncTexContext = readonly [
  CompileSuccessCheckpoint,
  CompileSourceSnapshot | null,
];

function currentSyncTexContext(
  expectedCheckpoint: CompileSuccessCheckpoint | null = null,
): SyncTexContext | null {
  const compile = useCompileStore.getState();
  const checkpoint = compile.lastCompileCheckpoint;
  const files = useFilesStore.getState();
  if (
    !checkpoint ||
    (expectedCheckpoint &&
      !sameCompileOutput(checkpoint, expectedCheckpoint)) ||
    files.projectId !== checkpoint.projectId ||
    resolveEffectiveMainDoc().mainDoc !== checkpoint.mainDocument
  ) {
    return null;
  }
  const fresh: boolean = isCompileCheckpointCurrent(checkpoint);
  if (fresh) {
    return [checkpoint, null];
  }
  const snapshot = compile.compiledSources;
  if (!snapshot) return null;
  return [checkpoint, snapshot];
}

function contextStillValid(context: SyncTexContext): boolean {
  return (
    currentSyncTexContext(context[0])?.[1] === context[1]
  );
}

function currentSource(path: string): string | null {
  const files = useFilesStore.getState();
  return (
    files.files[path]?.content ??
    useIndexStore.getState().texts[path] ??
    null
  );
}

type StaleLineMapping = readonly [
  compiledPath: string,
  currentPath: string,
  line: number,
  source: string,
];

async function mapStaleLine(
  context: SyncTexContext,
  path: string,
  line: number,
  currentToCompiled: boolean,
): Promise<StaleLineMapping | null> {
  const snapshot = context[1];
  if (!snapshot) return null;
  const compiledPath = resolveCompilePath(path, Object.keys(snapshot.texts));
  const currentPath = compiledPath
    ? resolveCompilePath(compiledPath, currentProjectSourcePaths())
    : null;
  if (!compiledPath || !currentPath) return null;
  const source = currentSource(currentPath);
  if (source === null) return null;
  const mapped = await synctexMapLine(
    snapshot.texts[compiledPath],
    source,
    line,
    currentToCompiled,
  );
  if (
    !mapped ||
    !contextStillValid(context) ||
    currentSource(currentPath) !== source
  ) {
    return null;
  }
  return [compiledPath, currentPath, mapped, source];
}

export function canUseSyncTexForCheckpoint(
  checkpoint: CompileSuccessCheckpoint | null,
): boolean {
  return currentSyncTexContext(checkpoint) !== null;
}

function pdfInOwnWindow(projectId: string | null): boolean {
  return projectId !== null && usePreviewDetachedStore.getState().projectId === projectId;
}

export function goToSyncTex() {
  const s = useSettingsStore.getState();
  if (s.viewMode === "editor" && !pdfInOwnWindow(useFilesStore.getState().projectId)) {
    s.setViewMode("split");
    requestAnimationFrame(() => void forwardFromCursor());
  } else {
    void forwardFromCursor();
  }
}

/**
 * The typeset line with the cursor's word in it. SyncTeX maps a source line to
 * every typeset line it fills, and its first box can be many lines from the
 * cursor when one source line holds a paragraph. With no SyncTeX line at all
 * (`\title` text, typeset at `\maketitle`), the word is looked for on the page
 * SyncTeX fell back to. Keeps SyncTeX's box when the word is not found.
 */
async function pageTexts(pages: readonly number[]): Promise<Map<number, PdfTextRun[]> | null> {
  const runsByPage = new Map<number, PdfTextRun[]>();
  try {
    const fetched = await Promise.all(pages.map(async (page) => [page, await pdfPageText(page)] as const));
    for (const [page, runs] of fetched) {
      if (runs) runsByPage.set(page, runs);
    }
  } catch (e) {
    void logError("synctex forward", e);
    return null;
  }
  return runsByPage;
}

async function lineWithCursorWord(
  hit: SynctexForwardHit,
  spot: ReturnType<typeof wordAtCursor>,
): Promise<SynctexRect> {
  if (!spot) return hit;
  const lines = hit.lines ?? [];
  const pages = lines.length ? [...new Set(lines.map((line) => line.page))] : [hit.page];
  const runsByPage = await pageTexts(pages);
  if (!runsByPage) return hit;
  const found = lines.length
    ? pickForwardLine(lines, runsByPage, spot)
    : findWordOnPages(pages, runsByPage, spot);
  return found ?? hit;
}

/**
 * The typeset line with the cursor's word in it for Typst. Typst's preview
 * server jumps to the start of the paragraph (or other block) that holds the
 * cursor, whichever word the cursor is on, so the word is looked for in the
 * lines around that point. Keeps the server's point when it is not found.
 */
async function typstLineWithCursorWord(
  jump: SynctexRect,
  spot: ReturnType<typeof wordAtCursor>,
): Promise<SynctexRect> {
  if (!spot) return jump;
  const runsByPage = await pageTexts([jump.page - 1, jump.page, jump.page + 1].filter((page) => page >= 1));
  if (!runsByPage) return jump;
  return pickForwardLine(linesFromAnchor(jump, runsByPage), runsByPage, spot) ?? jump;
}

function forwardTarget(
  hit: SynctexForwardHit,
  spot: ReturnType<typeof wordAtCursor>,
  typst: boolean,
): Promise<SynctexRect> {
  return typst ? typstLineWithCursorWord(hit, spot) : lineWithCursorWord(hit, spot);
}

export async function showForwardTarget(
  hit: SynctexForwardHit,
  spot: ReturnType<typeof wordAtCursor>,
  typst: boolean,
) {
  gotoRect(await forwardTarget(hit, spot, typst));
}

export async function forwardFromCursor() {
  const files = useFilesStore.getState();
  const { projectId, activePath } = files;
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  if (!files.engineLoaded || !engineSyncsPath(files.engine, activePath)) return;
  if (!projectId || !activePath) {
    void logError("synctex forward", "no active project/file");
    return;
  }
  const context = currentSyncTexContext();
  if (!context) return;
  const line = getCurrentLine();
  if (line == null) {
    void logError("synctex forward", "could not determine cursor line");
    return;
  }
  const typst = files.engine.id === "typst";
  const column = typst ? cursorColumn() : null;
  const spot = wordAtCursor();
  try {
    let compiledPath = activePath;
    let compiledLine = line;
    let stale: StaleLineMapping | null = null;
    if (context[1]) {
      stale = await mapStaleLine(context, activePath, line, true);
      const mapped = stale;
      if (!mapped) return;
      compiledPath = mapped[0];
      compiledLine = mapped[2];
    }
    const forwardColumn = stale ? null : column;
    const rect = typst
      ? await typstForward(projectId, mainDoc, compiledPath, compiledLine, forwardColumn)
      : await synctexForward(projectId, mainDoc, compiledPath, compiledLine);
    const stillCurrent = () =>
      contextStillValid(context) &&
      !(stale && currentSource(stale[1]) !== stale[3]);
    if (!stillCurrent()) return;
    if (!rect) {
      void logError(
        "synctex forward",
        `no SyncTeX rect for ${compiledPath}:${compiledLine}`,
      );
      return;
    }
    if (pdfInOwnWindow(projectId)) {
      const { sendPreviewForward } = await import("@/lib/preview-workspace");
      await sendPreviewForward({ projectId, checkpoint: context[0], hit: rect, spot, typst });
      return;
    }
    const target = await forwardTarget(rect, spot, typst);
    if (stillCurrent()) gotoRect(target);
  } catch (e) {
    void logError("synctex forward", e);
  }
}

function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (k: number) =>
      k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1));
    step(n);
  });
}

export async function openFileAndGotoLine(file: string | null, line: number, column?: number) {
  if (!file) {
    if (column === undefined) gotoLine(line);
    else gotoLine(line, column);
    return;
  }
  const target = resolveCompilePath(file, currentProjectSourcePaths());
  if (target) await openProjectLocation(column === undefined ? { path: target, line } : { path: target, line, column });
}

async function resolveInverseTarget(
  context: SyncTexContext,
  hitFile: string,
  hitLine: number,
): Promise<{ path: string | null; line: number } | null> {
  if (!context[1]) {
    const path = hitFile
      ? resolveCompilePath(hitFile, currentProjectSourcePaths())
      : useFilesStore.getState().activePath;
    if (hitFile && !path) return null;
    return { path, line: hitLine };
  }
  const mapped = await mapStaleLine(context, hitFile, hitLine, false);
  if (!mapped) return null;
  return { path: mapped[1], line: mapped[2] };
}

async function focusInverseTarget(
  store: ReturnType<typeof useFilesStore.getState>,
  context: SyncTexContext,
  targetPath: string | null,
): Promise<boolean> {
  const activePath = useFilesStore.getState().activePath;
  if (!targetPath || targetPath === activePath) return true;
  await store.openFile(targetPath);
  await nextFrames(2);
  return contextStillValid(context);
}

/**
 * Puts the cursor where a PDF click points in the source. Typst's preview
 * server names the clicked character (`column`), so the word there is
 * selected; a click on link text can come back elsewhere in the line, and then
 * the clicked word is looked for around that line. SyncTeX only resolves to a
 * line (its column is coarse and often lands on a `\begin`/`\end`), so the
 * nearest matching word is selected, or else the line start.
 */
function placeInverseCursor(line: number, column: number | null, word?: string, wordContext?: WordContext) {
  if (column !== null) {
    if (word && (selectWordAt(line, column, word) || selectWordNearLine(line, word, wordContext))) return;
    gotoLine(line, column + 1);
    return;
  }
  if (word && selectWordNearLine(line, word, wordContext)) return;
  gotoLine(line);
}

interface InverseTarget {
  path: string | null;
  line: number;
  column: number | null;
}

async function resolveInverse(
  page: number,
  x: number,
  y: number,
  expectedCheckpoint: CompileSuccessCheckpoint | null,
  beforeLookup?: () => void,
): Promise<{ context: SyncTexContext; target: InverseTarget } | null> {
  const store = useFilesStore.getState();
  const { projectId } = store;
  if (!projectId) return null;
  if (!store.engineLoaded || !store.engine.capabilities.supports_synctex) return null;
  const context = currentSyncTexContext(expectedCheckpoint);
  if (!context) return null;
  beforeLookup?.();
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  const typst = store.engine.id === "typst";
  try {
    const hit = typst
      ? await typstInverse(projectId, mainDoc, page, x, y)
      : await synctexInverse(projectId, mainDoc, page, x, y);
    if (!hit || !contextStillValid(context)) return null;
    const target = await resolveInverseTarget(context, hit.file, hit.line);
    if (!target) return null;
    return { context, target: { ...target, column: typst && !context[1] ? hit.column : null } };
  } catch (e) {
    void logError("synctex inverse", e);
    return null;
  }
}

export async function sourceLineAt(
  page: number,
  x: number,
  y: number,
  expectedCheckpoint: CompileSuccessCheckpoint | null = null,
): Promise<InverseTarget | null> {
  return (await resolveInverse(page, x, y, expectedCheckpoint))?.target ?? null;
}

export async function inverseFromClick(
  page: number,
  x: number,
  y: number,
  word?: string,
  expectedCheckpoint: CompileSuccessCheckpoint | null = null,
  wordContext?: WordContext,
) {
  const store = useFilesStore.getState();
  const resolved = await resolveInverse(page, x, y, expectedCheckpoint, () => {
    const currentLine = getCurrentLine();
    if (word && currentLine != null) selectWordNearLine(currentLine, word, wordContext);
  });
  if (!resolved) return false;
  const { context, target } = resolved;
  try {
    if (!(await focusInverseTarget(store, context, target.path))) return false;
    placeInverseCursor(target.line, target.column, word, wordContext);
    return true;
  } catch (e) {
    void logError("synctex inverse", e);
    return false;
  }
}

const MAX_FORWARD_LINES = 40;

export interface CompiledSource {
  path: string;
  text: string;
  current: boolean;
}

export function compiledSourceText(
  path: string,
  expectedCheckpoint: CompileSuccessCheckpoint | null = null,
): CompiledSource | null {
  const context = currentSyncTexContext(expectedCheckpoint);
  const snapshot = context?.[1] ?? useCompileStore.getState().compiledSources;
  const compiledPath = snapshot ? resolveCompilePath(path, Object.keys(snapshot.texts)) : null;
  const current = currentSource(path);
  if (snapshot && compiledPath) {
    const text = snapshot.texts[compiledPath];
    return { path: compiledPath, text, current: current === text };
  }
  if (context && !context[1] && current !== null) return { path, text: current, current: true };
  return null;
}

export async function typesetLinesOf(
  compiledPath: string,
  startLine: number,
  endLine: number,
  expectedCheckpoint: CompileSuccessCheckpoint | null = null,
): Promise<SynctexRect[] | null> {
  const files = useFilesStore.getState();
  const { projectId } = files;
  if (!projectId || !files.engineLoaded || !files.engine.capabilities.supports_synctex) return null;
  const checkpoint = useCompileStore.getState().lastCompileCheckpoint;
  if (!checkpoint || (expectedCheckpoint && !sameCompileOutput(checkpoint, expectedCheckpoint))) return null;
  const sameOutput = () => sameCompileOutput(useCompileStore.getState().lastCompileCheckpoint, checkpoint);
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  if (mainDoc !== checkpoint.mainDocument) return null;
  const typst = files.engine.id === "typst";
  const first = Math.min(startLine, endLine);
  const last = Math.min(Math.max(startLine, endLine), first + MAX_FORWARD_LINES - 1);
  const rects: SynctexRect[] = [];
  try {
    for (let line = first; line <= last; line += 1) {
      const hit: SynctexForwardHit | null = typst
        ? await typstForward(projectId, mainDoc, compiledPath, line, null)
        : await synctexForward(projectId, mainDoc, compiledPath, line);
      if (!sameOutput()) return null;
      if (!hit) continue;
      const lines: readonly SynctexRect[] = hit.lines?.length ? hit.lines : [hit];
      for (const rect of lines) {
        if (!rects.some((seen) => seen.page === rect.page && seen.x === rect.x && seen.y === rect.y)) {
          rects.push({ page: rect.page, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
      }
    }
  } catch (e) {
    void logError("synctex forward", e);
    return null;
  }
  return rects;
}

export function sourceText(path: string): string | null {
  return currentSource(path);
}

export function sourceTexts(): Record<string, string> {
  const snapshot = useCompileStore.getState().compiledSources?.texts ?? {};
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  const paths = [...new Set([...(mainDoc ? [mainDoc] : []), ...Object.keys(snapshot)])];
  const texts: Record<string, string> = {};
  for (const path of paths) {
    const text = currentSource(path) ?? snapshot[path];
    if (text !== undefined && text !== null) texts[path] = text;
  }
  return texts;
}
