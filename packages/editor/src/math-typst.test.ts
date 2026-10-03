import { EditorState } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";
import { typstMathAt, typstMathExpressionsInState } from "./math-typst";
import { loadTypstParser, typstLanguage } from "./typst";

const DOC = [
  "Inline $x^2$ and display $ a + b $.",
  "`raw $r$` and #f(\"$s$\") // $c$",
  "#let y = $c d$",
  "Unclosed $k",
].join("\n");

function sources(state: EditorState): string[] {
  return typstMathExpressionsInState(state, 0, state.doc.length).map((expression) => expression.source);
}

describe("typstMathExpressionsInState", () => {
  it("falls back to a text scan while the Typst parser is still loading", () => {
    const state = EditorState.create({ doc: DOC });
    expect(sources(state)).toEqual(["$x^2$", "$ a + b $", "$c d$", "$k"]);
  });

  describe("with the Typst syntax tree", () => {
    beforeAll(async () => {
      await loadTypstParser();
    });

    const parsed = () => EditorState.create({ doc: DOC, extensions: [typstLanguage()] });

    it("reads equations from Equation nodes only", () => {
      const expressions = typstMathExpressionsInState(parsed(), 0, DOC.length);
      expect(expressions.map((expression) => [expression.source, expression.display, expression.status])).toEqual([
        ["$x^2$", false, "complete"],
        ["$ a + b $", true, "complete"],
        ["$c d$", false, "complete"],
        ["$k", false, "incomplete"],
      ]);
    });

    it("keeps an equation with nested content whole, unlike the text scan", () => {
      const doc = "$ a #box[$b$] c $";
      const state = EditorState.create({ doc, extensions: [typstLanguage()] });
      expect(sources(state)).toEqual([doc]);
      expect(sources(EditorState.create({ doc }))).not.toEqual([doc]);
    });

    it("keeps body offsets inside the delimiters", () => {
      const [first] = typstMathExpressionsInState(parsed(), 0, DOC.length);
      expect(DOC.slice(first.bodyFrom, first.bodyTo)).toBe("x^2");
    });

    it("finds the complete equation around a position", () => {
      const state = parsed();
      expect(typstMathAt(state, DOC.indexOf("a + b"))?.source).toBe("$ a + b $");
      expect(typstMathAt(state, DOC.indexOf("raw"))).toBeNull();
      expect(typstMathAt(state, DOC.indexOf("$r$") + 1)).toBeNull();
      expect(typstMathAt(state, DOC.indexOf("$k") + 1)).toBeNull();
    });
  });
});
