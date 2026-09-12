import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { Sym } from "./types";

const mocks = vi.hoisted(() => ({
  writeProjectFile: vi.fn(),
  setContent: vi.fn(),
  rebuildFromDisk: vi.fn(),
  renamePlan: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

const filesState = {
  projectId: "project-1" as string | null,
  activePath: "main.tex" as string | null,
  files: {} as Record<string, { content: string; dirty: boolean }>,
  setContent: mocks.setContent,
  writeProjectFile: mocks.writeProjectFile,
};

const indexState = {
  index: { renamePlan: mocks.renamePlan } as unknown,
  texts: {} as Record<string, string>,
  rebuildFromDisk: mocks.rebuildFromDisk,
};

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ ...filesState }) },
}));
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => ({ ...indexState }) },
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

import { applyRename } from "./nav";

const SYMBOL: Sym = {
  kind: "label",
  name: "fig:old",
  file: "main.tex",
  from: 0,
  to: 8,
  nameFrom: 0,
  nameTo: 8,
} as unknown as Sym;

const view = { dispatch: vi.fn() } as unknown as EditorView;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.writeProjectFile.mockResolvedValue(undefined);
  mocks.rebuildFromDisk.mockResolvedValue(undefined);
  filesState.projectId = "project-1";
  filesState.activePath = "main.tex";
  filesState.files = {};
  indexState.texts = { "chapters/intro.tex": "See \\ref{fig:old}.\n" };
});

describe("applyRename", () => {
  it("writes a closed file through the files store so the tree refreshes", async () => {
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 1,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.writeProjectFile).toHaveBeenCalledWith(
      "project-1",
      "chapters/intro.tex",
      "See \\ref{fig:new}.\n",
    );
    expect(mocks.setContent).not.toHaveBeenCalled();
    expect(mocks.rebuildFromDisk).toHaveBeenCalled();
  });

  it("edits an open buffer in place instead of writing it", async () => {
    filesState.files = {
      "chapters/intro.tex": { content: "See \\ref{fig:old}.\n", dirty: false },
    };
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 1,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.setContent).toHaveBeenCalledWith(
      "chapters/intro.tex",
      "See \\ref{fig:new}.\n",
    );
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("reports a partial rename instead of claiming success", async () => {
    indexState.texts = {
      "chapters/intro.tex": "See \\ref{fig:old}.\n",
      "chapters/method.tex": "Also \\ref{fig:old}.\n",
    };
    mocks.writeProjectFile.mockRejectedValueOnce(new Error("read only"));
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 2,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
        { file: "chapters/method.tex", from: 10, to: 17, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.writeProjectFile).toHaveBeenCalledTimes(2);
    expect(mocks.rebuildFromDisk).toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Renamed to "fig:new" in 1 of 2 files. Could not write chapters/intro.tex.',
    );
  });

  it("names every file it could not write", async () => {
    indexState.texts = {
      "chapters/intro.tex": "See \\ref{fig:old}.\n",
      "chapters/method.tex": "Also \\ref{fig:old}.\n",
    };
    mocks.writeProjectFile.mockRejectedValue(new Error("read only"));
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 2,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
        { file: "chapters/method.tex", from: 10, to: 17, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.toastError).toHaveBeenCalledWith(
      'Renamed to "fig:new" in 0 of 2 files. Could not write chapters/intro.tex and chapters/method.tex.',
    );
  });

  it("counts the edits it actually applied when every write lands", async () => {
    indexState.texts = {
      "chapters/intro.tex": "See \\ref{fig:old} and \\ref{fig:old}.\n",
    };
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 1,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
        { file: "chapters/intro.tex", from: 27, to: 34, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Renamed to "fig:new" (2 edits in 1 file)',
    );
  });
});
