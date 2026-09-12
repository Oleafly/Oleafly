// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { shortcut } from "@/lib/utils";

const controller = vi.hoisted(() => ({
  editorFind: vi.fn(),
  editorRedo: vi.fn(),
  editorUndo: vi.fn(),
  insertEnvironment: vi.fn(),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

const commands = vi.hoisted(() => ({
  insertTypstBold: vi.fn(),
  insertTypstBulletList: vi.fn(),
  insertTypstCodeBlock: vi.fn(),
  insertTypstHeading: vi.fn(),
  insertTypstImage: vi.fn(),
  insertTypstItalic: vi.fn(),
  insertTypstLink: vi.fn(),
  insertTypstMath: vi.fn(),
  insertTypstNumberedList: vi.fn(),
  insertTypstRawInline: vi.fn(),
  insertTypstReference: vi.fn(),
  insertTypstStrikethrough: vi.fn(),
  insertTypstUnderline: vi.fn(),
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

vi.mock("@/components/editor/typst-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/typst-commands")>();
  return { ...actual, ...commands };
});

import { TYPST_HEADING_LEVELS } from "@/components/editor/typst-commands";
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
    widenToolbar(0);
  });

  afterEach(() => {
    widenToolbar(0);
  });

  it("writes Typst markup from every control on a bar that has room", () => {
    widenToolbar(2000);
    render(<TypstToolbar />);

    expect(screen.queryByLabelText(toolbar.moreOptions)).not.toBeInTheDocument();
    expect(screen.getByLabelText(en.projectInfo.trigger)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.boldWithShortcut, "⌘B")));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.italicWithShortcut, "⌘I")));
    fireEvent.click(screen.getByLabelText(toolbar.underline));
    fireEvent.click(screen.getByLabelText(toolbar.strikethrough));
    fireEvent.click(screen.getByLabelText(toolbar.inlineCode));
    fireEvent.click(screen.getByLabelText(toolbar.math));
    fireEvent.click(screen.getByLabelText(toolbar.insertLink));
    fireEvent.click(screen.getByLabelText(toolbar.referenceALabel));
    fireEvent.click(screen.getByLabelText(toolbar.insertImage));
    fireEvent.click(screen.getByLabelText(toolbar.codeBlock));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.undo, "⌘Z")));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.redo, "⌘⇧Z")));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.find, "⌘F")));

    expect(commands.insertTypstBold).toHaveBeenCalledOnce();
    expect(commands.insertTypstItalic).toHaveBeenCalledOnce();
    expect(commands.insertTypstUnderline).toHaveBeenCalledOnce();
    expect(commands.insertTypstStrikethrough).toHaveBeenCalledOnce();
    expect(commands.insertTypstRawInline).toHaveBeenCalledOnce();
    expect(commands.insertTypstMath).toHaveBeenCalledOnce();
    expect(commands.insertTypstLink).toHaveBeenCalledOnce();
    expect(commands.insertTypstReference).toHaveBeenCalledOnce();
    expect(commands.insertTypstImage).toHaveBeenCalledOnce();
    expect(commands.insertTypstCodeBlock).toHaveBeenCalledOnce();
    expect(controller.editorUndo).toHaveBeenCalledOnce();
    expect(controller.editorRedo).toHaveBeenCalledOnce();
    expect(controller.editorFind).toHaveBeenCalledOnce();
  });

  it("offers every heading level and both list kinds from the bar dropdowns", () => {
    widenToolbar(2000);
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

    expect(screen.getByText(toolbar.heading)).toBeInTheDocument();
    expect(screen.getByText(toolbar.list)).toBeInTheDocument();
    expect(screen.getByText(toolbar.italic)).toBeInTheDocument();
    expect(screen.getByText(toolbar.underline)).toBeInTheDocument();
    expect(screen.getByText(toolbar.strikethrough)).toBeInTheDocument();
    expect(screen.getByText(toolbar.inlineCode)).toBeInTheDocument();
    expect(screen.getByText(toolbar.math)).toBeInTheDocument();
    expect(screen.getByText(toolbar.insertLink)).toBeInTheDocument();
    expect(screen.getByText(toolbar.referenceALabel)).toBeInTheDocument();
    expect(screen.getByText(toolbar.insertImage)).toBeInTheDocument();
    expect(screen.getByText(toolbar.codeBlock)).toBeInTheDocument();

    fireEvent.click(screen.getByText(toolbar.bold));
    expect(commands.insertTypstBold).toHaveBeenCalledOnce();
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
