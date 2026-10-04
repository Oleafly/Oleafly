import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownLanguage } from "./markdown";

function math(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [markdownLanguage()] });
  const tree = ensureSyntaxTree(state, doc.length, 1_000);
  if (!tree) throw new Error("The Markdown tree did not finish parsing");
  const found: string[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "PandocMath") found.push(doc.slice(node.from, node.to));
    },
  });
  return found;
}

describe("Pandoc math in Markdown", () => {
  it("recognises inline and display math", () => {
    expect(math("Inline $a+b$ and display $$c$$ here.")).toEqual(["$a+b$", "$$c$$"]);
  });

  it("skips escaped dollars but not a dollar after an escaped backslash", () => {
    expect(math("Price \\$5 and \\$6.")).toEqual([]);
    expect(math("Path \\\\$x$ end.")).toEqual(["$x$"]);
  });

  it("requires inline math to hug its content and stay on one line", () => {
    expect(math("Costs $ 5 and $6 now.")).toEqual([]);
    expect(math("A $x $ b.")).toEqual([]);
    expect(math("A $x\ny$ b.")).toEqual([]);
    expect(math("A $")).toEqual([]);
  });

  it("allows escaped characters inside math and display math across lines", () => {
    expect(math("A $a\\$b$ end.")).toEqual(["$a\\$b$"]);
    expect(math("$$\na\n$$")).toEqual(["$$\na\n$$"]);
    expect(math("Open $$never closed")).toEqual([]);
  });
});
