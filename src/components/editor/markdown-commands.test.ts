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
    run: vi.fn(),
  };
  return { chain: vi.fn(() => self), ...self };
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
