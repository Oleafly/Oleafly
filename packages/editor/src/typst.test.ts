import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { typstLanguage } from "./typst";

function highlighted(text: string): { from: number; to: number; classes: string }[] {
  const state = EditorState.create({ doc: text, extensions: [typstLanguage()] });
  const spans: { from: number; to: number; classes: string }[] = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state);
  highlightTree(tree, classHighlighter, (from, to, classes) => spans.push({ from, to, classes }));
  return spans;
}

describe("Typst highlighting", () => {
  it("closes inline raw content on the same line", () => {
    const text = "`code` @reference";
    const spans = highlighted(text);
    const reference = spans.find((span) => text.slice(span.from, span.to) === "@reference");
    expect(reference?.classes).toContain("tok-link");
  });

  it("does not highlight equals operators away from a line start as headings", () => {
    const text = "#let same = left == right";
    const spans = highlighted(text);
    expect(spans.some((span) => span.classes.includes("tok-heading"))).toBe(false);
  });
});

describe("Typst highlighting outside ASCII", () => {
  const tokenText = (text: string, name: string) => {
    const state = EditorState.create({ doc: text, extensions: [typstLanguage()] });
    const tree = ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state);
    const found: string[] = [];
    tree.iterate({
      enter(node) {
        if (node.name === name) found.push(text.slice(node.from, node.to));
      },
    });
    return found;
  };

  it("highlights whole Unicode identifiers and references", () => {
    const text = "#výsledek(1) #परिणाम @úvod @obr-výsledky @2020x @obr.1.";
    expect(tokenText(text, "variableName.function")).toEqual(["#výsledek", "#परिणाम"]);
    expect(tokenText(text, "link")).toEqual([
      "@úvod",
      "@obr-výsledky",
      "@2020x",
      "@obr.1",
    ]);
  });

  it("keeps keywords and bools whole-word under Unicode", () => {
    expect(tokenText("#letčas trueá", "keyword")).toEqual([]);
    expect(tokenText("#letčas trueá", "bool")).toEqual([]);
  });

  it("marks list items only at the start of a line", () => {
    expect(tokenText("#f(1) a - b 1) c", "list")).toEqual([]);
    expect(tokenText("  - item\n2. item", "list")).toEqual(["-", "2."]);
  });

  it("treats URLs as links and escapes as literal characters", () => {
    const text = "Viz https://typst.app/docs a pak text. \\$ \\@x // note";
    expect(tokenText(text, "url")).toEqual(["https://typst.app/docs"]);
    expect(tokenText(text, "comment")).toEqual(["// note"]);
    expect(tokenText(text, "string-2")).toEqual([]);
    expect(tokenText(text, "escape")).toEqual(["\\$", "\\@"]);
  });

  it("ends numbers before a minus and Unicode escapes after the hex digits", () => {
    expect(tokenText("#(1-2) #(10pt-2pt)", "number")).toEqual(["1", "2", "10pt", "2pt"]);
    expect(tokenText("A \\u{41 slovo \\u{1F600} konec", "escape")).toEqual([
      "\\u{41",
      "\\u{1F600}",
    ]);
  });
});
