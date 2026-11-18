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

import { EditorToolbar, HeadingDropdown, IconBtn, WysiwygModeSwitch } from "./EditorToolbar";
import { HEADING_LEVELS } from "./latex-commands";
import { MARKDOWN_HEADING_LEVELS } from "./markdown-commands";

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
    expect(screen.queryByRole("button", { name: "Split" })).not.toBeInTheDocument();
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

  it("keeps find and SyncTeX available in both modes", () => {
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
    expect(screen.getByLabelText(/^Find \(/u)).toBeInTheDocument();
    expect(screen.getByLabelText("Go to PDF (SyncTeX)")).toBeInTheDocument();
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

  it("falls back to empty statistics when project counting fails", async () => {
    collectProjectInfoMock.mockRejectedValue(new Error("count failed"));
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Project info"));

    await waitFor(() => expect(screen.getByText("Words")).toBeInTheDocument());
    expect(screen.getAllByText("0").length).toBeGreaterThan(1);
  });
});

describe("EditorToolbar focus", () => {
  it("keeps the caret where it was when a toolbar button is pressed", () => {
    const onClick = vi.fn();
    const probeTitle = "Undo probe";
    const probeChild = "undo";
    render(
      <IconBtn onClick={onClick} title={probeTitle}>
        <span>{probeChild}</span>
      </IconBtn>,
    );
    const button = screen.getByLabelText(probeTitle);

    expect(fireEvent.mouseDown(button)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("labels the toolbar so focus assertions can scope to it", () => {
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(screen.getByTestId("editor-toolbar")).toBeInTheDocument();
  });

  it.each(["code", "visual", "both"] as const)("tints the selected %s segment under keyboard focus, with no ring or outline", (mode) => {
    render(<WysiwygModeSwitch wysiwyg={mode === "visual"} mode={mode} onToggle={vi.fn()} onModeChange={vi.fn()} />);
    const selected = screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(selected).toHaveLength(1);
    const classes = selected[0].className.split(/\s+/u);
    expect(classes).toContain("bg-primary");
    expect(classes.filter((name) => name.startsWith("focus-visible:"))).toEqual(["focus-visible:bg-primary/85"]);
    expect(classes.filter((name) => /(^|:)(ring|outline|shadow)/u.test(name))).toEqual([]);
  });
});

describe("HeadingDropdown", () => {
  it("checks the level the caret is in when the editor reports one, and picks another", () => {
    const insert = vi.fn();
    render(<HeadingDropdown variant="bar" levels={MARKDOWN_HEADING_LEVELS} insert={insert} checked={(level) => level.level === 2} />);
    const trigger = screen.getByRole("button", { name: "Heading level" });
    expect(trigger).toHaveClass("bg-primary/10");
    fireEvent.click(trigger);
    const rows = screen.getAllByRole("menuitemcheckbox");
    expect(rows.map((row) => [row.textContent, row.getAttribute("aria-checked")])).toEqual(
      MARKDOWN_HEADING_LEVELS.map((level) => [`${level.hLabel}${level.label()}`, String(level.level === 2)]),
    );
    fireEvent.click(rows[3]);
    expect(insert).toHaveBeenCalledWith(MARKDOWN_HEADING_LEVELS[3]);
  });

  it("leaves the levels unchecked and the trigger untinted outside a heading", () => {
    render(<HeadingDropdown variant="bar" levels={MARKDOWN_HEADING_LEVELS} insert={vi.fn()} checked={() => false} />);
    const trigger = screen.getByRole("button", { name: "Heading level" });
    expect(trigger).not.toHaveClass("bg-primary/10");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitemcheckbox").map((row) => row.getAttribute("aria-checked"))).toEqual(MARKDOWN_HEADING_LEVELS.map(() => "false"));
  });

  it("keeps LaTeX's heading popover, which tracks no level, as plain buttons", () => {
    render(<HeadingDropdown variant="bar" levels={HEADING_LEVELS} insert={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Heading level" }));
    expect(screen.queryAllByRole("menuitemcheckbox")).toEqual([]);
    expect(screen.getByRole("button", { name: /Section/u })).toBeInTheDocument();
  });
});
