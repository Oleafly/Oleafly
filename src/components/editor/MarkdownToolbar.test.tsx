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
  currentMarkdownLinkHref: vi.fn<() => string | null>(() => null),
  insertMarkdownBlockquote: vi.fn(),
  insertMarkdownBold: vi.fn(),
  insertMarkdownBulletList: vi.fn(),
  insertMarkdownCode: vi.fn(),
  insertMarkdownHeading: vi.fn(),
  insertMarkdownHighlight: vi.fn(),
  insertMarkdownImage: vi.fn(),
  insertMarkdownItalic: vi.fn(),
  insertMarkdownLink: vi.fn(),
  insertMarkdownOrderedList: vi.fn(),
  insertMarkdownStrikethrough: vi.fn(),
  insertMarkdownSubscript: vi.fn(),
  insertMarkdownSuperscript: vi.fn(),
  insertMarkdownTable: vi.fn(),
  insertMarkdownTaskList: vi.fn(),
  insertMarkdownUnderline: vi.fn(),
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

vi.mock("@/components/editor/markdown-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/markdown-commands")>();
  return { ...actual, ...commands };
});

import { MARKDOWN_HEADING_LEVELS } from "@/components/editor/markdown-commands";
import { MarkdownToolbar } from "./MarkdownToolbar";

const toolbar = en.toolbar;
const withShortcut = (template: string, keys: string) =>
  template.replace("{{shortcut}}", shortcut(keys));

function widenToolbar(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: width,
  });
}

describe("MarkdownToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commands.currentMarkdownLinkHref.mockReturnValue(null);
    widenToolbar(0);
  });

  afterEach(() => {
    widenToolbar(0);
  });

  it("renders every source-mode control on a bar that has room for them", () => {
    widenToolbar(2000);
    render(<MarkdownToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);

    expect(screen.getByLabelText(toolbar.switchToSource)).toHaveTextContent(toolbar.code);
    expect(screen.getByLabelText(toolbar.switchToVisual)).toHaveTextContent(toolbar.visual);
    expect(screen.getByLabelText(withShortcut(toolbar.undo, "⌘Z"))).toBeInTheDocument();
    expect(screen.getByLabelText(withShortcut(toolbar.redo, "⌘⇧Z"))).toBeInTheDocument();
    expect(screen.getByLabelText(withShortcut(toolbar.find, "⌘F"))).toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.headingLevel)).toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.listType)).toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.insertBlockquote)).toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.underline)).toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.highlight)).toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.superscript)).toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.subscript)).toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.insertLink)).toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.insertImage)).toBeInTheDocument();
    expect(screen.queryByLabelText(toolbar.moreOptions)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.boldWithShortcut, "⌘B")));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.italicWithShortcut, "⌘I")));
    fireEvent.click(screen.getByLabelText(toolbar.strikethrough));
    fireEvent.click(screen.getByLabelText(toolbar.inlineCode));
    fireEvent.click(screen.getByLabelText(toolbar.insertTable));
    fireEvent.click(screen.getByLabelText(toolbar.insertLink));
    fireEvent.click(screen.getByLabelText(toolbar.insertImage));
    fireEvent.click(screen.getByLabelText(toolbar.insertBlockquote));
    fireEvent.click(screen.getByLabelText(toolbar.underline));
    fireEvent.click(screen.getByLabelText(toolbar.highlight));
    fireEvent.click(screen.getByLabelText(toolbar.superscript));
    fireEvent.click(screen.getByLabelText(toolbar.subscript));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.undo, "⌘Z")));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.redo, "⌘⇧Z")));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.find, "⌘F")));

    expect(commands.insertMarkdownBold).toHaveBeenCalledOnce();
    expect(commands.insertMarkdownItalic).toHaveBeenCalledOnce();
    expect(commands.insertMarkdownStrikethrough).toHaveBeenCalledOnce();
    expect(commands.insertMarkdownCode).toHaveBeenCalledOnce();
    expect(commands.insertMarkdownTable).toHaveBeenCalledWith(2, 3);
    expect(commands.insertMarkdownLink).toHaveBeenCalledWith();
    expect(commands.insertMarkdownImage).toHaveBeenCalledWith();
    expect(commands.insertMarkdownBlockquote).toHaveBeenCalledOnce();
    expect(commands.insertMarkdownUnderline).toHaveBeenCalledOnce();
    expect(commands.insertMarkdownHighlight).toHaveBeenCalledOnce();
    expect(commands.insertMarkdownSuperscript).toHaveBeenCalledOnce();
    expect(commands.insertMarkdownSubscript).toHaveBeenCalledOnce();
    expect(controller.editorUndo).toHaveBeenCalledOnce();
    expect(controller.editorRedo).toHaveBeenCalledOnce();
    expect(controller.editorFind).toHaveBeenCalledOnce();
  });

  it("offers every heading level from the bar dropdown", () => {
    widenToolbar(2000);
    render(<MarkdownToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(toolbar.headingLevel));

    for (const level of MARKDOWN_HEADING_LEVELS) {
      expect(screen.getByText(level.hLabel)).toBeInTheDocument();
      expect(screen.getByText(level.label())).toBeInTheDocument();
    }

    fireEvent.click(screen.getByText(MARKDOWN_HEADING_LEVELS[2].label()));

    expect(commands.insertMarkdownHeading).toHaveBeenCalledWith(MARKDOWN_HEADING_LEVELS[2]);
  });

  it("offers the three list kinds from the bar dropdown", () => {
    widenToolbar(2000);
    render(<MarkdownToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(toolbar.listType));

    expect(screen.getByText(toolbar.bulletedList)).toBeInTheDocument();
    expect(screen.getByText(toolbar.numberedList)).toBeInTheDocument();
    fireEvent.click(screen.getByText(toolbar.taskList));

    expect(commands.insertMarkdownTaskList).toHaveBeenCalledOnce();
  });

  it("moves every control into the overflow menu when the bar has no room", () => {
    render(<MarkdownToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));

    expect(screen.getByText(toolbar.blockquote)).toBeInTheDocument();
    expect(screen.getByText(toolbar.italic)).toBeInTheDocument();
    expect(screen.getByText(toolbar.strikethrough)).toBeInTheDocument();
    expect(screen.getByText(toolbar.inlineCode)).toBeInTheDocument();
    expect(screen.getByText(toolbar.underline)).toBeInTheDocument();
    expect(screen.getByText(toolbar.highlight)).toBeInTheDocument();
    expect(screen.getByText(toolbar.superscript)).toBeInTheDocument();
    expect(screen.getByText(toolbar.subscript)).toBeInTheDocument();
    expect(screen.getByText(toolbar.insertLink)).toBeInTheDocument();
    expect(screen.getByText(toolbar.insertImage)).toBeInTheDocument();
    expect(screen.getByText(toolbar.heading)).toBeInTheDocument();
    expect(screen.getByText(toolbar.list)).toBeInTheDocument();

    fireEvent.click(screen.getByText(toolbar.bold));
    fireEvent.click(screen.getByText(toolbar.insertTable));

    expect(commands.insertMarkdownBold).toHaveBeenCalledOnce();
    expect(commands.insertMarkdownTable).toHaveBeenCalledWith(2, 3);
  });

  it("opens the heading and list dropdowns from inside the overflow menu", () => {
    render(<MarkdownToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));

    fireEvent.click(screen.getByLabelText(toolbar.headingLevel));
    fireEvent.click(screen.getByText(MARKDOWN_HEADING_LEVELS[0].label()));
    expect(commands.insertMarkdownHeading).toHaveBeenCalledWith(MARKDOWN_HEADING_LEVELS[0]);

    fireEvent.click(screen.getByLabelText(toolbar.listType));
    fireEvent.click(screen.getByText(toolbar.numberedList));
    expect(commands.insertMarkdownOrderedList).toHaveBeenCalledOnce();
  });

  it("swaps the Pandoc-only marks for link and image popovers in visual mode", () => {
    widenToolbar(2000);
    commands.currentMarkdownLinkHref.mockReturnValue("https://oleafly.com");
    render(<MarkdownToolbar wysiwyg={true} onToggleWysiwyg={vi.fn()} />);

    expect(screen.queryByLabelText(toolbar.underline)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(toolbar.highlight)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(toolbar.superscript)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(toolbar.subscript)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(withShortcut(toolbar.find, "⌘F"))).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(toolbar.linkUrl));
    const field = screen
      .getAllByLabelText(toolbar.linkUrl)
      .find((node) => node.tagName === "INPUT") as HTMLInputElement;
    expect(field).toHaveValue("https://oleafly.com");
    expect(field).toHaveAttribute("placeholder", toolbar.linkPlaceholder);

    fireEvent.click(screen.getByText(toolbar.removeLink));
    expect(commands.insertMarkdownLink).toHaveBeenCalledWith("");
    expect(field).toHaveValue("");

    fireEvent.change(field, { target: { value: "https://example.org" } });
    fireEvent.click(screen.getByText(toolbar.apply));
    expect(commands.insertMarkdownLink).toHaveBeenLastCalledWith("https://example.org");
  });

  it("applies an image target from the visual-mode popover", () => {
    widenToolbar(2000);
    render(<MarkdownToolbar wysiwyg={true} onToggleWysiwyg={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(toolbar.imageFile));
    const field = screen
      .getAllByLabelText(toolbar.imageFile)
      .find((node) => node.tagName === "INPUT") as HTMLInputElement;
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", toolbar.imagePlaceholder);
    expect(screen.queryByText(toolbar.removeLink)).not.toBeInTheDocument();

    fireEvent.change(field, { target: { value: "figures/plot.png" } });
    fireEvent.click(screen.getByText(toolbar.apply));

    expect(commands.insertMarkdownImage).toHaveBeenCalledWith("figures/plot.png");
  });

  it("renders the link and image popovers as menu rows in the overflow menu", () => {
    render(<MarkdownToolbar wysiwyg={true} onToggleWysiwyg={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    fireEvent.click(screen.getAllByLabelText(toolbar.imageFile)[0]);
    const field = screen
      .getAllByLabelText(toolbar.imageFile)
      .find((node) => node.tagName === "INPUT") as HTMLInputElement;

    fireEvent.change(field, { target: { value: "figures/scan.png" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    expect(commands.insertMarkdownImage).toHaveBeenCalledWith("figures/scan.png");
  });

  it("seeds the overflow link popover with the link under the cursor", () => {
    commands.currentMarkdownLinkHref.mockReturnValue("https://oleafly.com/docs");
    render(<MarkdownToolbar wysiwyg={true} onToggleWysiwyg={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    fireEvent.click(screen.getAllByLabelText(toolbar.linkUrl)[0]);
    const field = screen
      .getAllByLabelText(toolbar.linkUrl)
      .find((node) => node.tagName === "INPUT") as HTMLInputElement;

    expect(field).toHaveValue("https://oleafly.com/docs");

    fireEvent.submit(field.closest("form") as HTMLFormElement);

    expect(commands.insertMarkdownLink).toHaveBeenCalledWith("https://oleafly.com/docs");
  });

  it("hides the mode switch and the project statistics when asked", () => {
    widenToolbar(2000);
    render(
      <MarkdownToolbar
        wysiwyg={false}
        onToggleWysiwyg={vi.fn()}
        showVisualToggle={false}
        showProjectInfo={false}
      />,
    );

    expect(screen.queryByLabelText(toolbar.switchToSource)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(en.projectInfo.trigger)).not.toBeInTheDocument();
  });

  it("toggles visual mode from the switch", () => {
    widenToolbar(2000);
    const onToggleWysiwyg = vi.fn();
    render(<MarkdownToolbar wysiwyg={false} onToggleWysiwyg={onToggleWysiwyg} />);

    fireEvent.click(screen.getByLabelText(toolbar.switchToVisual));

    expect(onToggleWysiwyg).toHaveBeenCalledOnce();
  });
});
