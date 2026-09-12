// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { LATEX_ENGINE, UNKNOWN_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { shortcut } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

const view = vi.hoisted(() => ({ dispatch: vi.fn(), posAtCoords: vi.fn(() => 7) }));

const controller = vi.hoisted(() => ({
  getEditorView: vi.fn<() => unknown>(() => null),
  insertAtCursor: vi.fn(),
  wrapSelection: vi.fn(),
}));

const nav = vi.hoisted(() => ({
  goToDefinition: vi.fn(() => true),
  findReferences: vi.fn(() => true),
  startRename: vi.fn(() => true),
}));

const inlineAi = vi.hoisted(() => ({ openInlineEdit: vi.fn() }));
const synctex = vi.hoisted(() => ({ goToSyncTex: vi.fn() }));
const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));

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

vi.mock("./cm/controller", () => controller);
vi.mock("@/components/editor/cm/controller", () => controller);
vi.mock("./cm/inline-ai/openSession", () => inlineAi);
vi.mock("@/lib/index/nav", () => nav);
vi.mock("@/features/synctex", () => synctex);
vi.mock("@/lib/toast", () => ({ toast: toasts }));

vi.mock("@/components/editor/latex-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/latex-commands")>();
  return { ...actual, ...latexCommands };
});

import { HEADING_LEVELS } from "@/components/editor/latex-commands";
import { EditorContextMenu } from "./EditorContextMenu";

const menu = en.contextMenu;
const toolbar = en.toolbar;

function engineWithProfile(profile: string): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: profile },
  } as DocumentEngineDescriptor;
}

function openMenu(engine: DocumentEngineDescriptor, engineLoaded: boolean, projectKind = "") {
  cleanup();
  useFilesStore.setState({ engine, engineLoaded, projectKind });
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

  it("writes Typst markup from the Typst menu", () => {
    openMenu(engineWithProfile("typst"), true);

    fireEvent.click(screen.getByText(menu.askAi));
    expect(inlineAi.openInlineEdit).toHaveBeenCalledWith(view);

    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(toolbar.bold));
    expect(controller.wrapSelection).toHaveBeenCalledWith("*", "*");

    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(toolbar.italic));
    expect(controller.wrapSelection).toHaveBeenLastCalledWith("_", "_");

    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(toolbar.heading));
    expect(controller.insertAtCursor).toHaveBeenCalledWith("= Heading\n");

    openMenu(engineWithProfile("typst"), true);
    fireEvent.click(screen.getByText(toolbar.bulletedList));
    expect(controller.insertAtCursor).toHaveBeenLastCalledWith("- Item\n");
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

  it("explains when navigation finds no symbol", () => {
    nav.goToDefinition.mockReturnValue(false);
    nav.findReferences.mockReturnValue(false);
    nav.startRename.mockReturnValue(false);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.goToDefinition));
    expect(toasts.info).toHaveBeenCalledWith(menu.noIndexedSymbol);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.findReferences));
    expect(toasts.info).toHaveBeenCalledTimes(2);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.renameSymbol));
    expect(toasts.info).toHaveBeenLastCalledWith(menu.noRenamableSymbol);
  });

  it("stays quiet when navigation succeeds and jumps to the PDF", () => {
    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.goToDefinition));
    expect(toasts.info).not.toHaveBeenCalled();

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(toolbar.goToPdf));
    expect(synctex.goToSyncTex).toHaveBeenCalledOnce();
  });

  it("skips the caret placement when no editor view is mounted", () => {
    controller.getEditorView.mockReturnValue(null);

    openMenu(LATEX_ENGINE, true);
    fireEvent.click(screen.getByText(menu.askAi));

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(inlineAi.openInlineEdit).not.toHaveBeenCalled();
  });
});
