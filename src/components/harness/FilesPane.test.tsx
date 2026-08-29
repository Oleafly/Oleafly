// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { FilesPane } from "./FilesPane";

const openFile = vi.fn(async () => {});

describe("FilesPane", () => {
  beforeEach(() => {
    openFile.mockClear();
    window.localStorage.clear();
    useFilesStore.setState({
      projectId: "p1",
      activePath: null,
      openFile,
      tree: [
        { path: "chapters", is_dir: true },
        { path: "chapters/intro.tex", is_dir: false },
        { path: "chapters/results.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
      ],
    } as Partial<ReturnType<typeof useFilesStore.getState>>);
  });

  it("collapses a directory with a closed-folder icon and hides its files", () => {
    render(<FilesPane />);
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    expect(document.querySelector(".lucide-folder-open")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse chapters" }));
    expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
    expect(screen.queryByText("results.tex")).not.toBeInTheDocument();
    expect(screen.getByText("main.tex")).toBeInTheDocument();
    expect(document.querySelector(".lucide-folder:not(.lucide-folder-open)")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand chapters" }));
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
  });

  it("persists the collapsed directory across mounts", () => {
    const { unmount } = render(<FilesPane />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse chapters" }));
    unmount();

    render(<FilesPane />);
    expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
  });

  it("opens a clicked file only in the in-panel viewer — never the workspace editor", () => {
    const onOpenFile = vi.fn();
    render(<FilesPane onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText("main.tex"));
    expect(openFile).not.toHaveBeenCalled();
    expect(onOpenFile).toHaveBeenCalledWith("main.tex");
  });

  it("filters the tree down to matching paths", () => {
    render(<FilesPane />);
    fireEvent.change(screen.getByTestId("harness-files-filter"), {
      target: { value: "intro" },
    });
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    expect(screen.queryByText("results.tex")).not.toBeInTheDocument();
    expect(screen.queryByText("main.tex")).not.toBeInTheDocument();
  });
});
