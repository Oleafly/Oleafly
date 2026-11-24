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

  it("keeps text between two list lines where it was written", () => {
    expect(commentPlainText("- a\ntext\n- b")).toBe("- a\ntext\n- b");
    expect(commentPlainText("1. a\ntext\n2. b")).toBe("1. a\ntext\n2. b");
    expect(commentPlainText("- a\n1. b\n- c")).toBe("- a\n1. b\n- c");
  });

  it.each(["- a\n\n- b\n- c", "- a\n\n\n- b\n- c", "- a\n  \n- b\n\n- c", "\n\n- a\n- b\n- c\n\n\n"])(
    "lets blank lines join a list: %j",
    (body) => {
      expect(parseComment(body)).toEqual([
        { kind: "bullet", items: ["a", "b", "c"].map((text) => [{ kind: "text", text }]) },
      ]);
    },
  );

  it("numbers a list on over blank lines", () => {
    expect(commentPlainText("1. a\n\n\n1. b")).toBe("1. a\n2. b");
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

describe("messages read without Markdown", () => {
  it("keeps marks, code and list lines as written and still reads links and math", () => {
    const plain = { markdown: false, math: true } as const;
    expect(parseInline("**bold** _it_ `code` ~~gone~~ see https://x.org/p. and $x_1$", plain)).toEqual([
      { kind: "text", text: "**bold** _it_ `code` ~~gone~~ see " },
      { kind: "link", href: "https://x.org/p", text: "https://x.org/p" },
      { kind: "text", text: ". and " },
      { kind: "math", source: "$x_1$", body: "x_1", display: false },
    ]);
    expect(parseComment("Plan:\n- one\n2. two", plain)).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "Plan:\n- one\n2. two" }] },
    ]);
    expect(parseComment("- one", { markdown: false })).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "- one" }] },
    ]);
  });
});

describe("math in messages", () => {
  const math = (source: string, body: string, display = false) => ({ kind: "math", source, body, display });
  const text = (value: string) => ({ kind: "text", text: value });

  it("reads all four delimiters only when math is on", () => {
    const written = String.raw`$x^2$, \(y\), $$\sum_i a_i$$ and \[z\]`;
    expect(parseInline(written, { math: true })).toEqual([
      math("$x^2$", "x^2"),
      text(", "),
      math(String.raw`\(y\)`, "y"),
      text(", "),
      math(String.raw`$$\sum_i a_i$$`, String.raw`\sum_i a_i`, true),
      text(" and "),
      math(String.raw`\[z\]`, "z", true),
    ]);
    expect(parseInline(written).some((node) => node.kind === "math")).toBe(false);
  });

  it("keeps underscores and stars inside math out of italic and bold", () => {
    expect(parseInline("$a_1$ to $b_2$ and $c*d*e$", { math: true })).toEqual([
      math("$a_1$", "a_1"),
      text(" to "),
      math("$b_2$", "b_2"),
      text(" and "),
      math("$c*d*e$", "c*d*e"),
    ]);
    expect(parseInline("**sum $x_i$**", { math: true })).toEqual([
      { kind: "bold", children: [text("sum "), math("$x_i$", "x_i")] },
    ]);
  });

  it("leaves prices, escaped dollars, code, links and unclosed math as text", () => {
    expect(parseInline(String.raw`It costs $5 and $6, \$7 off, \\ stays`, { math: true })).toEqual([
      text(String.raw`It costs $5 and $6, $7 off, \\ stays`),
    ]);
    expect(parseInline("`$x$` and https://x.org/$y$ and $open", { math: true })).toEqual([
      { kind: "code", text: "$x$" },
      text(" and "),
      { kind: "link", href: "https://x.org/$y$", text: "https://x.org/$y$" },
      text(" and $open"),
    ]);
    expect(parseInline("$ x$ and $$ $$", { math: true })).toEqual([text("$ x$ and $$ $$")]);
  });

  it("reads display math environments as written, and leaves other environments and escaped ones as text", () => {
    const equation = String.raw`\begin{equation}a = $b$\end{equation}`;
    expect(parseInline(`See ${equation} and $c$`, { math: true })).toEqual([
      text("See "),
      math(equation, equation, true),
      text(" and "),
      math("$c$", "c"),
    ]);
    expect(parseInline(String.raw`\begin{itemize}x\end{itemize} \begin{align*}open`, { math: true })).toEqual([
      text(String.raw`\begin{itemize}x\end{itemize} \begin{align*}open`),
    ]);
    expect(parseInline(equation).some((node) => node.kind === "math")).toBe(false);
  });

  it("reads display math over several lines of a paragraph, and gives its source back as plain text", () => {
    const body = "Here:\n$$\na + b\n$$\ndone";
    expect(parseComment(body, { math: true })).toEqual([
      { kind: "paragraph", children: [text("Here:\n"), math("$$\na + b\n$$", "\na + b\n", true), text("\ndone")] },
    ]);
    expect(commentPlainText("- $x$ item")).toBe("- $x$ item");
  });
});
