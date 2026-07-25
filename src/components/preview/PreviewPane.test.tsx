// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
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
      refreshTree: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useTourStore.setState({ activeTourId: null });
  });

  it("offers the real Recompile action and invokes the compile handler", () => {
    render(<PreviewPane />);
    expect(
      screen.getByText("Compile your document to render a PDF preview here."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Recompile"));
    expect(recompile).toHaveBeenCalledOnce();
  });
});
