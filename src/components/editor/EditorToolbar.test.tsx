// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";

const collectProjectInfoMock = vi.hoisted(() => vi.fn());

vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));

vi.mock("@/components/editor/project-info-data", () => ({
  collectProjectInfo: collectProjectInfoMock,
}));

import { EditorToolbar } from "./EditorToolbar";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const SNAPSHOT = {
  root: "book.tex",
  fileCount: 3,
  unreadable: [],
  stats: {
    words: 11960,
    wordsInText: 11455,
    wordsInHeaders: 320,
    wordsOutsideText: 185,
    headers: 42,
    figures: 17,
    mathInline: 903,
    mathDisplayed: 128,
    characters: 81028,
    lines: 669,
  },
  selectionWords: null,
};

describe("EditorToolbar wysiwyg toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectProjectInfoMock.mockResolvedValue(SNAPSHOT);
  });

  it("shows a Code/Visual segmented switch and calls onToggleWysiwyg when the Visual segment is clicked while off", () => {
    const onToggleWysiwyg = vi.fn();
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={onToggleWysiwyg} />);
    expect(screen.getByLabelText("Switch to source view")).toHaveTextContent("Code");
    const visualBtn = screen.getByLabelText("Switch to WYSIWYG view");
    expect(visualBtn).toHaveTextContent("Visual");
    fireEvent.click(visualBtn);
    expect(onToggleWysiwyg).toHaveBeenCalledTimes(1);
  });

  it("does not call onToggleWysiwyg when clicking the already-active segment", () => {
    const onToggleWysiwyg = vi.fn();
    render(<EditorToolbar wysiwyg={true} onToggleWysiwyg={onToggleWysiwyg} />);
    fireEvent.click(screen.getByLabelText("Switch to WYSIWYG view"));
    expect(onToggleWysiwyg).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Switch to source view"));
    expect(onToggleWysiwyg).toHaveBeenCalledTimes(1);
  });

  it("places the mode switch ahead of undo, and the info button after the formatting controls", () => {
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    const order = [
      screen.getByLabelText("Switch to source view"),
      screen.getByLabelText(/^Undo \(/u),
      screen.getByLabelText("Project info"),
    ];

    expect(
      order[0].compareDocumentPosition(order[1]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      order[1].compareDocumentPosition(order[2]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not expose CodeMirror-only navigation while Visual mode is active", () => {
    useFilesStore.setState({
      projectKind: "",
      engineLoaded: true,
      engine: LATEX_ENGINE,
    });
    const { rerender } = render(
      <EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />,
    );
    expect(screen.getByLabelText(/^Find \(/u)).toBeInTheDocument();
    expect(screen.getByLabelText("Go to PDF (SyncTeX)")).toBeInTheDocument();

    rerender(<EditorToolbar wysiwyg={true} onToggleWysiwyg={vi.fn()} />);
    expect(screen.queryByLabelText(/^Find \(/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Go to PDF (SyncTeX)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Project info")).toBeInTheDocument();
  });

  it("counts the document only when the panel is opened", async () => {
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(collectProjectInfoMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Project info"));

    expect(collectProjectInfoMock).toHaveBeenCalledOnce();
    expect(await screen.findByText("81,028")).toBeInTheDocument();
    expect(screen.getByText("book.tex · 3 files")).toBeInTheDocument();
  });

  it("breaks the word total down into text, headers, and outside-text rows", async () => {
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Project info"));

    expect(await screen.findByText("11,960")).toBeInTheDocument();
    for (const label of ["In text", "In headers", "Outside text", "Figures", "Math displayed"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("adds a Selection row only when the editor has a selection", async () => {
    collectProjectInfoMock.mockResolvedValue({ ...SNAPSHOT, selectionWords: 12 });
    const { unmount } = render(
      <EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Project info"));
    expect(await screen.findByText("Selection")).toBeInTheDocument();
    unmount();

    collectProjectInfoMock.mockResolvedValue(SNAPSHOT);
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Project info"));
    await waitFor(() => expect(screen.getByText("Words")).toBeInTheDocument());
    expect(screen.queryByText("Selection")).not.toBeInTheDocument();
  });
});
