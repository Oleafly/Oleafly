import {
  synctexForward,
  synctexInverse,
  synctexMapLine,
} from "@/lib/tauri";
import { getCurrentLine, gotoLine, selectWordNearLine } from "@/components/editor/cm/controller";
import { gotoRect } from "@/components/pdf/pdfController";
import { useFilesStore } from "@/store/files";
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
import { logError } from "@/lib/log";

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

function basename(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() ?? path;
}

function resolvePath(path: string, candidates: string[]): string | null {
  if (candidates.includes(path)) return path;
  const wanted = basename(path);
  const matches = candidates.filter(
    (candidate) => basename(candidate) === wanted,
  );
  return matches.length === 1 ? matches[0] : null;
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
  const compiledPath = resolvePath(path, Object.keys(snapshot.texts));
  const currentPath = compiledPath
    ? resolvePath(compiledPath, currentProjectSourcePaths())
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

export function goToSyncTex() {
  const s = useSettingsStore.getState();
  if (s.viewMode === "editor") {
    s.setViewMode("split");
    requestAnimationFrame(() => void forwardFromCursor());
  } else {
    void forwardFromCursor();
  }
}

export async function forwardFromCursor() {
  const files = useFilesStore.getState();
  const { projectId, activePath } = files;
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  if (!files.engineLoaded || !files.engine.capabilities.supports_synctex) return;
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
    const rect = await synctexForward(
      projectId,
      mainDoc,
      compiledPath,
      compiledLine,
    );
    if (
      !contextStillValid(context) ||
      (stale && currentSource(stale[1]) !== stale[3])
    ) {
      return;
    }
    if (!rect) {
      void logError(
        "synctex forward",
        `no SyncTeX rect for ${compiledPath}:${compiledLine}`,
      );
      return;
    }
    gotoRect(rect);
  } catch (e) {
    void logError("synctex forward", e);
  }
}

// So a just-opened file has time to mount before we move the cursor into it.
function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (k: number) =>
      k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1));
    step(n);
  });
}

export async function openFileAndGotoLine(file: string | null, line: number) {
  const store = useFilesStore.getState();
  const target = file
    ? resolvePath(file, currentProjectSourcePaths())
    : null;
  if (target && target !== store.activePath) {
    await store.openFile(target);
    await nextFrames(2);
  }
  gotoLine(line);
}

// In a multi-file project the click may land on content from a different file
// (an `\input` child), so switch to that file before jumping. `hit.file` is a
// basename; resolve it against the project tree.
export async function inverseFromClick(
  page: number,
  x: number,
  y: number,
  word?: string,
  expectedCheckpoint: CompileSuccessCheckpoint | null = null,
) {
  const store = useFilesStore.getState();
  const { projectId } = store;
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  if (!projectId) return;
  if (!store.engineLoaded || !store.engine.capabilities.supports_synctex) return;
  const context = currentSyncTexContext(expectedCheckpoint);
  if (!context) return;
  const currentLine = getCurrentLine();
  if (word && currentLine != null) selectWordNearLine(currentLine, word);
  try {
    const hit = await synctexInverse(projectId, mainDoc, page, x, y);
    if (!contextStillValid(context)) return;
    if (!hit) return;

    let targetPath: string | null = null;
    let targetLine = hit.line;
    if (!context[1]) {
      targetPath = hit.file
        ? resolvePath(hit.file, currentProjectSourcePaths())
        : useFilesStore.getState().activePath;
    } else {
      const mapped = await mapStaleLine(
        context,
        hit.file,
        hit.line,
        false,
      );
      if (!mapped) return;
      targetPath = mapped[1];
      targetLine = mapped[2];
    }

    const activePath = useFilesStore.getState().activePath;
    if (targetPath && targetPath !== activePath) {
      await store.openFile(targetPath);
      await nextFrames(2); // let the editor mount the new file
      if (!contextStillValid(context)) return;
    }
    // SyncTeX only resolves to a line (its column is coarse and often lands on a
    // `\begin`/`\end`). If we know the word that was clicked, place the cursor on
    // the nearest matching word; otherwise fall back to the line start.
    if (word && selectWordNearLine(targetLine, word)) return;
    gotoLine(targetLine);
  } catch (e) {
    void logError("synctex inverse", e);
  }
}
