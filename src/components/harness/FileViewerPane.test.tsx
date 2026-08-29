// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query";
import { useFilesStore } from "@/store/files";
import { FileViewerPane } from "./FileViewerPane";

const readFileContent = vi.fn(async (_projectId: string, _path: string) => "");

vi.mock("@/lib/tauri", () => ({
  readFileContent: (...args: unknown[]) =>
    readFileContent(...(args as [string, string])),
}));

function renderPane(path: string) {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <FileViewerPane path={path} />
    </QueryClientProvider>,
  );
}

describe("FileViewerPane", () => {
  beforeEach(() => {
    readFileContent.mockReset();
    readFileContent.mockResolvedValue("\\section{Results}\nGreat findings.\n");
    useFilesStore.setState({ projectId: "p1" } as Partial<
      ReturnType<typeof useFilesStore.getState>
    >);
  });

  it("renders read-only content once loaded", async () => {
    renderPane("paper/main.tex");
    expect(readFileContent).toHaveBeenCalledWith("p1", "paper/main.tex");
    // The CodeMirror host mounts once content resolves.
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
  });

  it("declines binary or oversized files instead of rendering them", async () => {
    readFileContent.mockResolvedValue("a\u0000b");
    renderPane("assets/logo.png");
    await waitFor(() => {
      expect(
        screen.getByText(/doesn't preview as text|too large to preview inline/i),
      ).toBeInTheDocument();
    });
  });
});
