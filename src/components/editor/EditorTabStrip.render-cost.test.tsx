// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("./FileTabStatus", () => ({
  FileTabStatus: ({ path }: { path: string }) => {
    renders.set(path, (renders.get(path) ?? 0) + 1);
    return null;
  },
}));

import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { EditorTabStrip } from "./EditorTabStrip";

const PATHS = Array.from({ length: 40 }, (_, index) => `chapter-${index}.tex`);

beforeEach(() => {
  renders.clear();
  useFilesStore.setState({
    projectId: "project",
    files: Object.fromEntries(PATHS.map((path) => [path, { content: "x\n", dirty: false }])),
    openTabs: PATHS,
    tabOrder: Object.fromEntries(PATHS.map((path, index) => [path, index + 1])),
    assistantTabs: [],
    activePath: PATHS[0],
    changedOnDisk: [],
  });
  useDiffStore.setState({ diffs: [], activeKey: null });
});

describe("editor tab strip render cost", () => {
  it("re-renders only the tabs whose active state changed when switching files", () => {
    render(<EditorTabStrip diffFocused={false} />);
    renders.clear();

    fireEvent.click(screen.getByText("chapter-7.tex"));

    expect(useFilesStore.getState().activePath).toBe("chapter-7.tex");
    expect([...renders.keys()].sort()).toEqual(["chapter-0.tex", "chapter-7.tex"]);
  });

  it("re-renders only the new tab when another file opens", () => {
    render(<EditorTabStrip diffFocused={false} />);
    renders.clear();

    act(() => {
      useFilesStore.setState((state) => ({
        openTabs: [...state.openTabs, "appendix.tex"],
        tabOrder: { ...state.tabOrder, "appendix.tex": state.openTabs.length + 1 },
      }));
    });

    expect([...renders.keys()]).toEqual(["appendix.tex"]);
  });

  it("does not re-render any tab when a file's content changes without changing its dirty flag", () => {
    useFilesStore.setState((state) => ({
      files: { ...state.files, "chapter-3.tex": { content: "x\n", dirty: true } },
    }));
    render(<EditorTabStrip diffFocused={false} />);
    renders.clear();

    act(() => {
      useFilesStore.setState((state) => ({
        files: { ...state.files, "chapter-3.tex": { content: "xy\n", dirty: true } },
      }));
    });

    expect(renders.size).toBe(0);
  });
});
