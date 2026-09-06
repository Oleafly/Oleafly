import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  addResearchRoot,
  finishResearchProjectSetup,
  getResearchRootCapabilities,
  listResearchRootFiles,
  previewResearchProject,
  readResearchRootFile,
} from "./research-workspace";

describe("research workspace client", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("adds folders as one typed native request", async () => {
    mocks.invoke.mockResolvedValue({ roots: [] });
    const request = {
      projectId: "paper",
      path: "/data/study",
      label: "Study data",
      role: "data" as const,
      access: "read_only" as const,
    };
    await addResearchRoot(request);
    expect(mocks.invoke).toHaveBeenCalledWith("add_research_root", { request });
  });

  it("keeps bounded browse and preview defaults at the bridge", async () => {
    mocks.invoke.mockResolvedValue({ entries: [] });
    await listResearchRootFiles("paper", "root-a");
    expect(mocks.invoke).toHaveBeenCalledWith("list_research_root_files", {
      projectId: "paper",
      rootId: "root-a",
      relativePath: "",
      maxDepth: 3,
    });
    await readResearchRootFile("paper", "root-a", "results.csv");
    expect(mocks.invoke).toHaveBeenLastCalledWith("read_research_root_file", {
      projectId: "paper",
      rootId: "root-a",
      relativePath: "results.csv",
      maxBytes: 256 * 1024,
    });
  });

  it("requests task capabilities without upgrading access", async () => {
    mocks.invoke.mockResolvedValue([]);
    await getResearchRootCapabilities("paper", "task");
    expect(mocks.invoke).toHaveBeenCalledWith("research_root_capabilities", {
      projectId: "paper",
      consumer: "task",
    });
  });

  it("passes project setup choices through one preview request", async () => {
    mocks.invoke.mockResolvedValue({ files: [] });
    const request = {
      name: "Evidence and uncertainty",
      engine: "typst" as const,
      starter: "literature_review" as const,
    };
    await previewResearchProject(request);
    expect(mocks.invoke).toHaveBeenCalledWith("preview_research_project", { request });
  });

  it("retries task setup without creating another project", async () => {
    const createProject = vi.fn().mockResolvedValue("new-project");
    const ensureInitialTask = vi
      .fn()
      .mockRejectedValueOnce(new Error("store unavailable"))
      .mockResolvedValueOnce(undefined);
    const onCreated = vi.fn().mockResolvedValue(undefined);
    let progress = { projectId: null as string | null, initialTaskReady: false };
    const input = {
      request: { name: "Paper", engine: "latex" as const, starter: "article" as const },
      task: { title: "Plan the article", prompt: "Plan it", starter: "article" as const },
      ensureInitialTask,
      onCreated,
      onProgress: (next: typeof progress) => {
        progress = next;
      },
      createProject,
    };
    await expect(finishResearchProjectSetup({ ...input, progress })).rejects.toMatchObject({
      stage: "task",
      projectId: "new-project",
    });
    await finishResearchProjectSetup({ ...input, progress });
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(ensureInitialTask).toHaveBeenCalledTimes(2);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("retries opening without recreating the project or task", async () => {
    const createProject = vi.fn().mockResolvedValue("new-project");
    const ensureInitialTask = vi.fn().mockResolvedValue(undefined);
    const onCreated = vi
      .fn()
      .mockRejectedValueOnce(new Error("open failed"))
      .mockResolvedValueOnce(undefined);
    let progress = { projectId: null as string | null, initialTaskReady: false };
    const input = {
      request: { name: "Paper", engine: "typst" as const, starter: "thesis" as const },
      task: { title: "Plan the thesis", prompt: "Plan it", starter: "thesis" as const },
      ensureInitialTask,
      onCreated,
      onProgress: (next: typeof progress) => {
        progress = next;
      },
      createProject,
    };
    await expect(finishResearchProjectSetup({ ...input, progress })).rejects.toMatchObject({ stage: "open" });
    await finishResearchProjectSetup({ ...input, progress });
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(ensureInitialTask).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(2);
  });
});
