import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setMainDoc: vi.fn(),
  openFile: vi.fn(),
  recompile: vi.fn(),
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
vi.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ revealEditor: mocks.revealEditor }) },
}));
vi.mock("@/store/compile", () => ({
  useCompileStore: {
    getState: () => ({ recompile: mocks.recompile, status: mocks.compileStatus }),
  },
}));

import { chooseMainDocument } from "./main-document";

beforeEach(() => {
  for (const fn of [mocks.setMainDoc, mocks.openFile, mocks.recompile, mocks.revealEditor]) {
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
