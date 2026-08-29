// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query";
import { useFilesStore } from "@/store/files";
import { FilePane } from "./FilePane";

const openFile = vi.fn(async () => {});
const readFileContent = vi.fn(async (_projectId: string, _path: string) => "\\section{Results}\n");

vi.mock("@/lib/tauri", () => ({
  readFileContent: (...args: unknown[]) =>
    readFileContent(...(args as [string, string])),
}));

function renderPane(path: string) {
  return render(
    <QueryClientProvider client={createAppQueryClient()}>
      <FilePane path={path} />
    </QueryClientProvider>,
  );
}

describe("FilePane", () => {
  beforeEach(() => {
    openFile.mockClear();
    readFileContent.mockClear();
    useFilesStore.setState({
      projectId: "p1",
      openFile,
    } as Partial<ReturnType<typeof useFilesStore.getState>>);
  });

  it("shows the breadcrumb and reads text files", async () => {
    renderPane("paper/main.tex");
    const breadcrumb = screen.getByTestId("harness-file-viewer-path");
    expect(breadcrumb).toHaveTextContent("paper");
    expect(breadcrumb).toHaveTextContent("main.tex");
    expect(readFileContent).toHaveBeenCalledWith("p1", "paper/main.tex");
  });

  it("routes PDF paths to the PDF viewer, not the text reader", () => {
    renderPane("extras/tux.pdf");
    expect(screen.getByTestId("harness-pdf-file")).toBeInTheDocument();
    expect(screen.queryByTestId("harness-file-viewer")).not.toBeInTheDocument();
  });

  it("opens the workspace editor only through the explicit button", () => {
    renderPane("paper/main.tex");
    fireEvent.click(screen.getByTestId("harness-file-open-in-editor"));
    expect(openFile).toHaveBeenCalledWith("paper/main.tex");
    expect(openFile).toHaveBeenCalledTimes(1);
  });
});
