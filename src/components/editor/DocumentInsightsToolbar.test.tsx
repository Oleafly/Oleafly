// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";

vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));
vi.mock("@/components/editor/project-info-data", () => ({ collectProjectInfo: vi.fn() }));
vi.mock("@/features/image-to-latex", () => ({
  imageToLatexAvailable: vi.fn(async () => false),
  imageToLatex: vi.fn(async () => {}),
}));

import { EditorToolbar } from "./EditorToolbar";
import { MarkdownToolbar } from "./MarkdownToolbar";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const initial = useFilesStore.getState();
const MARKDOWN_ENGINE: DocumentEngineDescriptor = { ...LATEX_ENGINE, id: "markdown", source_format: "markdown" };
const insightsButton = () => screen.queryByRole("button", { name: en.typstInsights.title });

afterEach(() => {
  useFilesStore.setState({ engine: initial.engine, engineLoaded: initial.engineLoaded, projectKind: initial.projectKind });
  useTypstDocumentPanelStore.getState().closePanel();
});

describe("Document insights toolbar buttons", () => {
  it("open the insights panel from the LaTeX toolbar", () => {
    useFilesStore.setState({ engine: { ...LATEX_ENGINE, id: "latexmk" }, engineLoaded: true, projectKind: "document" });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(insightsButton() as HTMLElement);
    expect(useTypstDocumentPanelStore.getState().panel).toBe("insights");
  });

  it("sit after Packages and before the project info on the LaTeX toolbar", () => {
    useFilesStore.setState({ engine: LATEX_ENGINE, engineLoaded: true, projectKind: "document" });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    const packages = screen.getByRole("button", { name: en.toolbar.latexPackages });
    const insights = insightsButton() as HTMLElement;
    expect(packages.compareDocumentPosition(insights) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("are hidden for diagram projects and engines without insights", () => {
    useFilesStore.setState({ engine: LATEX_ENGINE, engineLoaded: true, projectKind: "diagram" });
    const { unmount } = render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(insightsButton()).not.toBeInTheDocument();
    unmount();
    useFilesStore.setState({ engine: LATEX_ENGINE, engineLoaded: true, projectKind: "document" });
    const markdown = render(<MarkdownToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(insightsButton()).not.toBeInTheDocument();
    markdown.unmount();
  });

  it("open the insights panel from the Markdown toolbar", () => {
    useFilesStore.setState({ engine: MARKDOWN_ENGINE, engineLoaded: true, projectKind: "document" });
    render(<MarkdownToolbar wysiwyg onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(insightsButton() as HTMLElement);
    expect(useTypstDocumentPanelStore.getState().panel).toBe("insights");
  });
});
