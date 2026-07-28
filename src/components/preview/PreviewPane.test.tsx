// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useTourStore } from "@/store/tours";

vi.mock("@/components/pdf/PdfViewer", () => ({
  PdfViewer: () => <div data-testid="mock-pdf-viewer" />,
}));
vi.mock("@/components/editor/LogPane", () => ({
  LogPane: () => <div data-testid="mock-log-pane" />,
}));
vi.mock("@/features/synctex", () => ({
  inverseFromClick: vi.fn(),
}));
vi.mock("@/features/ask-ai-compile-errors", () => ({
  askAiAboutCompileErrors: vi.fn(),
}));
vi.mock("@/lib/preview-window", () => ({
  openPreviewWindow: vi.fn(),
}));

import { PreviewPane } from "./PreviewPane";

describe("PreviewPane empty state", () => {
  const recompile = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    recompile.mockClear();
    useCompileStore.setState({
      status: "idle",
      phase: "idle",
      log: "",
      errors: [],
      pdfBytes: null,
      compileTimeMs: null,
      recompile,
    } as unknown as ReturnType<typeof useCompileStore.getState>);
    useFilesStore.setState({
      projectId: "preview-empty-fixture",
      projectName: "Preview empty fixture",
      projectKind: "",
      mainDoc: "main.tex",
      engineLoaded: true,
      refreshTree: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useTourStore.setState({ activeTourId: null });
  });

  it("shows the startup state without a duplicate compile button", () => {
    render(<PreviewPane />);
    expect(screen.getByRole("status", { name: /Document startup/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compile now" })).not.toBeInTheDocument();
    expect(recompile).not.toHaveBeenCalled();
  });

  it("reports the language service and its analysis as one startup stage", () => {
    render(<PreviewPane />);
    // Separate rows let analysis show "complete" above a service that is still
    // starting, which reads as an out-of-order checklist.
    expect(screen.queryByText("Language service")).not.toBeInTheDocument();
    expect(screen.getByText("Language analysis")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: /Document startup: \d+ of 3 stages/ }),
    ).toBeInTheDocument();
  });
});
