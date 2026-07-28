// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";

const indexActions = vi.hoisted(() => ({
  reset: vi.fn(),
  invalidateFilesystem: vi.fn(),
  rebuildFromDisk: vi.fn(() => Promise.resolve()),
  updateFile: vi.fn(),
}));

vi.mock("@/store/project-index", () => ({
  useIndexStore: {
    getState: () => indexActions,
  },
}));

import { IndexKeeper } from "./IndexKeeper";

beforeEach(() => {
  vi.useFakeTimers();
  for (const action of Object.values(indexActions)) action.mockClear();
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
