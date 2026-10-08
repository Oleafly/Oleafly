// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";

const indexActions = vi.hoisted(() => ({
  reset: vi.fn(),
  dispose: vi.fn(),
  invalidateFilesystem: vi.fn(),
  rebuildFromDisk: vi.fn(() => Promise.resolve()),
  updateFile: vi.fn(),
}));
const sourceCache = vi.hoisted(() => ({ resetProjectSourcesCache: vi.fn() }));

vi.mock("@/store/project-index", () => ({
  useIndexStore: {
    getState: () => indexActions,
  },
}));
vi.mock("@/lib/project-sources", () => sourceCache);

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
