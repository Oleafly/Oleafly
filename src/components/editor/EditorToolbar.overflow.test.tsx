// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useDiagramComposerStore } from "@/store/diagram-composer";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";

const controller = vi.hoisted(() => ({
  editorFind: vi.fn(),
  editorRedo: vi.fn(),
  editorUndo: vi.fn(),
  getEditorView: vi.fn<() => unknown>(() => ({ id: "view" })),
}));

const nav = vi.hoisted(() => ({
  goToDefinition: vi.fn(),
  findReferences: vi.fn(),
  startRename: vi.fn(),
}));

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));

vi.mock("./cm/controller", () => controller);
vi.mock("@/lib/index/nav", () => nav);
vi.mock("@/lib/toast", () => ({ toast: toasts }));
vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));
vi.mock("@/components/editor/project-info-data", () => ({ collectProjectInfo: vi.fn() }));

import { EditorToolbar } from "./EditorToolbar";

const toolbar = en.toolbar;

describe("EditorToolbar overflow menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controller.getEditorView.mockReturnValue({ id: "view" });
    useFilesStore.setState({
      projectKind: "",
      engineLoaded: true,
      engine: LATEX_ENGINE,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("names the heading, list and code groups as menu rows", () => {
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));

    expect(screen.getByText(toolbar.heading)).toBeInTheDocument();
    expect(screen.getByText(toolbar.list)).toBeInTheDocument();
    expect(screen.getAllByText(toolbar.code).length).toBeGreaterThan(1);
  });

  it("takes the source editor to a definition, its references and a rename", () => {
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    fireEvent.click(screen.getByLabelText(toolbar.codeIntelligence));

    fireEvent.click(screen.getByText(toolbar.goToDefinition));
    expect(nav.goToDefinition).toHaveBeenCalledWith({ id: "view" });

    fireEvent.click(screen.getByLabelText(toolbar.codeIntelligence));
    fireEvent.click(screen.getByText(toolbar.findReferences));
    expect(nav.findReferences).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText(toolbar.codeIntelligence));
    fireEvent.click(screen.getByText(toolbar.renameSymbol));
    expect(nav.startRename).toHaveBeenCalledOnce();
    expect(toasts.info).not.toHaveBeenCalled();
  });

  it("keeps code navigation available while Visual mode is on", () => {
    render(<EditorToolbar wysiwyg={true} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    fireEvent.click(screen.getByLabelText(toolbar.codeIntelligence));

    fireEvent.click(screen.getByText(toolbar.goToDefinition));

    expect(nav.goToDefinition).toHaveBeenCalledWith({ id: "view" });
    expect(toasts.info).not.toHaveBeenCalled();
  });

  it("opens the TikZ composer over the open project without asking", async () => {
    const closeProject = vi.fn(async () => undefined);
    useFilesStore.setState({ projectId: "paper", closeProject });
    useHomeViewStore.setState({ page: "library", queuedPageAfterProjectClose: null });
    useDiagramComposerStore.setState({ language: "mermaid", requestId: 0, chooserOpen: false });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));

    fireEvent.click(screen.getByText(toolbar.drawDiagram));

    await vi.waitFor(() => expect(useHomeViewStore.getState().page).toBe("diagram-composer"));
    expect(useDiagramComposerStore.getState()).toMatchObject({
      language: "tikz",
      requestId: 1,
      chooserOpen: false,
    });
    expect(closeProject).not.toHaveBeenCalled();
  });

  it("offers no PDF jump for a LaTeX file the Typst project does not compile", () => {
    useFilesStore.setState({
      activePath: "notes.tex",
      engine: { ...LATEX_ENGINE, id: "typst", source_extensions: ["typ"] },
    });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(screen.queryByLabelText(toolbar.goToPdf)).not.toBeInTheDocument();
    cleanup();

    useFilesStore.setState({ activePath: "main.tex", engine: LATEX_ENGINE });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(screen.getByLabelText(toolbar.goToPdf)).toBeInTheDocument();
  });

  it("names the second mode segment after the surface a diagram project edits", () => {
    useFilesStore.setState({ projectKind: "diagram" });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);

    expect(screen.getByLabelText(toolbar.switchToVisual)).toHaveTextContent(toolbar.canvas);
  });
});
