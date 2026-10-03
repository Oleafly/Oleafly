// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import enSymbols from "@/i18n/locales/en/symbols.json" with { type: "json" };
import { shortcut } from "@/lib/utils";

const editorHistory = vi.hoisted(() => ({ canUndo: true, canRedo: true }));
vi.mock("@/components/editor/history-signal", () => ({ useEditorHistory: () => editorHistory }));
const controller = vi.hoisted(() => ({
  editorFind: vi.fn(),
  editorRedo: vi.fn(),
  editorUndo: vi.fn(),
  getEditorView: vi.fn(() => null),
  insertAtCursor: vi.fn(),
  insertEnvironment: vi.fn(),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

const commands = vi.hoisted(() => ({
  addTypstLabel: vi.fn(async () => {}),
  insertTypstAlignedMath: vi.fn(),
  insertTypstBold: vi.fn(),
  insertTypstBulletList: vi.fn(),
  insertTypstCodeBlock: vi.fn(),
  insertTypstDisplayMath: vi.fn(),
  insertTypstFigure: vi.fn(async () => {}),
  insertTypstFootnote: vi.fn(),
  insertTypstFraction: vi.fn(),
  insertTypstHeading: vi.fn(),
  insertTypstImage: vi.fn(),
  insertTypstItalic: vi.fn(),
  insertTypstLink: vi.fn(),
  insertTypstMath: vi.fn(),
  insertTypstNumberedEquation: vi.fn(async () => {}),
  insertTypstNumberedList: vi.fn(),
  insertTypstQuote: vi.fn(),
  insertTypstRawInline: vi.fn(),
  insertTypstReferenceTo: vi.fn(async () => {}),
  insertTypstStrikethrough: vi.fn(),
  insertTypstSymbol: vi.fn(async () => {}),
  insertTypstTable: vi.fn(async () => {}),
  insertTypstUnderline: vi.fn(),
}));

const vision = vi.hoisted(() => ({
  imageToLatexAvailable: vi.fn(async () => false),
  imageToTypst: vi.fn(async () => {}),
  imageToLatex: vi.fn(async () => {}),
}));

const synctex = vi.hoisted(() => ({ goToSyncTex: vi.fn() }));

const nav = vi.hoisted(() => ({
  goToDefinition: vi.fn(() => true),
  findReferences: vi.fn(() => true),
  startRename: vi.fn(() => true),
}));

vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));

vi.mock("@/components/editor/project-info-data", () => ({
  collectProjectInfo: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);
vi.mock("@/features/image-to-latex", () => vision);
vi.mock("@/features/synctex", () => synctex);
vi.mock("@/lib/index/nav", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...nav,
}));

vi.mock("@/components/editor/typst-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/typst-commands")>();
  return { ...actual, ...commands };
});

import { TYPST_HEADING_LEVELS } from "@/components/editor/typst-commands";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useDiagramComposerStore } from "@/store/diagram-composer";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";
import { TypstToolbar } from "./TypstToolbar";

const toolbar = en.toolbar;
const withShortcut = (template: string, keys: string) =>
  template.replace("{{shortcut}}", shortcut(keys));

function widenToolbar(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: width,
  });
}

describe("TypstToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vision.imageToLatexAvailable.mockResolvedValue(false);
    widenToolbar(0);
    useFilesStore.setState({ activePath: "main.typ", files: { "main.typ": { content: "= A <sec:a>\n" } } } as never);
  });

  afterEach(() => {
    widenToolbar(0);
  });

  it("writes Typst markup from every control on a bar that has room", () => {
    widenToolbar(4000);
    render(<TypstToolbar />);

    expect(screen.queryByLabelText(toolbar.moreOptions)).not.toBeInTheDocument();
    expect(screen.getByLabelText(en.projectInfo.trigger)).toBeInTheDocument();

    const buttons: [string, keyof typeof commands][] = [
      [withShortcut(toolbar.boldWithShortcut, "⌘B"), "insertTypstBold"],
      [withShortcut(toolbar.italicWithShortcut, "⌘I"), "insertTypstItalic"],
      [toolbar.underline, "insertTypstUnderline"],
      [toolbar.strikethrough, "insertTypstStrikethrough"],
      [toolbar.inlineCode, "insertTypstRawInline"],
      [toolbar.insertLink, "insertTypstLink"],
      [toolbar.addLabel, "addTypstLabel"],
      [toolbar.insertFootnote, "insertTypstFootnote"],
      [toolbar.insertBlockquote, "insertTypstQuote"],
      [toolbar.insertFigure, "insertTypstFigure"],
      [toolbar.insertImage, "insertTypstImage"],
      [toolbar.math, "insertTypstMath"],
      [toolbar.displayMath, "insertTypstDisplayMath"],
      [toolbar.numberedEquation, "insertTypstNumberedEquation"],
      [toolbar.alignedEquations, "insertTypstAlignedMath"],
      [toolbar.insertFraction, "insertTypstFraction"],
      [toolbar.codeBlock, "insertTypstCodeBlock"],
    ];
    for (const [label, command] of buttons) {
      fireEvent.click(screen.getByLabelText(label));
      expect(commands[command], label).toHaveBeenCalledOnce();
    }
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.undo, "⌘Z")));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.redo, "⌘⇧Z")));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.find, "⌘F")));
    expect(controller.editorUndo).toHaveBeenCalledOnce();
    expect(controller.editorRedo).toHaveBeenCalledOnce();
    expect(controller.editorFind).toHaveBeenCalledOnce();
  });

  it("disables undo and redo when the editor has nothing to undo or redo", () => {
    widenToolbar(4000);
    Object.assign(editorHistory, { canUndo: false, canRedo: true });
    const { rerender } = render(<TypstToolbar />);
    expect(screen.getByLabelText(withShortcut(toolbar.undo, "⌘Z"))).toBeDisabled();
    expect(screen.getByLabelText(withShortcut(toolbar.redo, "⌘⇧Z"))).toBeEnabled();
    Object.assign(editorHistory, { canUndo: true, canRedo: false });
    rerender(<TypstToolbar />);
    expect(screen.getByLabelText(withShortcut(toolbar.undo, "⌘Z"))).toBeEnabled();
    expect(screen.getByLabelText(withShortcut(toolbar.redo, "⌘⇧Z"))).toBeDisabled();
    Object.assign(editorHistory, { canUndo: true, canRedo: true });
  });

  it("opens the Typst diagram composer without asking", async () => {
    widenToolbar(4000);
    useHomeViewStore.setState({ page: "library", queuedPageAfterProjectClose: null });
    useDiagramComposerStore.setState({ language: "tikz", requestId: 0, chooserOpen: false });
    render(<TypstToolbar />);

    fireEvent.click(screen.getByLabelText(toolbar.drawDiagram));

    await waitFor(() => expect(useHomeViewStore.getState().page).toBe("diagram-composer"));
    expect(useDiagramComposerStore.getState()).toMatchObject({
      language: "typst",
      requestId: 1,
      chooserOpen: false,
    });
  });

  it("inserts a Typst table from the size picker", () => {
    widenToolbar(4000);
    render(<TypstToolbar />);
    fireEvent.click(screen.getByLabelText(en.table.trigger));
    fireEvent.click(screen.getByLabelText("2 by 3 table"));
    expect(commands.insertTypstTable).toHaveBeenCalledWith(2, 3);
  });

  it("references a project label from the label picker", () => {
    widenToolbar(4000);
    render(<TypstToolbar />);
    fireEvent.click(screen.getByLabelText(toolbar.insertCrossReference));
    fireEvent.click(screen.getByText("sec:a"));
    expect(commands.insertTypstReferenceTo).toHaveBeenCalledWith("sec:a");
  });

  it("inserts Typst symbol names from the symbol picker", async () => {
    widenToolbar(4000);
    render(<TypstToolbar />);
    fireEvent.click(screen.getByLabelText(enSymbols.picker.trigger));
    await waitFor(() => expect(screen.getByLabelText("Insert alpha (alpha)")).toBeInTheDocument(), {
      timeout: 10_000,
    });
    fireEvent.click(screen.getByLabelText("Insert alpha (alpha)"));
    expect(commands.insertTypstSymbol).toHaveBeenCalledWith("\\alpha", "α");
  }, 15_000);

  it("offers code navigation from the code menu", () => {
    widenToolbar(4000);
    controller.getEditorView.mockReturnValue({} as never);
    render(<TypstToolbar />);
    fireEvent.click(screen.getByLabelText(toolbar.codeIntelligence));
    fireEvent.click(screen.getByText(toolbar.goToDefinition));
    expect(nav.goToDefinition).toHaveBeenCalledOnce();
    controller.getEditorView.mockReturnValue(null);
  });

  it("transcribes an image into Typst when a vision model is ready", async () => {
    vision.imageToLatexAvailable.mockResolvedValue(true);
    widenToolbar(4000);
    render(<TypstToolbar />);
    await waitFor(() => expect(screen.getByTestId("image-to-typst")).toBeInTheDocument());
    const input = screen.getByTestId("image-to-typst-input") as HTMLInputElement;
    const file = new File([new Uint8Array([1])], "eq.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(vision.imageToTypst).toHaveBeenCalledWith(file);
    expect(vision.imageToLatex).not.toHaveBeenCalled();
  });

  it("offers every heading level and both list kinds from the bar dropdowns", () => {
    widenToolbar(4000);
    render(<TypstToolbar />);

    fireEvent.click(screen.getByLabelText(toolbar.headingLevel));
    for (const level of TYPST_HEADING_LEVELS) {
      expect(screen.getByText(level.hLabel)).toBeInTheDocument();
      expect(screen.getByText(level.label())).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText(TYPST_HEADING_LEVELS[1].label()));
    expect(commands.insertTypstHeading).toHaveBeenCalledWith(TYPST_HEADING_LEVELS[1]);

    fireEvent.click(screen.getByLabelText(toolbar.listType));
    expect(screen.getByText(toolbar.numberedList)).toBeInTheDocument();
    fireEvent.click(screen.getByText(toolbar.bulletedList));
    expect(commands.insertTypstBulletList).toHaveBeenCalledOnce();
  });

  it("moves every control into the overflow menu when the bar has no room", () => {
    render(<TypstToolbar />);

    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));

    for (const label of [
      toolbar.heading,
      toolbar.list,
      toolbar.italic,
      toolbar.underline,
      toolbar.strikethrough,
      toolbar.inlineCode,
      toolbar.insertLink,
      toolbar.insertCrossReference,
      toolbar.addLabel,
      toolbar.insertFootnote,
      toolbar.insertBlockquote,
      toolbar.insertFigure,
      en.table.menuLabel,
      toolbar.insertImage,
      toolbar.math,
      toolbar.displayMath,
      toolbar.numberedEquation,
      toolbar.alignedEquations,
      toolbar.fraction,
      enSymbols.picker.menuLabel,
      toolbar.codeBlock,
      toolbar.code,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByText(toolbar.bold));
    expect(commands.insertTypstBold).toHaveBeenCalledOnce();
  });

  it("jumps to the PDF from the bar only when the project can sync", () => {
    const typstEngine = (sync: boolean) => ({
      ...LATEX_ENGINE,
      id: "typst",
      capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst", supports_synctex: sync },
    });
    useFilesStore.setState({ engineLoaded: true, projectKind: "", engine: typstEngine(true) } as never);
    const { unmount } = render(<TypstToolbar />);
    fireEvent.click(screen.getByLabelText(toolbar.goToPdfTypst));
    expect(synctex.goToSyncTex).toHaveBeenCalledOnce();
    unmount();

    useFilesStore.setState({ engine: typstEngine(false) } as never);
    const { unmount: unmountUnsupported } = render(<TypstToolbar />);
    expect(screen.queryByLabelText(toolbar.goToPdfTypst)).not.toBeInTheDocument();
    unmountUnsupported();

    useFilesStore.setState({ activePath: "notes.typ", engine: LATEX_ENGINE } as never);
    render(<TypstToolbar />);
    expect(screen.queryByLabelText(toolbar.goToPdfTypst)).not.toBeInTheDocument();
  });

  it("opens document insights and document settings", () => {
    render(<TypstToolbar />);
    fireEvent.click(screen.getByLabelText(en.typstInsights.title));
    expect(useTypstDocumentPanelStore.getState().panel).toBe("insights");
    fireEvent.click(screen.getByLabelText(en.typstSettings.title));
    expect(useTypstDocumentPanelStore.getState().panel).toBe("settings");
    act(() => useTypstDocumentPanelStore.getState().closePanel());
  });

  it("opens the heading and list dropdowns from inside the overflow menu", () => {
    render(<TypstToolbar />);
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));

    fireEvent.click(screen.getByLabelText(toolbar.headingLevel));
    fireEvent.click(screen.getByText(TYPST_HEADING_LEVELS[5].label()));
    expect(commands.insertTypstHeading).toHaveBeenCalledWith(TYPST_HEADING_LEVELS[5]);

    fireEvent.click(screen.getByLabelText(toolbar.listType));
    fireEvent.click(screen.getByText(toolbar.numberedList));
    expect(commands.insertTypstNumberedList).toHaveBeenCalledOnce();
  });
});
