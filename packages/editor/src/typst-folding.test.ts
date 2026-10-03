import { foldable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser, typstLanguage } from "./typst";
import { parsedState } from "./visual/test-document";

beforeAll(async () => {
  await loadTypstParser();
});

function foldedText(text: string, lineNumber: number): string | null {
  const state = parsedState(EditorState.create({ doc: text, extensions: [typstLanguage()] }));
  const line = state.doc.line(lineNumber);
  const range = foldable(state, line.from, line.to);
  return range ? state.sliceDoc(range.from, range.to) : null;
}

describe("Typst heading folding", () => {
  const DOC = ["= A", "intro", "== B", "body", "", "= C", "end", ""].join("\n");

  it("folds a heading to the next heading of the same or a higher level", () => {
    expect(foldedText(DOC, 1)).toBe("\nintro\n== B\nbody");
    expect(foldedText(DOC, 3)).toBe("\nbody");
  });

  it("folds the last heading to the end of the document without trailing blank lines", () => {
    expect(foldedText(DOC, 6)).toBe("\nend");
  });

  it("offers nothing for a heading with no body", () => {
    expect(foldedText("= A\n= B\ntext", 1)).toBeNull();
  });

  it("keeps a heading inside a content block within that block", () => {
    expect(foldedText("#block[\n= Inner\ntext\n]\nafter", 2)).toBe("\ntext");
  });

  it("ignores heading markers inside raw blocks", () => {
    expect(foldedText("```\n= not\nraw\n```", 2)).toBeNull();
  });
});

describe("Typst block folding", () => {
  it.each([
    ["argument lists", '#figure(\n  image("a.png"),\n  caption: [A],\n)', '\n  image("a.png"),\n  caption: [A],\n'],
    ["argument lists with trailing content", "#grid(\n  columns: 2,\n)[a]", "\n  columns: 2,\n"],
    ["code blocks", "#{\n  let x = 1\n}", "\n  let x = 1\n"],
    ["content blocks", "#block[\n  text\n]", "\n  text\n"],
    ["dictionaries", "#let d = (\n  a: 1,\n)", "\n  a: 1,\n"],
    ["block comments", "/* one\ntwo */", " one\ntwo "],
    ["fenced raw blocks", "```python\nprint(1)\n```", "\nprint(1)\n"],
    ["display math", "$\n  x + y\n$", "\n  x + y\n"],
  ])("folds multi-line %s", (_name, text, folded) => {
    expect(foldedText(text, 1)).toBe(folded);
  });

  it("does not fold constructs that fit on one line", () => {
    expect(foldedText("#f(a, b) and #{ x } and /* c */", 1)).toBeNull();
  });

  it("does not fold an unclosed block", () => {
    expect(foldedText("#f(\n  a,\n  b", 1)).toBeNull();
  });
});
