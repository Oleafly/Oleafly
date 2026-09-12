// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";

const controller = vi.hoisted(() => ({
  editorFind: vi.fn(),
  editorRedo: vi.fn(),
  editorUndo: vi.fn(),
  getEditorView: vi.fn<() => unknown>(() => ({ id: "view" })),
}));

const wysiwyg = vi.hoisted(() => ({
  isWysiwygActive: vi.fn(() => false),
  goToWysiwygDefinition: vi.fn(() => false),
  findWysiwygReferences: vi.fn(() => false),
}));

const nav = vi.hoisted(() => ({
  goToDefinition: vi.fn(),
  findReferences: vi.fn(),
  startRename: vi.fn(),
}));

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));

vi.mock("./cm/controller", () => controller);
vi.mock("./wysiwyg/controller", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wysiwyg/controller")>();
  return { ...actual, ...wysiwyg };
});
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
    wysiwyg.isWysiwygActive.mockReturnValue(false);
    wysiwyg.goToWysiwygDefinition.mockReturnValue(false);
    wysiwyg.findWysiwygReferences.mockReturnValue(false);
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

  it("asks the writer to select a citation when the visual surface cannot navigate", () => {
    wysiwyg.isWysiwygActive.mockReturnValue(true);
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    fireEvent.click(screen.getByLabelText(toolbar.codeIntelligence));

    fireEvent.click(screen.getByText(toolbar.goToDefinition));

    expect(nav.goToDefinition).not.toHaveBeenCalled();
    expect(toasts.info).toHaveBeenCalledWith(toolbar.selectCitationFirst);
  });

  it("says a rename needs the source surface", () => {
    wysiwyg.isWysiwygActive.mockReturnValue(true);
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    fireEvent.click(screen.getByLabelText(toolbar.codeIntelligence));

    fireEvent.click(screen.getByText(toolbar.renameSymbol));

    expect(nav.startRename).not.toHaveBeenCalled();
    expect(toasts.info).toHaveBeenCalledWith(toolbar.renameSourceOnly);
  });

  it("stays quiet when the visual surface handled the jump itself", () => {
    wysiwyg.isWysiwygActive.mockReturnValue(true);
    wysiwyg.goToWysiwygDefinition.mockReturnValue(true);
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    fireEvent.click(screen.getByLabelText(toolbar.codeIntelligence));

    fireEvent.click(screen.getByText(toolbar.goToDefinition));

    expect(toasts.info).not.toHaveBeenCalled();
  });

  it("names the second mode segment after the surface a diagram project edits", () => {
    useFilesStore.setState({ projectKind: "diagram" });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);

    expect(screen.getByLabelText(toolbar.switchToVisual)).toHaveTextContent(toolbar.canvas);
  });
});
