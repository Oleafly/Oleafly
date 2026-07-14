import {
  createOpenLeafTools as createOpenLeafToolsCore,
  createFigureTools as createFigureToolsCore,
  type AiToolsHost,
  type ProjectIndexView,
  type ConfirmFn,
} from "@openleaf/ai-tools";
import {
  readFileContent,
  writeFileContent,
  createFile,
  deleteFile,
  renameFile,
  setMainDocCmd,
  listFiles,
  searchProject,
  compileIsolated,
  readIsolatedPdf,
  readProjectBytes,
  writeProjectBytes,
  getConfig,
  setConfig,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useIndexStore } from "@/store/project-index";
import { useSettingsStore } from "@/store/settings";
import { useAgentTodoStore } from "@/store/agent-todos";
import { useAgentMemoryStore } from "@/store/agent-memory";
import { usePdfViewStore } from "@/store/pdf-view";
import { extractPdfText } from "@/lib/pdf-text";
import {
  setLastFigurePreview,
  getLastFigurePreview,
  getFigureInsertTarget,
} from "@/lib/ai-figure";
import { pdfPageToPng } from "@/lib/pdf-image";
import { insertAtCursor, replaceRange } from "@/components/editor/cm/controller";

export type { ToolApprovalRequest, ConfirmFn } from "@openleaf/ai-tools";

const HOST: AiToolsHost = {
  getProjectId: () => useFilesStore.getState().projectId,
  readFileContent,
  writeFileContent,
  createFile,
  deleteFile,
  renameFile,
  setMainDoc: setMainDocCmd,
  listFiles,
  searchProject,
  // NB: the figure-pipeline services are referenced lazily (arrow wrappers)
  // so test mocks of @/lib/tauri that omit them don't fail at module init.
  readProjectBytes: (projectId, path) => readProjectBytes(projectId, path),
  writeProjectBytes: (projectId, relPath, b64) => writeProjectBytes(projectId, relPath, b64),
  applyExternalWrite: (path, content) => {
    useFilesStore.getState().applyExternalWrite(path, content);
    void import("@/lib/cross-window").then((m) =>
      m.notifyProjectFilesChanged(useFilesStore.getState().projectId, [path]),
    );
  },
  applyExternalRename: (from, to) => {
    useFilesStore.getState().applyExternalRename(from, to);
    void import("@/lib/cross-window").then((m) =>
      m.notifyProjectFilesChanged(useFilesStore.getState().projectId, [from, to]),
    );
  },
  applyExternalDelete: (path) => {
    useFilesStore.getState().applyExternalDelete(path);
    void import("@/lib/cross-window").then((m) =>
      m.notifyProjectFilesChanged(useFilesStore.getState().projectId, [path]),
    );
  },
  refreshTree: () => useFilesStore.getState().refreshTree(),
  setMainDocState: (mainDoc) => {
    useFilesStore.setState({ mainDoc });
    void import("@/lib/cross-window").then((m) =>
      m.notifyProjectFilesChanged(useFilesStore.getState().projectId),
    );
  },
  recompile: () => useCompileStore.getState().recompile(),
  getCompileLog: () => useCompileStore.getState().log,
  getPdfBytes: () => useCompileStore.getState().pdfBytes,
  extractPdfText,
  getPdfCursorPage: () => usePdfViewStore.getState().page,
  getProjectIndex: async () => {
    const idx = useIndexStore.getState();
    if (!idx.index) await idx.rebuildFromDisk();
    return (useIndexStore.getState().index ?? null) as unknown as ProjectIndexView | null;
  },
  compileIsolated: (projectId, source) =>
    compileIsolated(projectId, source, useSettingsStore.getState().offline),
  readIsolatedPdf: (projectId) => readIsolatedPdf(projectId),
  pdfToPng: pdfPageToPng,
  setLastFigurePreview,
  getLastFigurePreview,
  getFigureInsertTarget,
  insertAtCursor,
  replaceRange,
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
      const v = localStorage.getItem("openleaf:ai_pdf_capture");
      if (v === "0") return false;
      if (v === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  },
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
  void getConfig()
    .then((c) => {
      const on = c.ai_pdf_capture !== false;
      try {
        localStorage.setItem("openleaf:ai_pdf_capture", on ? "1" : "0");
      } catch {
        /* ignore */
      }
    })
    .catch(() => {});
}

// E2E devtools hook: lets CI connect an AI provider by writing config directly,
// standing in for a user connecting one in Settings, so provider-backed flows
// (streaming, tool calls, chat handoff) can run against the local fake
// OpenAI-compatible endpoint (e2e/mock-ai-server.ts). Only DEFINES the function
// here; the IPC runs on invocation, so this is a safe module side effect.
if (typeof window !== "undefined") {
  (
    window as unknown as {
      __aiConnect?: (provider: string, host: string, model: string) => Promise<boolean>;
    }
  ).__aiConnect = async (provider, host, model) => {
    const cfg = await getConfig();
    await setConfig({
      ...cfg,
      ai_provider: provider,
      ai_keys: { ...cfg.ai_keys, [provider]: host },
      ai_model: model,
    });
    window.dispatchEvent(new CustomEvent("openleaf:ai-config-changed"));
    return true;
  };
}

export function createOpenLeafTools(opts?: {
  confirm?: ConfirmFn;
  onImage?: (dataUrl: string) => void;
}) {
  return createOpenLeafToolsCore(HOST, opts);
}

export function createFigureTools(opts?: {
  confirm?: ConfirmFn;
  onImage?: (dataUrl: string) => void;
}) {
  return createFigureToolsCore(HOST, opts);
}
