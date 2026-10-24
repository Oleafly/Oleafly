import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectEngine: vi.fn(),
  projectMutationGeneration: vi.fn(),
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  readProjectSourcesBatch: vi.fn(),
  logError: vi.fn(),
  mcpSetActiveProject: vi.fn(async () => {}),
  releaseProject: vi.fn(async (_projectId: string) => {}),
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  projectManifestHome: vi.fn(async () => "library"),
  getProjectEngine: mocks.getProjectEngine,
  projectMutationGeneration: mocks.projectMutationGeneration,
  listFiles: mocks.listFiles,
  listFileTree: async (projectId: string) => ({
    entries: await mocks.listFiles(projectId),
    truncated: false,
  }),
  readFileContent: mocks.readFileContent,
  readProjectSourcesBatch: mocks.readProjectSourcesBatch,
  listProjects: vi.fn(async () => []),
  mcpSetActiveProject: mocks.mcpSetActiveProject,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
  toast: { info: vi.fn(), infoUnique: vi.fn(), success: vi.fn(), errorUnique: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("@/store/diff", () => ({ useDiffStore: { getState: () => ({ clearActiveDiff: vi.fn() }) } }));
vi.mock("@/store/tab-order", () => ({ nextTabSeq: () => 1 }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => ({ reset: vi.fn() }) } }));
vi.mock("@/lib/proofreading/client", () => ({
  cancelProofreading: vi.fn(),
  releaseIdleProofreadingWorker: vi.fn(),
}));
vi.mock("@/store/acp-sessions", () => ({
  useAcpSessionsStore: { getState: () => ({ releaseProject: mocks.releaseProject }) },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));

import { registerProjectLeaveGuard, type ProjectLeave } from "@/lib/project-leave-guards";
import { useFilesStore } from "./files";

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
  mocks.releaseProject.mockReset().mockResolvedValue(undefined);
  mocks.getProject.mockReset().mockResolvedValue({ name: "Paper", kind: "", main_doc: "main.tex" });
  mocks.getProjectEngine.mockReset().mockResolvedValue(LATEX_ENGINE);
  mocks.projectMutationGeneration.mockReset().mockResolvedValue(0);
  mocks.listFiles.mockReset().mockResolvedValue([{ path: "main.tex", is_dir: false }]);
  mocks.readFileContent.mockReset().mockResolvedValue("hello");
  mocks.readProjectSourcesBatch.mockReset().mockResolvedValue({
    files: [],
    unchanged: [],
    unreadable: [],
    oversized: [],
    truncated: false,
  });
});

describe("project leave guards in the files store", () => {
  it("keeps the project open when a leave guard says no", async () => {
    await useFilesStore.getState().openProject("p1");
    const stop = registerProjectLeaveGuard(async () => false);

    await useFilesStore.getState().closeProject();
    expect(useFilesStore.getState().projectId).toBe("p1");
    await useFilesStore.getState().openProject("p2");
    expect(useFilesStore.getState().projectId).toBe("p1");
    expect(useFilesStore.getState().loading).toBe(false);

    stop();
    await useFilesStore.getState().openProject("p2");
    expect(useFilesStore.getState().projectId).toBe("p2");
  });

  it("tells the guard what is happening and skips it when reopening the same project", async () => {
    await useFilesStore.getState().openProject("p1");
    const seen: ProjectLeave[] = [];
    const stop = registerProjectLeaveGuard(async (leave) => {
      seen.push(leave);
      return true;
    });

    await useFilesStore.getState().openProject("p1");
    expect(seen).toEqual([]);
    await useFilesStore.getState().openProject("p2");
    expect(seen).toEqual([{ projectId: "p1", reason: "switch", targetProjectId: "p2" }]);
    await useFilesStore.getState().closeProject();
    expect(seen.at(-1)).toEqual({ projectId: "p2", reason: "close", targetProjectId: null });
    expect(useFilesStore.getState().projectId).toBeNull();
    stop();
  });
});

describe("CLI agents of a project the window leaves", () => {
  it("disconnects the idle ones on a switch or a close, and not when the leave is refused", async () => {
    await useFilesStore.getState().openProject("p1");
    await useFilesStore.getState().openProject("p1");
    expect(mocks.releaseProject).not.toHaveBeenCalled();

    const stop = registerProjectLeaveGuard(async () => false);
    await useFilesStore.getState().openProject("p2");
    await useFilesStore.getState().closeProject();
    expect(mocks.releaseProject).not.toHaveBeenCalled();
    stop();

    await useFilesStore.getState().openProject("p2");
    await vi.waitFor(() => expect(mocks.releaseProject).toHaveBeenCalledWith("p1"));
    await useFilesStore.getState().closeProject();
    await vi.waitFor(() => expect(mocks.releaseProject).toHaveBeenLastCalledWith("p2"));
    expect(mocks.releaseProject).toHaveBeenCalledTimes(2);
  });
});
