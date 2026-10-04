import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiToolsHost } from "@oleafly/ai-tools";

const mocks = vi.hoisted(() => ({
  host: null as unknown,
  coreOptions: null as unknown,
  api: {
    agentExec: vi.fn(),
    agentExecAuthorize: vi.fn(),
    agentExecCwd: vi.fn(),
    agentExecRegisterExternal: vi.fn(),
    readFileContent: vi.fn(),
    writeFileContent: vi.fn(),
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    listFiles: vi.fn(),
    searchProject: vi.fn(),
    compileIsolated: vi.fn(),
    readIsolatedPdf: vi.fn(),
    readProjectBytes: vi.fn(),
    writeProjectBytes: vi.fn(),
    projectMutationGeneration: vi.fn(),
    renderTypstSnippet: vi.fn(),
    getConfig: vi.fn(),
  },
  files: {
    projectId: "proj" as string | null,
    activePath: null as string | null,
    mainDoc: "",
    mainDecision: "auto",
    engine: { main_document: "main.typ" } as { main_document?: string } | null,
    engineLoaded: true,
    files: {} as Record<string, { content: string }>,
    prepareExternalMutation: vi.fn(async () => 3),
    applyExternalWrite: vi.fn(() => true),
    applyExternalRename: vi.fn(() => true),
    applyExternalDelete: vi.fn(() => true),
    recordMutationGeneration: vi.fn(),
    refreshTree: vi.fn(async () => {}),
    setMainDoc: vi.fn(async () => {}),
  },
  compile: { log: "compile log", pdfBytes: null as Uint8Array | null, recompile: vi.fn() },
  index: { index: null as unknown, rebuildFromDisk: vi.fn(async () => {}) },
  editorView: null as object | null,
  insertAtCursor: vi.fn(),
  replaceRange: vi.fn(),
  notifyProjectFilesChanged: vi.fn(),
  extractPdfText: vi.fn(async () => ({ pages: ["p1"], numPages: 1 })),
  pdfPageToPng: vi.fn(async () => "data:image/png;base64,AA"),
}));

vi.mock("@oleafly/ai-tools", () => ({
  createOleaflyTools: (host: unknown, options: unknown) => {
    mocks.host = host;
    mocks.coreOptions = options;
    return {};
  },
  createFigureTools: (host: unknown) => {
    mocks.host = host;
    return {};
  },
}));
vi.mock("@/lib/tauri", () => mocks.api);
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => mocks.compile } }));
vi.mock("@/store/project-index", () => ({ useIndexStore: { getState: () => mocks.index } }));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: () => mocks.editorView,
  insertAtCursor: mocks.insertAtCursor,
  replaceRange: mocks.replaceRange,
}));
vi.mock("@/lib/cross-window", () => ({ notifyProjectFilesChanged: mocks.notifyProjectFilesChanged }));
vi.mock("@/lib/pdf-text", () => ({ extractPdfText: mocks.extractPdfText }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: mocks.pdfPageToPng }));

import { createFigureTools, createOleaflyTools, initAiPdfCaptureFlag } from "./ai-tools";
import { invalidateConfigCache } from "./config-cache";
import { useAgentMemoryStore } from "@/store/agent-memory";
import { useAgentTodoStore } from "@/store/agent-todos";
import { useFolderAccessStore } from "@/store/folder-access";
import { usePdfViewStore } from "@/store/pdf-view";
import { useSettingsStore } from "@/store/settings";

type CoreOptions = {
  cuaSurface?: unknown;
  resolveExecCwd: (projectId: string) => Promise<string>;
  authorizeExec: (projectId: string, command: string, runId?: string) => Promise<{ approvalToken: string; runId: string }>;
  execCommand: (projectId: string, command: string, authorization: { approvalToken: string; runId: string }) => Promise<unknown>;
};

function host(): AiToolsHost {
  createOleaflyTools();
  return mocks.host as AiToolsHost;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.files.projectId = "proj";
  mocks.files.activePath = null;
  mocks.files.mainDoc = "";
  mocks.files.engine = { main_document: "main.typ" };
  mocks.files.files = {};
  mocks.files.prepareExternalMutation.mockReset().mockResolvedValue(3);
  mocks.files.applyExternalWrite.mockReset().mockReturnValue(true);
  mocks.files.applyExternalRename.mockReset().mockReturnValue(true);
  mocks.files.applyExternalDelete.mockReset().mockReturnValue(true);
  mocks.files.recordMutationGeneration.mockReset();
  mocks.files.refreshTree.mockReset().mockResolvedValue(undefined);
  mocks.editorView = null;
  mocks.insertAtCursor.mockReset();
  mocks.replaceRange.mockReset();
  mocks.notifyProjectFilesChanged.mockReset();
  mocks.index.index = null;
  mocks.index.rebuildFromDisk.mockReset();
  useFolderAccessStore.setState({ projectId: null, status: null });
  localStorage.clear();
  invalidateConfigCache();
});

afterEach(() => {
  useSettingsStore.getState().setWebBrowser(false);
});

describe("editing the open document without a mounted editor", () => {
  it("inserts at the cursor through the editor when it is mounted", async () => {
    mocks.editorView = {};
    await expect(host().insertAtCursor("proj", "\\cite{x}")).resolves.toBe(true);
    expect(mocks.insertAtCursor).toHaveBeenCalledWith("\\cite{x}");
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
  });

  it("replaces a range in the mounted editor", async () => {
    mocks.editorView = {};
    await expect(host().replaceRange?.("proj", 1, 3, "new")).resolves.toBe(true);
    expect(mocks.replaceRange).toHaveBeenCalledWith(1, 3, "new");
  });

  it("writes a clamped replacement to disk and records the new generation", async () => {
    mocks.files.activePath = "chapter.tex";
    mocks.files.files = { "chapter.tex": { content: "abcdef" } };
    mocks.api.writeFileContent.mockResolvedValue({ generation: 9 });
    await expect(host().replaceRange?.("proj", 2, 99, "Z")).resolves.toBe(true);
    expect(mocks.api.writeFileContent).toHaveBeenCalledWith("proj", "chapter.tex", "abZ", 3);
    expect(mocks.files.recordMutationGeneration).toHaveBeenCalledWith("proj", 9);
    expect(mocks.files.applyExternalWrite).toHaveBeenCalledWith("proj", "chapter.tex", "abZ", { opener: "assistant" });

    await host().replaceRange?.("proj", -5, 1, "Y");
    expect(mocks.api.writeFileContent).toHaveBeenLastCalledWith("proj", "chapter.tex", "Ybcdef", 3);
  });

  it("reads the target from disk and falls back to the engine's main document", async () => {
    mocks.files.mainDoc = "";
    mocks.api.readFileContent.mockResolvedValue("= Title");
    mocks.api.writeFileContent.mockResolvedValue({});
    await host().replaceRange?.("proj", 0, 1, "#");
    expect(mocks.api.readFileContent).toHaveBeenCalledWith("proj", "main.typ");
    expect(mocks.files.recordMutationGeneration).not.toHaveBeenCalled();

    mocks.files.engine = null;
    await host().replaceRange?.("proj", 0, 0, "%");
    expect(mocks.api.readFileContent).toHaveBeenLastCalledWith("proj", "main.tex");
  });

  it("refuses edits for another project or once the run stops allowing them", async () => {
    await expect(host().replaceRange?.("other", 0, 0, "x")).resolves.toBe(false);
    await expect(host().replaceRange?.("proj", 0, 0, "x", () => false)).resolves.toBe(false);
    let calls = 0;
    mocks.api.readFileContent.mockResolvedValue("text");
    await expect(host().replaceRange?.("proj", 0, 0, "x", () => ++calls < 2)).resolves.toBe(false);
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
  });

  it("refuses edits to a read-only folder", async () => {
    useFolderAccessStore.setState({ projectId: "proj", status: { read_only: true, synced_with: null } });
    await expect(host().replaceRange?.("proj", 0, 0, "x")).rejects.toThrow();
    await expect(host().insertAtCursor("proj", "x")).rejects.toThrow();
  });
});

describe("file operations", () => {
  it("renames through the backend and records the fresh generation when available", async () => {
    mocks.api.renameFile.mockResolvedValue("b.tex");
    mocks.api.projectMutationGeneration.mockResolvedValue(12);
    await expect(host().renameFile("proj", "a.tex", "b.tex", 4)).resolves.toEqual({ path: "b.tex", generation: 12 });
    expect(mocks.api.renameFile).toHaveBeenCalledWith("proj", "a.tex", "b.tex", "error", 4);
    expect(mocks.files.recordMutationGeneration).toHaveBeenCalledWith("proj", 12);

    mocks.api.projectMutationGeneration.mockRejectedValue(new Error("busy"));
    await expect(host().renameFile("proj", "b.tex", "c.tex", 5)).resolves.toEqual({ path: "b.tex" });
  });

  it("writes project bytes and records the generation", async () => {
    mocks.api.writeProjectBytes.mockResolvedValue({ generation: 2 });
    await expect(host().writeProjectBytes("proj", "fig.png", "AA", 1)).resolves.toEqual({ generation: 2 });
    expect(mocks.api.writeProjectBytes).toHaveBeenCalledWith("proj", "fig.png", "AA", 1);
    expect(mocks.files.recordMutationGeneration).toHaveBeenCalledWith("proj", 2);
  });

  it("sets the main document only for the open project", async () => {
    mocks.files.mainDoc = "thesis.tex";
    await expect(host().setMainDoc("proj", "thesis.tex")).resolves.toEqual({ main_doc: "thesis.tex" });
    expect(mocks.files.setMainDoc).toHaveBeenCalledWith("thesis.tex");
    await expect(host().setMainDoc("other", "x.tex")).rejects.toThrow("Project changed before setting main document");
  });

  it("applies renames and deletes for the open project and tells other windows", async () => {
    expect(host().applyExternalRename("proj", "a.tex", "b.tex")).toBe(true);
    await vi.waitFor(() =>
      expect(mocks.notifyProjectFilesChanged).toHaveBeenCalledWith("proj", ["a.tex", "b.tex"], { kind: "rename", from: "a.tex", to: "b.tex" }),
    );
    expect(host().applyExternalDelete("proj", "c.tex")).toBe(true);
    await vi.waitFor(() =>
      expect(mocks.notifyProjectFilesChanged).toHaveBeenCalledWith("proj", ["c.tex"], { kind: "delete", path: "c.tex" }),
    );

    mocks.files.applyExternalRename.mockReturnValue(false);
    expect(host().applyExternalRename("proj", "x", "y")).toBe(false);
    expect(host().applyExternalRename("other", "x", "y")).toBe(false);
    expect(host().applyExternalDelete("other", "x")).toBe(false);
    await flush();
    expect(mocks.notifyProjectFilesChanged).toHaveBeenCalledTimes(2);
  });

  it("refreshes the tree only for the open project", async () => {
    await host().refreshTree("other");
    expect(mocks.files.refreshTree).not.toHaveBeenCalled();
    await host().refreshTree("proj");
    expect(mocks.files.refreshTree).toHaveBeenCalledOnce();
  });
});

describe("compile and PDF access", () => {
  it("exposes the compile log, PDF bytes, text, cursor page and isolated compiles", async () => {
    const bytes = new Uint8Array([1]);
    mocks.compile.pdfBytes = bytes;
    usePdfViewStore.getState().setPage(4);
    useSettingsStore.setState({ offline: true });
    const h = host();
    expect(h.getCompileLog()).toBe("compile log");
    expect(h.getPdfBytes()).toBe(bytes);
    await expect(h.extractPdfText(bytes)).resolves.toEqual({ pages: ["p1"], numPages: 1 });
    expect(h.getPdfCursorPage?.()).toBe(4);
    await h.compileIsolated("proj", "\\documentclass{standalone}");
    expect(mocks.api.compileIsolated).toHaveBeenCalledWith("proj", "\\documentclass{standalone}", true);
    await h.readIsolatedPdf("proj");
    expect(mocks.api.readIsolatedPdf).toHaveBeenCalledWith("proj");
    const pdfToPng = h.pdfToPng;
    if (!pdfToPng) throw new Error("the host exposes no PDF rasterizer");
    await expect(pdfToPng(bytes, 1, 2)).resolves.toBe("data:image/png;base64,AA");
    expect(mocks.pdfPageToPng).toHaveBeenCalledWith(bytes, 1, 2);
  });

  it("builds the project index on demand", async () => {
    const index = { defs: [] };
    mocks.index.rebuildFromDisk.mockImplementation(async () => {
      mocks.index.index = index;
    });
    await expect(host().getProjectIndex()).resolves.toBe(index);
    await expect(host().getProjectIndex()).resolves.toBe(index);
    expect(mocks.index.rebuildFromDisk).toHaveBeenCalledOnce();
  });
});

describe("agent state", () => {
  it("stores todos, coercing unknown statuses to pending", () => {
    const h = host();
    useAgentTodoStore.getState().beginTurn("chat-1");
    h.setAgentTodos([
      { id: "1", content: "Outline", status: "completed" },
      { id: "2", content: "Draft", status: "blocked" },
    ]);
    expect(h.getAgentTodos()).toEqual([
      { id: "1", content: "Outline", status: "completed" },
      { id: "2", content: "Draft", status: "pending" },
    ]);
    expect(useAgentTodoStore.getState().todos).toHaveLength(2);
  });

  it("remembers, lists and forgets project notes", () => {
    const h = host();
    useAgentMemoryStore.setState({ projectId: null, notes: [] });
    expect(h.rememberNote("Use APA")).toEqual({ error: "No project open or empty note" });
    useAgentMemoryStore.getState().load("proj");
    const note = h.rememberNote("Use APA") as { id: string; content: string };
    expect(note.content).toBe("Use APA");
    expect(h.listNotes()).toEqual([{ id: note.id, content: "Use APA" }]);
    expect(h.forgetNote(note.id)).toEqual({ success: true });
    expect(h.listNotes()).toEqual([]);
  });

  it("reads the PDF capture preference, defaulting to on", () => {
    const h = host();
    expect(h.getAiPdfCaptureEnabled()).toBe(true);
    localStorage.setItem("oleafly:ai_pdf_capture", "0");
    expect(h.getAiPdfCaptureEnabled()).toBe(false);
    localStorage.setItem("oleafly:ai_pdf_capture", "1");
    expect(h.getAiPdfCaptureEnabled()).toBe(true);
  });

  it("primes the PDF capture preference from the app config", async () => {
    mocks.api.getConfig.mockResolvedValueOnce({ ai_pdf_capture: false });
    initAiPdfCaptureFlag();
    await vi.waitFor(() => expect(localStorage.getItem("oleafly:ai_pdf_capture")).toBe("0"));
    invalidateConfigCache();
    mocks.api.getConfig.mockResolvedValueOnce({});
    initAiPdfCaptureFlag();
    await vi.waitFor(() => expect(localStorage.getItem("oleafly:ai_pdf_capture")).toBe("1"));
    invalidateConfigCache();
    mocks.api.getConfig.mockRejectedValueOnce(new Error("no config"));
    initAiPdfCaptureFlag();
    await flush();
    expect(localStorage.getItem("oleafly:ai_pdf_capture")).toBe("1");
  });
});

describe("tool factories", () => {
  it("passes the browser surface only when the web browser is enabled", () => {
    useSettingsStore.getState().setWebBrowser(false);
    createOleaflyTools();
    expect((mocks.coreOptions as CoreOptions).cuaSurface).toBeUndefined();
    useSettingsStore.getState().setWebBrowser(true);
    createOleaflyTools();
    expect((mocks.coreOptions as CoreOptions).cuaSurface).toBeTypeOf("function");
  });

  it("authorizes commands under the run's own id without registering it", async () => {
    mocks.api.agentExecAuthorize.mockResolvedValue("token");
    createOleaflyTools({ runId: () => "run-1" });
    const options = mocks.coreOptions as CoreOptions;
    await expect(options.authorizeExec("proj", "ls", undefined)).resolves.toEqual({ approvalToken: "token", runId: "run-1" });
    expect(mocks.api.agentExecRegisterExternal).not.toHaveBeenCalled();
    await options.execCommand("proj", "ls", { approvalToken: "token", runId: "run-1" });
    expect(mocks.api.agentExec).toHaveBeenCalledWith("proj", "ls", "run-1", "token");
    await options.resolveExecCwd("proj");
    expect(mocks.api.agentExecCwd).toHaveBeenCalledWith("proj");
  });

  it("builds figure tools from the same host", () => {
    createFigureTools();
    expect((mocks.host as AiToolsHost).getProjectId()).toBe("proj");
  });
});
