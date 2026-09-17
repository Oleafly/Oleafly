import { describe, expect, it } from "vitest";
import * as api from "./index";

describe("package index", () => {
  it("exports the integration surface the app needs", () => {
    const names = [
      "WYSIWYG_EXTENSIONS",
      "createWysiwygExtensions",
      "parseLatexBody",
      "serializeLatexBody",
      "htmlToLatex",
      "theoremEnvironmentsFromPreamble",
      "latexColorToCss",
      "tableSpecToColumns",
      "columnsToTableSpec",
      "createTableFloat",
      "createFigure",
      "splitMathSource",
      "mathRenderInput",
      "mathNodeJSON",
      "WYSIWYG_NODE_NAMES",
      "WYSIWYG_MARK_NAMES",
      "OPEN_SOURCE_EDITOR_EVENT",
      "setWysiwygTranslator",
      "MathInline",
      "MathDisplay",
      "Footnote",
      "Theorem",
      "Figure",
      "TableFloat",
      "TextColor",
      "ColorBox",
    ];
    for (const name of names) {
      expect(name in api, name).toBe(true);
    }
  });
});
