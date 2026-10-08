// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { LATEX_ENGINE, UNKNOWN_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { shortcut } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

const view = vi.hoisted(() => ({
  dispatch: vi.fn(),
  posAtCoords: vi.fn(() => 7),
  state: {
    doc: { toString: () => "See \\ref{fig:plot}." },
    selection: { main: { empty: true, from: 0, to: 0 } },
  },
}));

const formatting = vi.hoisted(() => ({
  formatWithLanguageService: vi.fn(async () => "formatted"),
}));

const controller = vi.hoisted(() => ({
  getEditorView: vi.fn<() => unknown>(() => null),
  insertAtCursor: vi.fn(),
  wrapSelection: vi.fn(),
}));

const nav = vi.hoisted(() => ({
  goToDefinition: vi.fn(() => true),
  findReferences: vi.fn(() => true),
  startRename: vi.fn(() => true),
  showLookupResult: vi.fn(),
  explainMissingAnalysis: vi.fn(() => true),
}));

const projectIndex = vi.hoisted(() => ({ state: { index: {} as unknown } }));

const fileRename = vi.hoisted(() => ({
  pathReferenceUnderCursor: vi.fn<(view: unknown) => unknown>(() => null),
  startFileRenameAtCursor: vi.fn((_view: unknown) => true),
}));

const inlineAi = vi.hoisted(() => ({ openInlineEdit: vi.fn() }));
const synctex = vi.hoisted(() => ({ goToSyncTex: vi.fn() }));
const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));

const equationExport = vi.hoisted(() => ({
  saveEquationAsSvg: vi.fn(async () => {}),
  saveEquationAsPng: vi.fn(async () => {}),
}));

const latexCommands = vi.hoisted(() => ({
  insertAlign: vi.fn(),
  insertBlockquote: vi.fn(),
  insertBold: vi.fn(),
  insertCode: vi.fn(),
  insertEnumerate: vi.fn(),
  insertEquation: vi.fn(),
  insertFigure: vi.fn(),
  insertFootnote: vi.fn(),
  insertFraction: vi.fn(),
  insertHeading: vi.fn(),
  insertItalic: vi.fn(),
  insertItemize: vi.fn(),
  insertLabel: vi.fn(),
  insertRef: vi.fn(),
  insertTable: vi.fn(),
  insertUnderline: vi.fn(),
}));

const typstCommands = vi.hoisted(() => ({
  addTypstLabel: vi.fn(async () => {}),
  insertTypstAlignedMath: vi.fn(),
  insertTypstBold: vi.fn(),
  insertTypstBulletList: vi.fn(),
  insertTypstDisplayMath: vi.fn(),
  insertTypstFigure: vi.fn(async () => {}),
  insertTypstFootnote: vi.fn(),
  insertTypstFraction: vi.fn(),
  insertTypstHeading: vi.fn(),
  insertTypstItalic: vi.fn(),
  insertTypstLink: vi.fn(),
  insertTypstMath: vi.fn(),
  insertTypstNumberedEquation: vi.fn(async () => {}),
  insertTypstNumberedList: vi.fn(),
  insertTypstQuote: vi.fn(),
  insertTypstRawInline: vi.fn(),
  insertTypstReference: vi.fn(),
  insertTypstStrikethrough: vi.fn(),
  insertTypstTable: vi.fn(async () => {}),
  insertTypstUnderline: vi.fn(),
  toggleTypstComment: vi.fn(),
  typstLanguageServiceOffers: vi.fn((_feature: string) => false),
}));

vi.mock("./cm/controller", () => controller);
vi.mock("@/components/editor/typst-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/typst-commands")>();
  return { ...actual, ...typstCommands };
});
vi.mock("@/components/editor/cm/controller", () => controller);
vi.mock("./cm/inline-ai/openSession", () => inlineAi);
vi.mock("./cm/language-service-format", () => formatting);
vi.mock("@/lib/index/nav", () => nav);
vi.mock("@/lib/file-references/rename-at-cursor", () => fileRename);
vi.mock("@/features/synctex", () => synctex);
vi.mock("@/features/equation-export", () => equationExport);
vi.mock("@/lib/toast", () => ({ toast: toasts }));
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => projectIndex.state },
}));

vi.mock("@/components/editor/latex-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/latex-commands")>();
  return { ...actual, ...latexCommands };
});

import { HEADING_LEVELS } from "@/components/editor/latex-commands";
import { TYPST_HEADING_LEVELS } from "@/components/editor/typst-commands";
import { loadFileRename } from "@/lib/file-references/rename-trigger";
import { EditorContextMenu } from "./EditorContextMenu";

const menu = en.contextMenu;
const toolbar = en.toolbar;

function engineWithProfile(profile: string): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: profile },
  } as DocumentEngineDescriptor;
}

function openMenu(
  engine: DocumentEngineDescriptor,
  engineLoaded: boolean,
  projectKind = "",
  activePath: string | null = null,
) {
  cleanup();
  useFilesStore.setState({ engine, engineLoaded, projectKind, activePath });
  render(
    <EditorContextMenu>
      <div data-testid="editor-surface" />
    </EditorContextMenu>,
  );
  const trigger = screen.getByTestId("editor-surface").parentElement as HTMLElement;
  fireEvent.contextMenu(trigger, { clientX: 12, clientY: 34 });
  return trigger;
}

describe("EditorContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controller.getEditorView.mockReturnValue(view);
    nav.goToDefinition.mockReturnValue(true);
    nav.findReferences.mockReturnValue(true);
    nav.startRename.mockReturnValue(true);
    projectIndex.state = { index: {} };
    typstCommands.typstLanguageServiceOffers.mockImplementation(() => false);
    fileRename.pathReferenceUnderCursor.mockReturnValue(null);
  });

  it("offers only a disabled notice before an engine is loaded", () => {
    openMenu(UNKNOWN_ENGINE, false);

    expect(screen.getByText(menu.engineUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(menu.askAi)).not.toBeInTheDocument();
  });

  it("places the caret at the pointer before opening", () => {
    openMenu(LATEX_ENGINE, true);

    expect(view.posAtCoords).toHaveBeenCalledWith({ x: 12, y: 34 });
    expect(view.dispatch).toHaveBeenCalledWith({ selection: { anchor: 7 } });
  });

  it("keeps a selection the pointer lands in", () => {
    view.state.selection.main = { empty: false, from: 4, to: 10 };
    try {
      openMenu(LATEX_ENGINE, true);
      expect(view.dispatch).not.toHaveBeenCalled();
    } finally {
      view.state.selection.main = { empty: true, from: 0, to: 0 };
    }
  });

  it("formats the document or the selection from the Typst menu", () => {
    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(menu.formatDocument));
    expect(formatting.formatWithLanguageService).toHaveBeenCalledWith(view, "document");

    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(menu.formatSelection));
    expect(formatting.formatWithLanguageService).toHaveBeenCalledWith(view, "selection");
  });

  it("writes Typst markup from the Typst menu", () => {
    openMenu(engineWithProfile("typst"), true);

    fireEvent.click(screen.getByText(menu.askAi));
    expect(inlineAi.openInlineEdit).toHaveBeenCalledWith(view);

    const items: [string, keyof typeof typstCommands][] = [
      [toolbar.bold, "insertTypstBold"],
      [toolbar.italic, "insertTypstItalic"],
      [toolbar.underline, "insertTypstUnderline"],
      [toolbar.strikethrough, "insertTypstStrikethrough"],
      [toolbar.inlineCode, "insertTypstRawInline"],
      [toolbar.insertLink, "insertTypstLink"],
      [menu.toggleComment, "toggleTypstComment"],
      [menu.figure, "insertTypstFigure"],
      [menu.inlineMath, "insertTypstMath"],
      [menu.displayMath, "insertTypstDisplayMath"],
      [menu.numberedEquation, "insertTypstNumberedEquation"],
      [menu.alignedEquations, "insertTypstAlignedMath"],
      [toolbar.fraction, "insertTypstFraction"],
      [menu.quote, "insertTypstQuote"],
      [menu.footnote, "insertTypstFootnote"],
      [menu.crossReference, "insertTypstReference"],
      [menu.addLabel, "addTypstLabel"],
    ];
    for (const [label, command] of items) {
      openMenu(engineWithProfile("typst"), true);
      fireEvent.click(screen.getByText(label));
      expect(typstCommands[command], label).toHaveBeenCalledOnce();
    }

    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(menu.table));
    expect(typstCommands.insertTypstTable).toHaveBeenCalledWith(3, 3);
    expect(controller.wrapSelection).not.toHaveBeenCalled();
    expect(latexCommands.insertBold).not.toHaveBeenCalled();
  });

  it("jumps to the PDF from the Typst menu only when the project can sync", () => {
    const typst = { ...engineWithProfile("typst"), id: "typst", source_extensions: ["typ"] } as DocumentEngineDescriptor;
    openMenu(typst, true, "", "main.typ");
    fireEvent.click(screen.getByText(toolbar.goToPdfTypst));
    expect(synctex.goToSyncTex).toHaveBeenCalledOnce();

    const unsupported = {
      ...typst,
      capabilities: { ...typst.capabilities, supports_synctex: false },
    } as DocumentEngineDescriptor;
    openMenu(unsupported, true, "", "main.typ");
    expect(screen.queryByText(toolbar.goToPdfTypst)).not.toBeInTheDocument();

    openMenu(LATEX_ENGINE, true, "", "notes.typ");
    expect(screen.queryByText(toolbar.goToPdfTypst)).not.toBeInTheDocument();
    expect(screen.queryByText(toolbar.goToPdf)).not.toBeInTheDocument();
  });

  it("offers no PDF jump for a LaTeX file the Typst project does not compile", () => {
    const typst = {
      ...LATEX_ENGINE,
      id: "typst",
      source_extensions: ["typ"],
      capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" },
    } as DocumentEngineDescriptor;
    openMenu(typst, true, "", "notes.tex");
    expect(screen.queryByText(toolbar.goToPdf)).not.toBeInTheDocument();
    expect(screen.queryByText(toolbar.goToPdfTypst)).not.toBeInTheDocument();

    openMenu(LATEX_ENGINE, true, "", "chapters/intro.tex");
    expect(screen.getByText(toolbar.goToPdf)).toBeInTheDocument();
  });

  it("opens the Typst heading and list submenus", () => {
    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(toolbar.heading));
    for (const level of TYPST_HEADING_LEVELS) {
      expect(screen.getByText(level.label())).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText(TYPST_HEADING_LEVELS[2].label()));
    expect(typstCommands.insertTypstHeading).toHaveBeenCalledWith(TYPST_HEADING_LEVELS[2]);

    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(toolbar.list));
    fireEvent.click(screen.getByText(toolbar.numberedList));
    expect(typstCommands.insertTypstNumberedList).toHaveBeenCalledOnce();
  });

  it("shows Typst navigation only for features the language server offers", () => {
    openMenu(engineWithProfile("typst"), true, "", "main.typ");
    expect(screen.queryByText(toolbar.goToDefinition)).not.toBeInTheDocument();
    expect(screen.queryByText(toolbar.renameSymbol)).not.toBeInTheDocument();

    typstCommands.typstLanguageServiceOffers.mockImplementation((feature) => feature !== "references");
    openMenu(engineWithProfile("typst"), true, "", "main.typ");
    expect(screen.queryByText(toolbar.findReferences)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(toolbar.goToDefinition));
    expect(nav.goToDefinition).toHaveBeenCalledWith(view);

    openMenu(engineWithProfile("typst"), true, "", "main.typ");
    fireEvent.click(screen.getByText(toolbar.renameSymbol));
    expect(nav.startRename).toHaveBeenCalledWith(view);
  });

  it("exports the equation under the caret as SVG or PNG from the Typst menu", () => {
    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(menu.equationAsSvg));
    expect(equationExport.saveEquationAsSvg).toHaveBeenCalledOnce();

    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(menu.equationAsPng));
    expect(equationExport.saveEquationAsPng).toHaveBeenCalledOnce();
    expect(equationExport.saveEquationAsSvg).toHaveBeenCalledOnce();
  });

  it("writes Markdown markup from the Markdown menu", () => {
    openMenu(engineWithProfile("markdown"), true);

    fireEvent.click(screen.getByText(menu.askAi));
    expect(inlineAi.openInlineEdit).toHaveBeenCalledWith(view);

    openMenu(engineWithProfile("markdown"), true);
    fireEvent.click(screen.getByText(toolbar.bold));
    expect(controller.wrapSelection).toHaveBeenCalledWith("**", "**");

    openMenu(engineWithProfile("markdown"), true);
    fireEvent.click(screen.getByText(toolbar.italic));
    expect(controller.wrapSelection).toHaveBeenLastCalledWith("*", "*");

    openMenu(engineWithProfile("markdown"), true);
    fireEvent.click(screen.getByText(toolbar.heading));
    expect(controller.insertAtCursor).toHaveBeenCalledWith("# Heading\n");

    openMenu(engineWithProfile("markdown"), true);
    fireEvent.click(screen.getByText(toolbar.bulletedList));
    expect(controller.insertAtCursor).toHaveBeenLastCalledWith("- Item\n");
  });

  it("lists every LaTeX entry with its shortcut", () => {
    openMenu(LATEX_ENGINE, true);

    expect(screen.getByText(menu.askAi).parentElement).toHaveTextContent(shortcut("⌘L"));
    expect(screen.getByText(toolbar.goToDefinition).parentElement).toHaveTextContent(
      shortcut("F12"),
    );
    expect(screen.getByText(toolbar.findReferences).parentElement).toHaveTextContent(
      shortcut("⇧F12"),
    );
    expect(screen.getByText(toolbar.renameSymbol).parentElement).toHaveTextContent(shortcut("F2"));
    expect(screen.getByText(toolbar.bold).parentElement).toHaveTextContent(shortcut("⌘B"));
    expect(screen.getByText(toolbar.italic).parentElement).toHaveTextContent(shortcut("⌘I"));
    for (const label of [
      toolbar.goToPdf,
      toolbar.underline,
      toolbar.inlineCode,
      toolbar.heading,
      toolbar.list,
      toolbar.fraction,
      toolbar.blockquote,
      menu.figure,
      menu.table,
      menu.align,
      menu.equation,
      menu.footnote,
      menu.crossReference,
      menu.label,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("hides the SyncTeX entry for project kinds that have no source mapping", () => {
    openMenu(LATEX_ENGINE, true, "image");

    expect(screen.queryByText(toolbar.goToPdf)).not.toBeInTheDocument();
  });

  it("runs the LaTeX insert commands", () => {
    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.bold));
    expect(latexCommands.insertBold).toHaveBeenCalledOnce();

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.underline));
    expect(latexCommands.insertUnderline).toHaveBeenCalledOnce();

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(menu.table));
    expect(latexCommands.insertTable).toHaveBeenCalledWith(3, 3);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(menu.figure));
    expect(latexCommands.insertFigure).toHaveBeenCalledOnce();

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(menu.equation));
    expect(latexCommands.insertEquation).toHaveBeenCalledOnce();

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(menu.label));
    expect(latexCommands.insertLabel).toHaveBeenCalledOnce();
  });

  it("opens the heading and list submenus", () => {
    openMenu(LATEX_ENGINE, true);

    fireEvent.click(screen.getByText(toolbar.heading));
    for (const level of HEADING_LEVELS) {
      expect(screen.getByText(level.label())).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText(HEADING_LEVELS[1].label()));
    expect(latexCommands.insertHeading).toHaveBeenCalledWith(HEADING_LEVELS[1]);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.list));
    expect(screen.getByText(menu.enumerate)).toBeInTheDocument();
    fireEvent.click(screen.getByText(menu.itemize));
    expect(latexCommands.insertItemize).toHaveBeenCalledOnce();
  });

  it("explains a missing symbol in the shared lookup notice", () => {
    nav.goToDefinition.mockReturnValue(false);
    nav.findReferences.mockReturnValue(false);
    nav.startRename.mockReturnValue(false);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.goToDefinition));
    expect(nav.showLookupResult).toHaveBeenCalledWith(menu.noIndexedSymbol);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.findReferences));
    expect(nav.showLookupResult).toHaveBeenCalledTimes(2);
    expect(nav.showLookupResult).toHaveBeenLastCalledWith(menu.noIndexedSymbol);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.renameSymbol));
    expect(nav.showLookupResult).toHaveBeenLastCalledWith(menu.noRenamableSymbol);
    expect(nav.explainMissingAnalysis).not.toHaveBeenCalled();
    expect(toasts.info).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("adds nothing when navigation has already explained itself", () => {
    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.goToDefinition));
    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.findReferences));
    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.renameSymbol));

    expect(nav.goToDefinition).toHaveBeenCalledWith(view);
    expect(nav.findReferences).toHaveBeenCalledWith(view);
    expect(nav.startRename).toHaveBeenCalledWith(view);
    expect(nav.showLookupResult).not.toHaveBeenCalled();
    expect(toasts.info).not.toHaveBeenCalled();
  });

  it("explains the analysis state instead of denying a rename before the index exists", () => {
    nav.startRename.mockReturnValue(false);
    projectIndex.state = { index: null };

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.renameSymbol));

    expect(nav.explainMissingAnalysis).toHaveBeenCalledWith(view.state.doc.toString());
    expect(nav.showLookupResult).not.toHaveBeenCalled();
    expect(toasts.info).not.toHaveBeenCalled();
  });

  it("stays quiet when navigation succeeds and jumps to the PDF", () => {
    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.goToDefinition));
    expect(nav.showLookupResult).not.toHaveBeenCalled();
    expect(toasts.info).not.toHaveBeenCalled();

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.goToPdf));
    expect(synctex.goToSyncTex).toHaveBeenCalledOnce();
  });

  it("follows the file language for a Typst file in a LaTeX project", () => {
    openMenu(LATEX_ENGINE, true, "", "notes.typ");
    expect(screen.queryByText(menu.align)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(toolbar.bold));
    expect(typstCommands.insertTypstBold).toHaveBeenCalledOnce();
    expect(latexCommands.insertBold).not.toHaveBeenCalled();
  });

  it("follows the file language for a Markdown file in a Typst project", () => {
    openMenu(engineWithProfile("typst"), true, "", "README.md");
    expect(screen.queryByText(menu.equationAsSvg)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(toolbar.bold));
    expect(controller.wrapSelection).toHaveBeenCalledWith("**", "**");
  });

  it("follows the file language for a LaTeX file in a Typst project", () => {
    openMenu(engineWithProfile("typst"), true, "", "appendix.tex");
    fireEvent.click(screen.getByText(toolbar.bold));
    expect(latexCommands.insertBold).toHaveBeenCalledOnce();
    expect(controller.wrapSelection).not.toHaveBeenCalled();
  });

  it("keeps the engine menu for files without a source language", () => {
    openMenu(engineWithProfile("typst"), true, "", "refs.bib");
    fireEvent.click(screen.getByText(toolbar.bold));
    expect(typstCommands.insertTypstBold).toHaveBeenCalledOnce();
  });

  it("skips the caret placement when no editor view is mounted", () => {
    controller.getEditorView.mockReturnValue(null);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(menu.askAi));

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(inlineAi.openInlineEdit).not.toHaveBeenCalled();
  });

  it("offers Rename file only when the caret is on a file path", async () => {
    await loadFileRename();
    openMenu(LATEX_ENGINE, true, "", "main.tex");
    expect(screen.queryByText(menu.renameFile)).not.toBeInTheDocument();

    fileRename.pathReferenceUnderCursor.mockReturnValue({ raw: "figures/plot" });
    for (const [engine, path] of [
      [LATEX_ENGINE, "main.tex"],
      [engineWithProfile("typst"), "main.typ"],
      [engineWithProfile("markdown"), "README.md"],
    ] as const) {
      openMenu(engine, true, "", path);
      fireEvent.click(screen.getByText(menu.renameFile));
      expect(fileRename.startFileRenameAtCursor).toHaveBeenLastCalledWith(view);
    }
    expect(fileRename.startFileRenameAtCursor).toHaveBeenCalledTimes(3);
  });
});
