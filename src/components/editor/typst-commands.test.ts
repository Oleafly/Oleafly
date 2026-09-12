// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const controller = vi.hoisted(() => ({
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);

import {
  insertTypstBold,
  insertTypstBulletList,
  insertTypstCodeBlock,
  insertTypstHeading,
  insertTypstImage,
  insertTypstItalic,
  insertTypstLink,
  insertTypstMath,
  insertTypstNumberedList,
  insertTypstRawInline,
  insertTypstReference,
  insertTypstStrikethrough,
  insertTypstUnderline,
  TYPST_HEADING_LEVELS,
} from "./typst-commands";

describe("typst commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the six heading levels from the catalog and writes their markup", () => {
    expect(TYPST_HEADING_LEVELS.map((level) => level.hLabel)).toEqual([
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
    ]);
    expect(TYPST_HEADING_LEVELS.map((level) => level.label())).toEqual([
      en.headings.title,
      en.headings.section,
      en.headings.subsection,
      en.headings.subsubsection,
      en.headings.minor,
      en.headings.paragraphHeading,
    ]);

    insertTypstHeading(TYPST_HEADING_LEVELS[2]);

    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith(
      "=== ",
      "\n",
      "Subsection",
    );
  });

  it("wraps the selection for every inline mark", () => {
    insertTypstBold();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("*", "*", "text");

    insertTypstItalic();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("_", "_", "text");

    insertTypstUnderline();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
      "#underline[",
      "]",
      "text",
    );

    insertTypstStrikethrough();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
      "#strike[",
      "]",
      "text",
    );

    insertTypstRawInline();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("`", "`", "code");

    insertTypstMath();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("$", "$", "x");

    insertTypstReference();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("@", "", "label");
  });

  it("writes both list markers and a fenced code block", () => {
    insertTypstBulletList();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("- ", "\n", "Item");

    insertTypstNumberedList();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("+ ", "\n", "Item");

    insertTypstCodeBlock();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
      "```\n",
      "\n```\n",
      "code",
    );
  });

  it("selects the editable part of a link and an image template", () => {
    insertTypstLink();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith('#link("url")[text]', 7, 10);

    insertTypstImage();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith(
      '#image("image-filename")',
      8,
      22,
    );
  });
});
