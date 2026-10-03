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
const settingsButton = () => screen.queryByRole("button", { name: en.typstSettings.title });
const follows = (first: HTMLElement, second: HTMLElement) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(() => {
  useFilesStore.setState({ engine: initial.engine, engineLoaded: initial.engineLoaded, projectKind: initial.projectKind });
  useTypstDocumentPanelStore.getState().closePanel();
});

describe("Document settings toolbar buttons", () => {
  it("open the settings panel from the LaTeX toolbar, after Packages and Insights", () => {
    useFilesStore.setState({ engine: { ...LATEX_ENGINE, id: "latexmk" }, engineLoaded: true, projectKind: "document" });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    const packages = screen.getByRole("button", { name: en.toolbar.latexPackages });
    const insights = screen.getByRole("button", { name: en.typstInsights.title });
    const settings = settingsButton() as HTMLElement;
    expect(follows(packages, insights)).toBe(true);
    expect(follows(insights, settings)).toBe(true);
    fireEvent.click(settings);
    expect(useTypstDocumentPanelStore.getState().panel).toBe("settings");
  });

  it("open the settings panel from the Markdown toolbar, after Insights", () => {
    useFilesStore.setState({ engine: MARKDOWN_ENGINE, engineLoaded: true, projectKind: "document" });
    render(<MarkdownToolbar wysiwyg onToggleWysiwyg={vi.fn()} />);
    const insights = screen.getByRole("button", { name: en.typstInsights.title });
    const settings = settingsButton() as HTMLElement;
    expect(follows(insights, settings)).toBe(true);
    fireEvent.click(settings);
    expect(useTypstDocumentPanelStore.getState().panel).toBe("settings");
  });

  it("are hidden for diagram projects and on toolbars of other engines", () => {
    useFilesStore.setState({ engine: LATEX_ENGINE, engineLoaded: true, projectKind: "diagram" });
    const latex = render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(settingsButton()).not.toBeInTheDocument();
    latex.unmount();
    useFilesStore.setState({ engine: LATEX_ENGINE, engineLoaded: true, projectKind: "document" });
    const markdown = render(<MarkdownToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(settingsButton()).not.toBeInTheDocument();
    markdown.unmount();
  });
});
