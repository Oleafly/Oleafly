import { describe, expect, it } from "vitest";
import { commentPlainText, insertAtCaret, parseComment, parseInline, toggleBullets, wrapSelection } from "./comment-markdown";

describe("comment Markdown subset", () => {
  it("reads bold, italic, strike, code and links, and nests marks", () => {
    expect(parseInline("a **b _c_** ~~d~~ `e **f**` https://x.org/p.")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", children: [{ kind: "text", text: "b " }, { kind: "italic", children: [{ kind: "text", text: "c" }] }] },
      { kind: "text", text: " " },
      { kind: "strike", children: [{ kind: "text", text: "d" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "e **f**" },
      { kind: "text", text: " " },
      { kind: "link", href: "https://x.org/p", text: "https://x.org/p" },
      { kind: "text", text: "." },
    ]);
  });

  it("reads a link with a long run of punctuation in one pass", () => {
    const dots = ".".repeat(40_000);
    const started = performance.now();
    const link = parseInline(`see http://x${dots}y and http://zz${dots}`);
    expect(performance.now() - started).toBeLessThan(150);
    expect(link).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", href: `http://x${dots}y`, text: `http://x${dots}y` },
      { kind: "text", text: " and " },
      { kind: "link", href: "http://zz", text: "http://zz" },
      { kind: "text", text: dots },
    ]);
  });

  it("leaves snake_case, lone markers and other schemes as text", () => {
    expect(parseInline("snake_case_name ** x ** ~~ `` javascript:alert(1) 2*3")).toEqual([
      { kind: "text", text: "snake_case_name ** x ** ~~ `` javascript:alert(1) 2*3" },
    ]);
  });

  it("reads single-asterisk italic like underscore italic, and keeps arithmetic and bold apart", () => {
    const italic = (text: string) => ({ kind: "italic", children: [{ kind: "text", text }] });
    expect(parseInline("Does the diagonal block count towards *k*? We said **no** on Thursday.")).toEqual([
      { kind: "text", text: "Does the diagonal block count towards " },
      italic("k"),
      { kind: "text", text: "? We said " },
      { kind: "bold", children: [{ kind: "text", text: "no" }] },
      { kind: "text", text: " on Thursday." },
    ]);
    expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
    expect(parseInline("***both***")).toEqual([{ kind: "bold", children: [italic("both")] }]);
    expect(parseInline("*a **b** c*")).toEqual([
      { kind: "italic", children: [{ kind: "text", text: "a " }, { kind: "bold", children: [{ kind: "text", text: "b" }] }, { kind: "text", text: " c" }] },
    ]);
    expect(parseInline("* not a list mark*")).toEqual([{ kind: "text", text: "* not a list mark*" }]);
    expect(commentPlainText("towards *k*? **no**")).toBe("towards k? no");
  });

  it("groups list lines and keeps other lines as paragraphs with their breaks", () => {
    expect(parseComment("Plan:\nfirst line\n- one\n- **two**\n3. three\n4. four\nend")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "Plan:\nfirst line" }] },
      { kind: "bullet", items: [[{ kind: "text", text: "one" }], [{ kind: "bold", children: [{ kind: "text", text: "two" }] }]] },
      { kind: "ordered", start: 3, items: [[{ kind: "text", text: "three" }], [{ kind: "text", text: "four" }]] },
      { kind: "paragraph", children: [{ kind: "text", text: "end" }] },
    ]);
  });

  it("turns a body into plain text for previews", () => {
    expect(commentPlainText("Use **median** not `mean`\n- _both_")).toBe("Use median not mean\n- both");
  });
});

describe("format buttons", () => {
  it("wraps the selection, puts the caret inside for an empty one, and unwraps a wrapped selection", () => {
    expect(wrapSelection("say hi now", 4, 6, "**")).toEqual({ text: "say **hi** now", start: 6, end: 8 });
    expect(wrapSelection("ab", 1, 1, "`")).toEqual({ text: "a``b", start: 2, end: 2 });
    expect(wrapSelection("say **hi** now", 6, 8, "**")).toEqual({ text: "say hi now", start: 4, end: 6 });
  });

  it("adds and removes bullets on every selected line", () => {
    const listed = toggleBullets("one\ntwo\nthree", 0, 7);
    expect(listed.text).toBe("- one\n- two\nthree");
    expect(toggleBullets(listed.text, listed.start, listed.end).text).toBe("one\ntwo\nthree");
  });

  it("inserts a mention marker with a space before it when needed", () => {
    expect(insertAtCaret("Ask", 3, 3, "@")).toEqual({ text: "Ask @", start: 5, end: 5 });
    expect(insertAtCaret("", 0, 0, "@")).toEqual({ text: "@", start: 1, end: 1 });
  });
});
