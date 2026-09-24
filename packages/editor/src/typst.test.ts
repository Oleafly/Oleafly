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
