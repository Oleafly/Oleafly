import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderDetection } from "@/lib/folder-detection";

const mocks = vi.hoisted(() => ({
  projectDocumentCandidates: vi.fn(),
  setMainDoc: vi.fn(),
  openFile: vi.fn(),
  recompile: vi.fn(),
  revealEditor: vi.fn(),
  logError: vi.fn(async () => {}),
  files: {
    projectId: "linked-a" as string | null,
    manifestHome: "device",
    tree: [] as { path: string; is_dir: boolean }[],
    mainDoc: "main.tex",
  },
  compileStatus: "idle",
}));

vi.mock("@/lib/tauri", () => ({
  projectDocumentCandidates: mocks.projectDocumentCandidates,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({
      ...mocks.files,
      setMainDoc: mocks.setMainDoc,
      openFile: mocks.openFile,
    }),
  },
}));
vi.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ revealEditor: mocks.revealEditor }) },
}));
vi.mock("@/store/compile", () => ({
  useCompileStore: {
    getState: () => ({ recompile: mocks.recompile, status: mocks.compileStatus }),
  },
}));

import { chooseMainDocument, useMainDocumentStore } from "./main-document";

const scan: FolderDetection = {
  main: null,
  decision: "ask",
  source: "scan",
  candidates: [
    {
      path: "a/paper.tex",
      family: "latex",
      tier: "s",
      kind: "document",
      class: "article",
      title: "A",
      depth: 1,
      reasons: [],
    },
  ],
  truncated: false,
  compile_dir: null,
};

beforeEach(() => {
  for (const fn of [
    mocks.projectDocumentCandidates,
    mocks.setMainDoc,
    mocks.openFile,
    mocks.recompile,
    mocks.revealEditor,
  ]) {
    fn.mockReset();
  }
  mocks.files.projectId = "linked-a";
  mocks.files.manifestHome = "device";
  mocks.files.tree = [{ path: "a/paper.tex", is_dir: false }];
  mocks.files.mainDoc = "main.tex";
  mocks.compileStatus = "idle";
  mocks.setMainDoc.mockImplementation(async (path: string) => {
    mocks.files.mainDoc = path;
  });
  mocks.openFile.mockResolvedValue(undefined);
  mocks.recompile.mockResolvedValue(undefined);
  useMainDocumentStore.getState().reset("linked-a");
});

afterEach(() => {
  useMainDocumentStore.getState().reset(null);
});

describe("main document store", () => {
  it("keeps the detection that came with the opened folder", () => {
    useMainDocumentStore.getState().seed("linked-a", scan);
    const state = useMainDocumentStore.getState();
    expect(state.detection).toEqual(scan);
    expect(state.status).toBe("ready");
    useMainDocumentStore.getState().seed("linked-b", scan);
    expect(useMainDocumentStore.getState().projectId).toBe("linked-a");
  });

  it("does not count a detection that settled without listing documents as a search", () => {
    useMainDocumentStore.getState().seed("linked-a", {
      ...scan,
      main: "main.tex",
      decision: "auto",
      source: "manifest",
      candidates: [],
    });
    const state = useMainDocumentStore.getState();
    expect(state.status).toBe("idle");
    expect(state.detection).toBeNull();
  });

  it("searches again each time the change picker opens and keeps the last list meanwhile", async () => {
    useMainDocumentStore.getState().seed("linked-a", scan);
    const later: FolderDetection = {
      ...scan,
      candidates: [...scan.candidates, { ...scan.candidates[0], path: "b/new.tex" }],
    };
    let finish: (detection: FolderDetection) => void = () => {};
    mocks.projectDocumentCandidates.mockReturnValue(
      new Promise<FolderDetection>((resolve) => {
        finish = resolve;
      }),
    );
    useMainDocumentStore.getState().openChange();
    expect(mocks.projectDocumentCandidates).toHaveBeenCalledWith("linked-a");
    expect(useMainDocumentStore.getState().detection).toEqual(scan);
    useMainDocumentStore.getState().openChange();
    expect(mocks.projectDocumentCandidates).toHaveBeenCalledTimes(1);
    finish(later);
    await vi.waitFor(() => expect(useMainDocumentStore.getState().status).toBe("ready"));
    expect(useMainDocumentStore.getState().detection).toEqual(later);
  });

  it("drops a search that finishes after the project was reopened", async () => {
    let finish: (detection: FolderDetection) => void = () => {};
    mocks.projectDocumentCandidates.mockReturnValueOnce(
      new Promise<FolderDetection>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = useMainDocumentStore.getState().load("linked-a");
    useMainDocumentStore.getState().reset("linked-a");
    finish(scan);
    await pending;
    expect(useMainDocumentStore.getState()).toMatchObject({ status: "idle", detection: null });
  });

  it("looks for documents once and only for the open project", async () => {
    mocks.projectDocumentCandidates.mockResolvedValue(scan);
    await useMainDocumentStore.getState().load("linked-a");
    await useMainDocumentStore.getState().load("linked-a");
    await useMainDocumentStore.getState().load("linked-b");
    expect(mocks.projectDocumentCandidates).toHaveBeenCalledTimes(1);
    expect(useMainDocumentStore.getState().detection).toEqual(scan);
  });

  it("records a failed search without a toast", async () => {
    mocks.projectDocumentCandidates.mockRejectedValue(new Error("gone"));
    await useMainDocumentStore.getState().load("linked-a");
    expect(useMainDocumentStore.getState().status).toBe("failed");
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("opens the change picker and searches when nothing is known yet", async () => {
    mocks.projectDocumentCandidates.mockResolvedValue(scan);
    useMainDocumentStore.getState().openChange();
    expect(useMainDocumentStore.getState().changing).toBe(true);
    await vi.waitFor(() => expect(useMainDocumentStore.getState().status).toBe("ready"));
    useMainDocumentStore.getState().closeChange();
    expect(useMainDocumentStore.getState().changing).toBe(false);
  });

  it("sets the main, opens it and compiles when the folder had no main", async () => {
    await expect(chooseMainDocument("a/paper.tex")).resolves.toBe(true);
    expect(mocks.setMainDoc).toHaveBeenCalledWith("a/paper.tex");
    expect(mocks.openFile).toHaveBeenCalledWith("a/paper.tex");
    expect(mocks.revealEditor).toHaveBeenCalled();
    expect(mocks.recompile).toHaveBeenCalledWith({ origin: "automatic" });
  });

  it("does not start a compile when the folder already had a main", async () => {
    mocks.files.tree = [
      { path: "main.tex", is_dir: false },
      { path: "a/paper.tex", is_dir: false },
    ];
    await chooseMainDocument("a/paper.tex");
    expect(mocks.recompile).not.toHaveBeenCalled();
  });

  it("lets a failed switch reach the caller and opens nothing", async () => {
    mocks.setMainDoc.mockRejectedValue(new Error("refused"));
    await expect(chooseMainDocument("a/paper.tex")).rejects.toThrow("refused");
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(mocks.recompile).not.toHaveBeenCalled();
  });
});
