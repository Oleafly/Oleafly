import { describe, expect, it } from "vitest";
import { parseTypst } from "./typst-parser";
import { typstHeadings, typstPlainText } from "./typst-structure";

function plain(text: string): string {
  return typstPlainText(parseTypst(text).topNode, text);
}

describe("typstHeadings", () => {
  it("lists headings with their levels and title ranges and skips raw, math and strings", () => {
    const text = '= A\n== B\n```\n= no\n```\n$ = no $\n"= no"\n=== C';
    const tree = parseTypst(text);
    const headings = typstHeadings(tree);
    expect(headings.map((heading) => [heading.level, text.slice(heading.titleFrom, heading.titleTo)])).toEqual([
      [1, "A"],
      [2, "B"],
      [3, "C"],
    ]);
    expect(typstHeadings(tree)).toBe(headings);
  });

  it("uses the end of an empty heading as its title range", () => {
    const [heading] = typstHeadings(parseTypst("="));
    expect([heading.level, heading.titleFrom, heading.titleTo]).toEqual([1, 1, 1]);
  });
});

describe("typstPlainText", () => {
  it("decodes escapes, line breaks and shorthands", () => {
    expect(plain(String.raw`a \u{1F600} b \# d`)).toBe("a 😀 b # d");
    expect(plain("line \\\nnext")).toBe("line next");
    expect(plain("b -- c --- d ... e -? f")).toBe("b – c — d … e f");
  });

  it("keeps raw text, math source and reference targets", () => {
    expect(plain("```py\ncode\n```")).toBe("code");
    expect(plain("`inline`")).toBe("inline");
    expect(plain("``")).toBe("");
    expect(plain("$x^2$")).toBe("x^2");
    expect(plain("$ a $")).toBe("a");
    expect(plain("$x")).toBe("x");
    expect(plain("@fig and @sec[p]")).toBe("@fig and @sec");
  });

  it("joins term items and drops markers, labels and comments", () => {
    expect(plain("/ Term: desc")).toBe("Term: desc");
    expect(plain("/ Only:")).toBe("Only:");
    expect(plain("a <lab> b // c\n/* d */ e")).toBe("a b e");
    expect(plain("*bold* _em_")).toBe("bold em");
    expect(plain("- item\n+ num")).toBe("item num");
  });

  it("reads text from embedded strings, numbers and content arguments", () => {
    expect(plain(String.raw`#"str\n\t\"q\" \u{41}"`)).toBe('str "q" A');
    expect(plain("#strong[bold] #emph[it]")).toBe("bold it");
    expect(plain("#42 #1.5 #2em")).toBe("42 1.5 2em");
    expect(plain('#text("word")')).toBe("word");
    expect(plain("#[content]")).toBe("content");
  });

  it("ignores code that produces no text", () => {
    for (const text of ["#f()", "#f(1)", "#f", "#let x = 1", '#"open']) expect(plain(text), text).toBe("");
  });

  it("reads through a custom reader and starts from a heading body", () => {
    const text = "== *T*";
    const [heading] = typstHeadings(parseTypst(text));
    const reads: Array<[number, number]> = [];
    const result = typstPlainText(heading.node, (from, to) => {
      reads.push([from, to]);
      return text.slice(from, to);
    });
    expect(result).toBe("T");
    expect(reads.every(([from]) => from >= heading.titleFrom)).toBe(true);
  });
});
