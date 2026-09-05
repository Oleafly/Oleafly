import { getConfigCached } from "@/lib/config-cache";
import { activeCuaSurface } from "@/lib/cua-sandbox";
import {
  agentExec,
  agentExecAuthorize,
  agentExecCwd,
  agentExecRegisterExternal,
} from "@/lib/tauri";
import {
  createOleaflyTools as createOleaflyToolsCore,
  createFigureTools as createFigureToolsCore,
  type AiToolsHost,
  type ProjectIndexView,
  type ConfirmFn,
} from "@oleafly/ai-tools";
import {
  readFileContent,
  writeFileContent,
  createFile,
  deleteFile,
  renameFile as renameFileCmd,
  listFiles,
  searchProject,
  compileIsolated,
  readIsolatedPdf,
  readProjectBytes,
  writeProjectBytes,
  projectMutationGeneration,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useIndexStore } from "@/store/project-index";
import { useSettingsStore } from "@/store/settings";
import { useAgentTodoStore } from "@/store/agent-todos";
import { useAgentMemoryStore } from "@/store/agent-memory";
import { usePdfViewStore } from "@/store/pdf-view";
import {
  setLastFigurePreview,
  getLastFigurePreview,
  getFigureInsertTarget,
} from "@/lib/ai-figure";
import {
  getEditorView,
  insertAtCursor,
  replaceRange as replaceRangeInEditor,
} from "@/components/editor/cm/controller";

export type { ToolApprovalRequest, ConfirmFn } from "@oleafly/ai-tools";

function recordMutationResult(projectId: string, result: unknown): void {
  const generation =
    result && typeof result === "object" && "generation" in result
      ? (result as { generation?: unknown }).generation
      : undefined;
  if (typeof generation === "number" && Number.isSafeInteger(generation)) {
    useFilesStore.getState().recordMutationGeneration(projectId, generation);
  }
}

function mutationAllowed(
  projectId: string,
  allowed: () => boolean,
): boolean {
  return useFilesStore.getState().projectId === projectId && allowed();
}

async function currentDiskContent(projectId: string, path: string): Promise<string> {
  const cached = useFilesStore.getState().files[path]?.content;
  return cached ?? readFileContent(projectId, path);
}

const insertAtCursorHost: AiToolsHost["insertAtCursor"] = async (
  projectId,
  text,
  allowed = () => true,
) => {
  if (!mutationAllowed(projectId, allowed)) return false;
  if (getEditorView()) {
    insertAtCursor(text);
    return true;
  }
  const files = useFilesStore.getState();
  const path = files.activePath || files.mainDoc || "main.tex";
  const expectedGeneration = await files.prepareExternalMutation(projectId);
  const current = await currentDiskContent(projectId, path);
  if (!mutationAllowed(projectId, allowed)) return false;
  const documentEnd = current.lastIndexOf("\\end{document}");
  const at = documentEnd >= 0 ? documentEnd : current.length;
  const next = `${current.slice(0, at)}${text}\n${current.slice(at)}`;
  const result = await writeFileContent(projectId, path, next, expectedGeneration);
  recordMutationResult(projectId, result);
  return useFilesStore.getState().applyExternalWrite(projectId, path, next);
};

const replaceRangeHost: AiToolsHost["replaceRange"] = async (
  projectId,
  from,
  to,
  text,
  allowed = () => true,
) => {
  if (!mutationAllowed(projectId, allowed)) return false;
  if (getEditorView()) {
    replaceRangeInEditor(from, to, text);
    return true;
  }
  const files = useFilesStore.getState();
  const path = files.activePath || files.mainDoc || "main.tex";
  const expectedGeneration = await files.prepareExternalMutation(projectId);
  const current = await currentDiskContent(projectId, path);
  if (!mutationAllowed(projectId, allowed)) return false;
  const start = Math.max(0, Math.min(from, current.length));
  const end = Math.max(start, Math.min(to, current.length));
  const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
  const result = await writeFileContent(projectId, path, next, expectedGeneration);
  recordMutationResult(projectId, result);
  return useFilesStore.getState().applyExternalWrite(projectId, path, next);
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function syncTexAvailable(): boolean {
  const files = useFilesStore.getState();
  if (!files.engineLoaded || files.engine?.capabilities?.supports_synctex !== true) return false;
  return useCompileStore.getState().pdfBytes !== null;
}

export const EDITOR_DOCUMENT_WAIT_MS = 4000;

function inEditor(node: Element | null | undefined): boolean {
  return !!node?.closest?.(".cm-editor");
}

export async function revealEditorLine(path: string, line: number): Promise<boolean> {
  const files = useFilesStore.getState();
  if (files.activePath !== path) {
    await files.openFile(path);
    if (useFilesStore.getState().activePath !== path) return false;
  }
  const { gotoLine, getEditorView, waitForEditorDocument } = await import(
    "@/components/editor/cm/controller"
  );
  const controller = new AbortController();
  const giveUp = setTimeout(() => controller.abort(), EDITOR_DOCUMENT_WAIT_MS);
  let ready: unknown = null;
  try {
    ready = await waitForEditorDocument(path, controller.signal);
  } finally {
    clearTimeout(giveUp);
  }
  if (!ready) return false;
  const restore =
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
  gotoLine(line);
  if (typeof document === "undefined") return true;
  if (restore && !inEditor(restore) && typeof restore.focus === "function") {
    restore.focus({ preventScroll: true });
  }
  if (!inEditor(restore) && inEditor(document.activeElement)) {
    getEditorView()?.contentDOM.blur();
  }
  return true;
}

async function showPreviewSurfaces(needsEditor: boolean, needsPdf: boolean): Promise<boolean> {
  const settings = useSettingsStore.getState();
  const mode = settings.viewMode;
  let next: typeof mode | null = null;
  if (needsEditor && needsPdf && mode !== "split") next = "split";
  else if (needsEditor && !needsPdf && mode === "pdf") next = "editor";
  else if (needsPdf && !needsEditor && mode === "editor") next = "split";
  if (!next) return false;
  settings.setViewMode(next);
  await delay(60);
  return true;
}

async function showPdfPage(page: number, waitMs: number): Promise<boolean> {
  const { gotoPdfPage } = await import("@/components/pdf/pdfController");
  return gotoPdfPage(page, waitMs);
}

async function forwardSyncTexToRevealedLine(): Promise<void> {
  const { forwardFromCursor } = await import("@/features/synctex");
  await forwardFromCursor();
}

const revealLocationHost = async (target: {
  path?: string;
  line?: number;
  page?: number;
}): Promise<{ revealed: boolean; note?: string }> => {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return { revealed: false, note: "No project is open." };

  const notes: string[] = [];
  const wantsPage = typeof target.page === "number";
  const wantsSyncTex = !wantsPage && !!target.path && typeof target.line === "number";
  const syncTexReady = wantsSyncTex && syncTexAvailable();
  if (wantsSyncTex && !syncTexReady && useFilesStore.getState().engine?.capabilities?.supports_synctex === true) {
    notes.push("Compile the project to move the PDF preview to the same spot.");
  }

  const switched = await showPreviewSurfaces(!!target.path, wantsPage || syncTexReady);

  let editorRevealed = false;
  if (target.path) {
    editorRevealed = await revealEditorLine(target.path, target.line ?? 1);
    if (!editorRevealed) notes.push(`Could not open ${target.path} in the editor.`);
  }

  let pdfRevealed = false;
  if (wantsPage) {
    pdfRevealed = await showPdfPage(target.page as number, switched ? 1500 : 0);
    if (!pdfRevealed) notes.push("The PDF preview is not showing a document, so its page did not change.");
  } else if (editorRevealed && syncTexReady) {
    try {
      await forwardSyncTexToRevealedLine();
    } catch {
      notes.push("The PDF preview stayed where it was.");
    }
  }

  return {
    revealed: editorRevealed || pdfRevealed,
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
};

const HOST: AiToolsHost = {
  getProjectId: () => useFilesStore.getState().projectId,
  readFileContent,
  writeFileContent: async (projectId, path, content, expectedGeneration) => {
    const result = await writeFileContent(projectId, path, content, expectedGeneration);
    recordMutationResult(projectId, result);
    return result;
  },
  createFile: async (projectId, path, isDir, expectedGeneration) => {
    // The agent gets the strict contract: a collision is a structured error
    // it must resolve by choosing a different name, never a silent overwrite.
    const result = await createFile(projectId, path, isDir, "error", expectedGeneration);
    recordMutationResult(projectId, result);
    return result;
  },
  deleteFile: async (projectId, path, expectedGeneration) => {
    const result = await deleteFile(projectId, path, expectedGeneration);
    recordMutationResult(projectId, result);
    return result;
  },
  renameFile: async (projectId, from, to, expectedGeneration) => {
    const path = await renameFileCmd(projectId, from, to, "error", expectedGeneration);
    const generation = await projectMutationGeneration(projectId).catch(() => null);
    if (generation !== null) {
      useFilesStore.getState().recordMutationGeneration(projectId, generation);
    }
    return { path, ...(generation === null ? {} : { generation }) };
  },
  setMainDoc: async (projectId, path) => {
    const files = useFilesStore.getState();
    if (files.projectId !== projectId) throw new Error("Project changed before setting main document");
    await files.setMainDoc(path);
    return { main_doc: useFilesStore.getState().mainDoc };
  },
  listFiles,
  searchProject,
  readProjectBytes: (projectId, path) => readProjectBytes(projectId, path),
  writeProjectBytes: async (projectId, relPath, b64, expectedGeneration) => {
    const result = await writeProjectBytes(projectId, relPath, b64, expectedGeneration);
    recordMutationResult(projectId, result);
    return result;
  },
  prepareExternalMutation: (projectId) =>
    useFilesStore.getState().prepareExternalMutation(projectId),
  applyExternalWrite: (projectId, path, content) => {
    const files = useFilesStore.getState();
    if (files.projectId !== projectId) return false;
    const applied = files.applyExternalWrite(projectId, path, content);
    const finalContent = applied
      ? content
      : useFilesStore.getState().files[path]?.content ?? content;
    void import("@/lib/cross-window").then((m) =>
      m.notifyProjectFilesChanged(projectId, [path], {
        kind: "write",
        path,
        content: finalContent,
      }),
    );
    return applied;
  },
  applyExternalRename: (projectId, from, to) => {
    const files = useFilesStore.getState();
    if (files.projectId !== projectId) return false;
    const applied = files.applyExternalRename(projectId, from, to);
    if (!applied) return false;
    void import("@/lib/cross-window").then((m) =>
      m.notifyProjectFilesChanged(projectId, [from, to], { kind: "rename", from, to }),
    );
    return true;
  },
  applyExternalDelete: (projectId, path) => {
    const files = useFilesStore.getState();
    if (files.projectId !== projectId) return false;
    const applied = files.applyExternalDelete(projectId, path);
    void import("@/lib/cross-window").then((m) =>
      m.notifyProjectFilesChanged(projectId, [path], { kind: "delete", path }),
    );
    return applied;
  },
  refreshTree: async (projectId) => {
    const files = useFilesStore.getState();
    if (files.projectId !== projectId) return;
    await files.refreshTree();
  },
  recompile: () => useCompileStore.getState().recompile(),
  getCompileLog: () => useCompileStore.getState().log,
  getPdfBytes: () => useCompileStore.getState().pdfBytes,
  extractPdfText: async (bytes) => {
    const { extractPdfText } = await import("@/lib/pdf-text");
    return extractPdfText(bytes);
  },
  getPdfCursorPage: () => usePdfViewStore.getState().page,
  getProjectIndex: async () => {
    const idx = useIndexStore.getState();
    if (!idx.index) await idx.rebuildFromDisk();
    return (useIndexStore.getState().index ?? null) as unknown as ProjectIndexView | null;
  },
  compileIsolated: (projectId, source) =>
    compileIsolated(projectId, source, useSettingsStore.getState().offline),
  readIsolatedPdf: (projectId) => readIsolatedPdf(projectId),
  pdfToPng: async (...args) => {
    const { pdfPageToPng } = await import("@/lib/pdf-image");
    return pdfPageToPng(...args);
  },
  setLastFigurePreview,
  getLastFigurePreview,
  getFigureInsertTarget,
  insertAtCursor: insertAtCursorHost,
  replaceRange: replaceRangeHost,
  getAgentTodos: () => useAgentTodoStore.getState().todos,
  setAgentTodos: (todos) =>
    useAgentTodoStore.getState().setTodos(
      todos.map((t) => ({
        id: t.id,
        content: t.content,
        status: (["pending", "in_progress", "completed", "cancelled"].includes(t.status)
          ? t.status
          : "pending") as "pending" | "in_progress" | "completed" | "cancelled",
      })),
    ),
  getAiPdfCaptureEnabled: () => {
    // Sync cache set by ChatPanel/settings; fall back to true-if-unknown only after config load.
    try {
      const v = localStorage.getItem("oleafly:ai_pdf_capture");
      if (v === "0") return false;
      if (v === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  },
  revealLocation: revealLocationHost,
  rememberNote: (content) => {
    const note = useAgentMemoryStore.getState().add(content);
    return note ? { id: note.id, content: note.content } : { error: "No project open or empty note" };
  },
  forgetNote: (id) => {
    useAgentMemoryStore.getState().remove(id);
    return { success: true };
  },
  listNotes: () =>
    useAgentMemoryStore.getState().notes.map((n) => ({ id: n.id, content: n.content })),
};

// Call once at app startup, NOT at module load: doing IPC at import time
// fires before the app is ready and, when `getConfig` is absent in a
// unit-test mock, throws synchronously at import and breaks the whole test
// file.
export function initAiPdfCaptureFlag(): void {
  void getConfigCached()
    .then((c) => {
      const on = c.ai_pdf_capture !== false;
      try {
        localStorage.setItem("oleafly:ai_pdf_capture", on ? "1" : "0");
      } catch {
        /* ignore */
      }
    })
    .catch(() => {});
}

export function createOleaflyTools(opts?: {
  confirm?: ConfirmFn;
  onImage?: (dataUrl: string) => void;
  mutationAllowed?: () => boolean;
  runId?: () => string | null;
  alwaysConfirmComputerUse?: boolean;
}) {
  return createOleaflyToolsCore(HOST, {
    ...opts,
    // The computer_use tool is only exposed when the experimental web browser
    // is enabled; otherwise the AI has no browser tool at all.
    cuaSurface: useSettingsStore.getState().webBrowser ? activeCuaSurface : undefined,
    resolveExecCwd: agentExecCwd,
    authorizeExec: async (projectId, command, runIdOverride) => {
      // A subagent supplies its own external: owner so its commands can be
      // cancelled independently; otherwise use the run's native id, and mint a
      // renderer owner only as a last resort.
      const nativeRunId = runIdOverride ?? opts?.runId?.();
      const runId = nativeRunId ?? `external:${crypto.randomUUID()}`;
      if (!runId) throw new Error("The agent run ended before command approval.");
      // Any external: owner (a subagent's or a renderer-minted one) must
      // register with the trusted native registry before it can authorize;
      // native run ids are already tracked.
      if (runId.startsWith("external:")) await agentExecRegisterExternal(runId);
      const approvalToken = await agentExecAuthorize(projectId, command, runId);
      return { approvalToken, runId };
    },
    execCommand: (projectId, command, authorization) =>
      agentExec(projectId, command, authorization.runId, authorization.approvalToken),
  });
}

export function createFigureTools(opts?: {
  confirm?: ConfirmFn;
  onImage?: (dataUrl: string) => void;
  mutationAllowed?: () => boolean;
}) {
  return createFigureToolsCore(HOST, opts);
}
