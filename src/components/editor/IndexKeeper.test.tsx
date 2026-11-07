// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";

const indexActions = vi.hoisted(() => ({
  reset: vi.fn(),
  dispose: vi.fn(),
  invalidateFilesystem: vi.fn(),
  rebuildFromDisk: vi.fn(() => Promise.resolve()),
  setCompileFolder: vi.fn(),
  updateFile: vi.fn(),
}));
const sourceCache = vi.hoisted(() => ({ resetProjectSourcesCache: vi.fn() }));
const tauri = vi.hoisted(() => ({
  projectCompileFolder: vi.fn((): Promise<string | null> => Promise.resolve("paper")),
}));

vi.mock("@/store/project-index", () => ({
  useIndexStore: {
    getState: () => indexActions,
  },
}));
vi.mock("@/lib/project-sources", () => sourceCache);
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...tauri,
}));

import { IndexKeeper } from "./IndexKeeper";

beforeEach(() => {
  vi.useFakeTimers();
  for (const action of Object.values(indexActions)) action.mockClear();
  sourceCache.resetProjectSourcesCache.mockClear();
  useFilesStore.setState({
    projectId: "project",
    mainDoc: "main.tex",
    tree: [{ path: "main.tex", is_dir: false }],
    files: {
      "main.tex": { content: "\\section{Main}", dirty: false },
    },
    openTabs: ["main.tex"],
    activePath: "main.tex",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useFilesStore.setState({
    projectId: null,
    mainDoc: "main.tex",
    tree: [],
    files: {},
    openTabs: [],
    activePath: null,
  });
});

describe("IndexKeeper compile folder", () => {
  it("tells the index where a compile of the main document runs", async () => {
    render(<IndexKeeper />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(tauri.projectCompileFolder).toHaveBeenCalledWith("project", "main.tex");
    expect(indexActions.setCompileFolder).toHaveBeenCalledWith("paper");
  });

  it("falls back to the project root when the folder cannot be read", async () => {
    tauri.projectCompileFolder.mockRejectedValueOnce(new Error("gone"));
    render(<IndexKeeper />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(indexActions.setCompileFolder).toHaveBeenCalledWith(null);
  });
});

describe("IndexKeeper filesystem identity", () => {
  it("rebuilds when the main document changes and when the last tree entry is deleted", () => {
    render(<IndexKeeper />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    for (const action of Object.values(indexActions)) action.mockClear();

    act(() => {
      useFilesStore.setState({ mainDoc: "appendix.tex" });
    });
    expect(indexActions.invalidateFilesystem).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(indexActions.rebuildFromDisk).toHaveBeenCalledTimes(1);

    for (const action of Object.values(indexActions)) action.mockClear();
    act(() => {
      useFilesStore.setState({ tree: [] });
    });
    expect(indexActions.invalidateFilesystem).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(indexActions.rebuildFromDisk).toHaveBeenCalledTimes(1);
  });
});

describe("IndexKeeper generated files", () => {
  it("shows a synced PDF without treating it as a source change", () => {
    render(<IndexKeeper />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    for (const action of Object.values(indexActions)) action.mockClear();

    act(() => {
      useFilesStore.getState().addGeneratedFile("project", "Thesis.pdf");
      useFilesStore.getState().addGeneratedFile("project", "Abstract.pdf");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(useFilesStore.getState().tree.map((entry) => entry.path)).toEqual([
      "Abstract.pdf",
      "Thesis.pdf",
      "main.tex",
    ]);
    expect(indexActions.invalidateFilesystem).not.toHaveBeenCalled();
    expect(indexActions.rebuildFromDisk).not.toHaveBeenCalled();
  });

  it("ignores a file that is already listed or belongs to another project", () => {
    const before = useFilesStore.getState().tree;
    useFilesStore.getState().addGeneratedFile("project", "main.tex");
    useFilesStore.getState().addGeneratedFile("other", "Thesis.pdf");
    expect(useFilesStore.getState().tree).toBe(before);
  });

  it("goes back to tracking the tree after the next real listing", () => {
    render(<IndexKeeper />);
    act(() => {
      useFilesStore.getState().addGeneratedFile("project", "Thesis.pdf");
    });
    for (const action of Object.values(indexActions)) action.mockClear();

    act(() => {
      useFilesStore.setState({
        tree: [
          { path: "Thesis.pdf", is_dir: false },
          { path: "main.tex", is_dir: false },
        ],
      });
    });

    expect(indexActions.invalidateFilesystem).toHaveBeenCalledTimes(1);
  });
});

describe("IndexKeeper project lifecycle", () => {
  it("releases the analysis worker and the cached sources when the project closes", () => {
    render(<IndexKeeper />);
    expect(indexActions.reset).toHaveBeenCalledTimes(1);
    expect(indexActions.dispose).not.toHaveBeenCalled();

    act(() => {
      useFilesStore.setState({ projectId: null, tree: [], files: {}, openTabs: [], activePath: null });
    });

    expect(indexActions.dispose).toHaveBeenCalledTimes(1);
    expect(sourceCache.resetProjectSourcesCache).toHaveBeenCalledTimes(1);
    expect(indexActions.reset).toHaveBeenCalledTimes(1);
  });

  it("keeps the analysis worker when switching straight to another project", () => {
    render(<IndexKeeper />);

    act(() => {
      useFilesStore.setState({ projectId: "other" });
    });

    expect(indexActions.reset).toHaveBeenCalledTimes(2);
    expect(indexActions.dispose).not.toHaveBeenCalled();
    expect(sourceCache.resetProjectSourcesCache).not.toHaveBeenCalled();
  });

  it("keeps the plain reset when the app starts with no project open", () => {
    useFilesStore.setState({ projectId: null, tree: [], files: {}, openTabs: [], activePath: null });
    render(<IndexKeeper />);

    expect(indexActions.dispose).not.toHaveBeenCalled();
    expect(sourceCache.resetProjectSourcesCache).not.toHaveBeenCalled();
    expect(indexActions.reset).toHaveBeenCalledTimes(1);
  });
});
