import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mainDocumentCandidates: vi.fn(),
  setMainDoc: vi.fn(),
  openFile: vi.fn(),
  recompile: vi.fn(),
  stopCompile: vi.fn(async () => {}),
  revealEditor: vi.fn(),
  files: {
    projectId: "linked-a" as string | null,
    manifestHome: "device",
    tree: [] as { path: string; is_dir: boolean }[],
    mainDoc: "main.tex",
  },
  compileStatus: "idle",
}));

vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({
      ...mocks.files,
      setMainDoc: mocks.setMainDoc,
      openFile: mocks.openFile,
    }),
  },
}));
vi.mock("@/lib/tauri", () => ({ mainDocumentCandidates: mocks.mainDocumentCandidates }));
vi.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ revealEditor: mocks.revealEditor }) },
}));
vi.mock("@/store/compile", () => ({
  compileIsBusy: () => mocks.compileStatus === "compiling",
  useCompileStore: {
    getState: () => ({ recompile: mocks.recompile, status: mocks.compileStatus, stopCompile: mocks.stopCompile }),
  },
}));

import type { DetectionCandidate, FolderDetection } from "@/lib/folder-detection";
import { useOpenFolderStore } from "@/store/open-folder";
import { changeMainDocument, chooseMainDocument } from "./main-document";

beforeEach(() => {
  useOpenFolderStore.getState().dismiss();
  for (const fn of [mocks.mainDocumentCandidates, mocks.setMainDoc, mocks.openFile, mocks.recompile, mocks.revealEditor]) {
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
});

describe("choosing the main document", () => {
  it("sets the main, opens it and compiles when the folder had no main", async () => {
    await expect(chooseMainDocument("a/paper.tex")).resolves.toBe(true);
    expect(mocks.setMainDoc).toHaveBeenCalledWith("a/paper.tex");
    expect(mocks.openFile).toHaveBeenCalledWith("a/paper.tex");
    expect(mocks.revealEditor).toHaveBeenCalled();
    expect(mocks.recompile).toHaveBeenCalledWith({ origin: "automatic" });
  });

  it("stops a running compile before it switches, so the switch never waits on it", async () => {
    mocks.compileStatus = "compiling";
    mocks.setMainDoc.mockImplementation(async () => {
      expect(mocks.stopCompile).toHaveBeenCalledOnce();
    });
    await chooseMainDocument("other.tex");
    expect(mocks.setMainDoc).toHaveBeenCalledWith("other.tex");
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

describe("choosing a main document and compiling it", () => {
  it("compiles once when asked to, even when the folder had no main", async () => {
    await chooseMainDocument("a/paper.tex", { compile: true });
    expect(mocks.recompile).toHaveBeenCalledExactlyOnceWith({ origin: "automatic" });

    mocks.recompile.mockClear();
    mocks.files.manifestHome = "library";
    await chooseMainDocument("a/paper.tex", { compile: true });
    expect(mocks.recompile).toHaveBeenCalledExactlyOnceWith({ origin: "automatic" });
  });
});

describe("changing the main document", () => {
  const candidate = (path: string, family: DetectionCandidate["family"]): DetectionCandidate => ({
    path,
    family,
    tier: "a",
    kind: "document",
    class: null,
    title: null,
    depth: 0,
    reasons: [],
  });
  const ranked: FolderDetection = {
    main: "paper.qmd",
    decision: "auto",
    source: "quarto_project",
    candidates: [candidate("paper.qmd", "quarto"), candidate("main.tex", "latex")],
    truncated: false,
    compile_dir: null,
  };

  it("lists every document and starts on the current main", async () => {
    mocks.mainDocumentCandidates.mockResolvedValue(ranked);
    await changeMainDocument();
    expect(mocks.mainDocumentCandidates).toHaveBeenCalledWith("linked-a");
    const { opened, changing } = useOpenFolderStore.getState();
    expect(changing).toBe(true);
    expect(opened).toEqual({
      project_id: "linked-a",
      file: null,
      detection: { ...ranked, decision: "ask", main: "main.tex" },
    });
  });

  it("suggests the best match when the current main is not a document it found", async () => {
    mocks.files.mainDoc = "gone.tex";
    mocks.mainDocumentCandidates.mockResolvedValue(ranked);
    await changeMainDocument();
    expect(useOpenFolderStore.getState().opened?.detection.main).toBe("paper.qmd");
  });

  it("shows nothing when another project opened while it looked", async () => {
    mocks.mainDocumentCandidates.mockImplementation(async () => {
      mocks.files.projectId = "other";
      return ranked;
    });
    await changeMainDocument();
    expect(useOpenFolderStore.getState().opened).toBeNull();
  });
});
