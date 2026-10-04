// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  insertEnvironment: vi.fn(),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);

import {
  setWysiwygEditor,
  setWysiwygVisible,
} from "@/components/editor/wysiwyg/controller";
import {
  MARKDOWN_HEADING_LEVELS,
  insertMarkdownBlockquote,
  insertMarkdownBold,
  insertMarkdownBulletList,
  insertMarkdownCode,
  insertMarkdownHeading,
  insertMarkdownHighlight,
  insertMarkdownImage,
  insertMarkdownItalic,
  insertMarkdownLink,
  insertMarkdownOrderedList,
  insertMarkdownStrikethrough,
  insertMarkdownSubscript,
  insertMarkdownSuperscript,
  insertMarkdownTable,
  insertMarkdownTaskList,
  insertMarkdownUnderline,
  currentMarkdownLinkHref,
} from "./markdown-commands";

function fakeWysiwygEditor() {
  const self = {
    focus: vi.fn().mockReturnThis(),
    toggleBold: vi.fn().mockReturnThis(),
    toggleItalic: vi.fn().mockReturnThis(),
    toggleStrike: vi.fn().mockReturnThis(),
    toggleCode: vi.fn().mockReturnThis(),
    toggleHeading: vi.fn().mockReturnThis(),
    toggleBlockquote: vi.fn().mockReturnThis(),
    toggleBulletList: vi.fn().mockReturnThis(),
    toggleOrderedList: vi.fn().mockReturnThis(),
    insertTable: vi.fn().mockReturnThis(),
    extendMarkRange: vi.fn().mockReturnThis(),
    unsetLink: vi.fn().mockReturnThis(),
    setLink: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    setImage: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  return {
    chain: vi.fn(() => self),
    getAttributes: vi.fn((_mark: string): Record<string, unknown> => ({})),
    isActive: vi.fn((_mark: string) => false),
    state: { selection: { empty: true } },
    ...self,
  };
}

function visualEditor() {
  const editor = fakeWysiwygEditor();
  setWysiwygEditor(editor as never);
  setWysiwygVisible(true);
  return editor;
}

beforeEach(() => {
  vi.clearAllMocks();
  setWysiwygEditor(null);
  setWysiwygVisible(false);
});

describe("markdown source syntax", () => {
  it("wraps the inline marks CommonMark understands", () => {
    insertMarkdownBold();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("**", "**", "text");
    insertMarkdownItalic();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("*", "*", "text");
    insertMarkdownStrikethrough();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("~~", "~~", "text");
    insertMarkdownCode();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("`", "`", "code");
  });

  it("uses Pandoc spans for underline and highlight rather than raw HTML", () => {
    // Pandoc drops raw HTML on the way to LaTeX, so `<u>` would never reach
    // the PDF; a bracketed span becomes \ul{} and \hl{}.
    insertMarkdownUnderline();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith(
      "[",
      "]{.underline}",
      "text",
    );
    insertMarkdownHighlight();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith(
      "[",
      "]{.mark}",
      "text",
    );
  });

  it("uses Pandoc's native superscript and subscript", () => {
    insertMarkdownSuperscript();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("^", "^", "text");
    insertMarkdownSubscript();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("~", "~", "text");
  });

  it("prefixes block constructs", () => {
    insertMarkdownBlockquote();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("> ", "\n", "quoted text");
    insertMarkdownBulletList();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("- ", "\n", "Item");
    insertMarkdownOrderedList();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("1. ", "\n", "Item");
    insertMarkdownTaskList();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("- [ ] ", "\n", "Task");
  });

  it("writes a heading with one hash per level", () => {
    const h3 = MARKDOWN_HEADING_LEVELS.find((level) => level.level === 3);
    if (!h3) throw new Error("The Markdown heading catalog must include level 3");
    insertMarkdownHeading(h3);
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith(
      "### ",
      "\n",
      h3.placeholder,
    );
  });

  it("selects the editable part of link, image, and table templates", () => {
    insertMarkdownLink();
    const [linkTemplate, linkFrom, linkTo] = controller.insertTemplate.mock.calls[0];
    expect(linkTemplate.slice(linkFrom, linkTo)).toBe("link text");

    insertMarkdownImage();
    const [imageTemplate, imageFrom, imageTo] = controller.insertTemplate.mock.calls[1];
    expect(imageTemplate.slice(imageFrom, imageTo)).toBe("image-filename");

    insertMarkdownTable(2, 3);
    const [tableTemplate, tableFrom, tableTo] = controller.insertTemplate.mock.calls[2];
    expect(tableTemplate.slice(tableFrom, tableTo)).toBe("Column 1");
    // A header row, its delimiter, and one line per body row.
    expect(tableTemplate.trimEnd().split("\n")).toHaveLength(4);
    expect(tableTemplate).toContain("| --- | --- | --- |");
  });
});

describe("markdown visual-mode routing", () => {
  it("toggles native marks instead of writing syntax", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    insertMarkdownBold();
    expect(editor.toggleBold).toHaveBeenCalled();
    insertMarkdownStrikethrough();
    expect(editor.toggleStrike).toHaveBeenCalled();
    insertMarkdownBulletList();
    expect(editor.toggleBulletList).toHaveBeenCalled();
    insertMarkdownHeading(MARKDOWN_HEADING_LEVELS[1]);
    expect(editor.toggleHeading).toHaveBeenCalledWith({ level: 2 });
    expect(controller.wrapSelectionOrPlaceholder).not.toHaveBeenCalled();
  });
});

describe("markdown visual-mode commands", () => {
  it("toggles italic, code, quotes and numbered lists", () => {
    const editor = visualEditor();
    insertMarkdownItalic();
    insertMarkdownCode();
    insertMarkdownBlockquote();
    insertMarkdownOrderedList();
    expect(editor.toggleItalic).toHaveBeenCalledOnce();
    expect(editor.toggleCode).toHaveBeenCalledOnce();
    expect(editor.toggleBlockquote).toHaveBeenCalledOnce();
    expect(editor.toggleOrderedList).toHaveBeenCalledOnce();
    expect(controller.wrapSelectionOrPlaceholder).not.toHaveBeenCalled();
  });

  it("inserts a table with a header row and at least one body row and column", () => {
    const editor = visualEditor();
    insertMarkdownTable(2, 3);
    expect(editor.insertTable).toHaveBeenLastCalledWith({ rows: 3, cols: 3, withHeaderRow: true });
    insertMarkdownTable(0, 0);
    expect(editor.insertTable).toHaveBeenLastCalledWith({ rows: 2, cols: 1, withHeaderRow: true });
    expect(controller.insertTemplate).not.toHaveBeenCalled();
  });

  it("removes the link for an empty address", () => {
    const editor = visualEditor();
    insertMarkdownLink("   ");
    insertMarkdownLink();
    expect(editor.unsetLink).toHaveBeenCalledTimes(2);
    expect(editor.setLink).not.toHaveBeenCalled();
  });

  it("inserts placeholder link text at an empty cursor outside a link", () => {
    const editor = visualEditor();
    insertMarkdownLink(" https://oleafly.com ");
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "text",
      text: "link text",
      marks: [{ type: "link", attrs: { href: "https://oleafly.com" } }],
    });
  });

  it("links the selection or updates the link under the cursor", () => {
    const editor = visualEditor();
    editor.state.selection.empty = false;
    insertMarkdownLink("https://a.example");
    expect(editor.setLink).toHaveBeenLastCalledWith({ href: "https://a.example" });

    editor.state.selection.empty = true;
    editor.isActive.mockReturnValue(true);
    insertMarkdownLink("https://b.example");
    expect(editor.setLink).toHaveBeenLastCalledWith({ href: "https://b.example" });
    expect(editor.insertContent).not.toHaveBeenCalled();
  });

  it("inserts an image only when it has a path", () => {
    const editor = visualEditor();
    insertMarkdownImage("  ");
    expect(editor.setImage).not.toHaveBeenCalled();
    insertMarkdownImage(" figures/plot.png ");
    expect(editor.setImage).toHaveBeenCalledWith({ src: "figures/plot.png", alt: "" });
    expect(controller.insertTemplate).not.toHaveBeenCalled();
  });

  it("falls back to source syntax when the visual editor is not mounted", () => {
    setWysiwygVisible(true);
    insertMarkdownBold();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("**", "**", "text");
    insertMarkdownLink("https://a.example");
    expect(controller.insertTemplate).toHaveBeenCalledWith("[link text](url)", 1, 10);
  });
});

describe("currentMarkdownLinkHref", () => {
  it("reads the link under the cursor in visual mode only", () => {
    expect(currentMarkdownLinkHref()).toBeNull();
    setWysiwygVisible(true);
    expect(currentMarkdownLinkHref()).toBeNull();

    const editor = visualEditor();
    expect(currentMarkdownLinkHref()).toBeNull();
    editor.getAttributes.mockReturnValue({ href: "https://oleafly.com" });
    expect(currentMarkdownLinkHref()).toBe("https://oleafly.com");
    expect(editor.getAttributes).toHaveBeenCalledWith("link");
  });
});
