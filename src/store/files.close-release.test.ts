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
  cancelProofreading: vi.fn(),
  releaseIdleProofreadingWorker: vi.fn(),
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
  cancelProofreading: mocks.cancelProofreading,
  releaseIdleProofreadingWorker: mocks.releaseIdleProofreadingWorker,
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));

import { useFilesStore } from "./files";

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
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
  mocks.cancelProofreading.mockReset();
  mocks.releaseIdleProofreadingWorker.mockReset();
});

describe("releasing project resources", () => {
  it("lets the proofreading worker go once the project is closed", async () => {
    await useFilesStore.getState().openProject("paper");
    mocks.cancelProofreading.mockClear();

    await useFilesStore.getState().closeProject();

    expect(useFilesStore.getState().projectId).toBeNull();
    expect(mocks.releaseIdleProofreadingWorker).toHaveBeenCalledTimes(1);
    const cancelled = mocks.cancelProofreading.mock.invocationCallOrder.at(-1) ?? 0;
    expect(mocks.releaseIdleProofreadingWorker.mock.invocationCallOrder[0]).toBeGreaterThan(cancelled);
  });

  it("keeps the proofreading worker when switching straight to another project", async () => {
    await useFilesStore.getState().openProject("paper");
    mocks.releaseIdleProofreadingWorker.mockClear();

    await useFilesStore.getState().openProject("thesis");

    expect(useFilesStore.getState().projectId).toBe("thesis");
    expect(mocks.releaseIdleProofreadingWorker).not.toHaveBeenCalled();
  });
});
