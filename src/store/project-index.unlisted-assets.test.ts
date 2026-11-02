import type {
  ProjectSourcesRequest,
  ProjectSourcesResult,
} from "@oleafly/backend-port";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  readProjectSourcesBatch: vi.fn<
    (projectId: string, request: ProjectSourcesRequest) => Promise<ProjectSourcesResult>
  >(),
  existingProjectFiles: vi.fn<(projectId: string, paths: string[]) => Promise<string[]>>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readProjectSourcesBatch: bridge.readProjectSourcesBatch,
  existingProjectFiles: bridge.existingProjectFiles,
}));

vi.mock("@/lib/project-intelligence/worker-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/project-intelligence/worker-client")>();
  const { inProcessProjectIntelligenceWorkerFactory } = await import(
    "@/lib/project-intelligence/in-process-worker"
  );
  class InProcessWorkerClient extends original.ProjectIntelligenceWorkerClient {
    constructor() {
      super(inProcessProjectIntelligenceWorkerFactory(), 5_000);
    }
  }
  return { ...original, ProjectIntelligenceWorkerClient: InProcessWorkerClient };
});

import { resetProjectSourcesCache } from "@/lib/project-sources";
import { useIndexStore } from "./project-index";
import { useFilesStore } from "./files";

let diskTexts: Record<string, string> = {};
let diskAssets = new Set<string>();

function serveDisk(_projectId: string, request: ProjectSourcesRequest): Promise<ProjectSourcesResult> {
  return Promise.resolve({
    files: request.paths
      .filter((path) => diskTexts[path] !== undefined)
      .map((path) => ({ path, hash: `hash:${path}:${diskTexts[path]}`, text: diskTexts[path] })),
    unchanged: [],
    unreadable: [],
    truncated: false,
  });
}

function unresolvedTargets(): string[] {
  return (useIndexStore.getState().intelligenceState.data?.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.code === "unresolved-target")
    .map((diagnostic) => diagnostic.location.file);
}

function hiddenImage() {
  return useIndexStore
    .getState()
    .intelligenceState.data?.hierarchy.edges.find(
      (edge) => edge.rawTarget === ".typ-img/example.png",
    );
}

async function settled() {
  await vi.waitFor(() => {
    const state = useIndexStore.getState();
    expect(state.building).toBe(false);
    expect(state.intelligenceState.stale).toBe(false);
  });
}

beforeEach(() => {
  diskTexts = {
    "main.typ": [
      '#image(".typ-img/example.png", width: 20mm)',
      '#image("images/example.png", width: 20mm)',
    ].join("\n"),
  };
  diskAssets = new Set([".typ-img/example.png"]);
  resetProjectSourcesCache();
  bridge.readProjectSourcesBatch.mockReset();
  bridge.readProjectSourcesBatch.mockImplementation(serveDisk);
  bridge.existingProjectFiles.mockReset();
  bridge.existingProjectFiles.mockImplementation(async (_projectId, paths) =>
    paths.filter((path) => diskAssets.has(path)),
  );
  useFilesStore.setState({
    projectId: "project",
    mainDoc: "main.typ",
    activePath: null,
    tree: [
      { path: "main.typ", is_dir: false },
      { path: "images/example.png", is_dir: false },
    ],
    files: {},
  });
  useIndexStore.getState().reset();
});

describe("assets in folders the file tree leaves out", () => {
  it("resolves an image in a hidden folder that exists on disk", async () => {
    await useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(hiddenImage()?.resolution).toBe("resolved"));
    await settled();

    expect(bridge.existingProjectFiles).toHaveBeenCalledWith("project", [".typ-img/example.png"]);
    expect(unresolvedTargets()).toEqual([]);
  });

  it("keeps reporting a hidden-folder image that is not on disk, without asking again and again", async () => {
    diskAssets = new Set();
    await useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(bridge.existingProjectFiles).toHaveBeenCalledTimes(1));
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(hiddenImage()?.resolution).toBe("unresolved");
    expect(unresolvedTargets()).toEqual(["main.typ"]);
    expect(bridge.existingProjectFiles).toHaveBeenCalledTimes(1);
  });

  it("forgets a hidden-folder image once it is gone from disk", async () => {
    await useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(hiddenImage()?.resolution).toBe("resolved"));
    await settled();

    diskAssets = new Set();
    useFilesStore.setState({ tree: [...useFilesStore.getState().tree] });
    await useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(hiddenImage()?.resolution).toBe("unresolved"));
    await settled();
    expect(unresolvedTargets()).toEqual(["main.typ"]);
  });

  it("starts over for another project", async () => {
    await useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(hiddenImage()?.resolution).toBe("resolved"));

    diskAssets = new Set();
    useFilesStore.setState({ projectId: "other" });
    await useIndexStore.getState().rebuildFromDisk();
    await vi.waitFor(() => expect(bridge.existingProjectFiles).toHaveBeenLastCalledWith("other", [".typ-img/example.png"]));
    await settled();
    expect(hiddenImage()?.resolution).toBe("unresolved");
  });
});
