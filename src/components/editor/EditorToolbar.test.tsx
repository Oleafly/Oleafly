// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";

const countWordsMock = vi.hoisted(() =>
  vi.fn(() => ({ words: 7, characters: 44, lines: 3, method: "masked" as const })),
);
const getEditorViewMock = vi.hoisted(() => vi.fn((): unknown => null));

vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));

vi.mock("@/lib/wordcount", () => ({
  countWords: countWordsMock,
}));

vi.mock("@/components/editor/cm/controller", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEditorView: getEditorViewMock,
}));

import { EditorToolbar } from "./EditorToolbar";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

describe("EditorToolbar wysiwyg toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByLabelText("Word count")).toBeInTheDocument();
  });

  it("computes book-sized word counts only when the popover is opened", () => {
    useFilesStore.setState({
      activePath: "book.tex",
      files: {
        "book.tex": {
          content: "Initial manuscript text.",
          dirty: false,
        },
      },
    });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(countWordsMock).not.toHaveBeenCalled();

    useFilesStore.setState({
      files: {
        "book.tex": {
          content: "The latest complete manuscript text.",
          dirty: true,
        },
      },
    });
    expect(countWordsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Word count"));

    expect(countWordsMock).toHaveBeenCalledOnce();
    expect(countWordsMock).toHaveBeenCalledWith(
      "The latest complete manuscript text.",
    );
    expect(screen.getByText("44")).toBeInTheDocument();
  });

  it("adds a Selection row counting only the primary editor selection", () => {
    const doc = "Alpha beta gamma delta.";
    useFilesStore.setState({
      activePath: "book.tex",
      files: {
        "book.tex": { content: doc, dirty: false },
      },
    });
    getEditorViewMock.mockReturnValueOnce({
      state: {
        selection: { main: { from: 0, to: 10, empty: false } },
        sliceDoc: (from: number, to: number) => doc.slice(from, to),
      },
    });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Word count"));

    expect(countWordsMock).toHaveBeenCalledTimes(2);
    expect(countWordsMock).toHaveBeenLastCalledWith("Alpha beta");
    expect(screen.getByText("Selection")).toBeInTheDocument();
  });

  it("does not add a Selection row when the primary selection is empty", () => {
    useFilesStore.setState({
      activePath: "book.tex",
      files: {
        "book.tex": { content: "Some text.", dirty: false },
      },
    });
    getEditorViewMock.mockReturnValueOnce({
      state: {
        selection: { main: { from: 3, to: 3, empty: true } },
        sliceDoc: () => "",
      },
    });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Word count"));

    expect(countWordsMock).toHaveBeenCalledOnce();
    expect(screen.queryByText("Selection")).not.toBeInTheDocument();
  });
});
