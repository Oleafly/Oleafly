// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { destroyOpenedEditors, mathRanges, openMarkdown, positionAfter, typeAtEndOf, typeText } from "../test-helpers";
import { parseMarkdownBody } from "./parse";

afterEach(destroyOpenedEditors);

const marksOf = (source: string) =>
  (parseMarkdownBody(source).doc.content?.[0]?.content ?? []).map((node) => [
    node.text,
    (node.marks ?? [])
      .map((mark) => (mark.type === "link" ? `link ${mark.attrs?.href}` : mark.type))
      .sort()
      .join(", "),
  ]);

describe("Pandoc spans nested in links and spans", () => {
  it.each([
    ["Link [[x]{.underline}](https://e.com) tail", [["Link ", ""], ["x", "link https://e.com, underline"], [" tail", ""]]],
    [
      "[a [this]{.underline} page](https://e.com)",
      [["a ", "link https://e.com"], ["this", "link https://e.com, underline"], [" page", "link https://e.com"]],
    ],
    ["[[x]{.mark}]{.underline}", [["x", "highlight, underline"]]],
    ["[[l](https://e.com)]{.underline}", [["l", "link https://e.com, underline"]]],
    ["[a [b]{.mark} [c](https://c.com) d]{.underline}", [
      ["a ", "underline"],
      ["b", "highlight, underline"],
      [" ", "underline"],
      ["c", "link https://c.com, underline"],
      [" d", "underline"],
    ]],
  ])("reads %j like Pandoc", (source, marks) => {
    expect(marksOf(source)).toEqual(marks);
  });

  it.each([
    ["[a [b](https://b.com) c](https://a.com)", [["[a ", ""], ["b", "link https://b.com"], [" c](https://a.com)", ""]]],
    [
      "[[x [l](https://l.com)]{.underline}](https://e.com)",
      [["[", ""], ["x ", "underline"], ["l", "link https://l.com, underline"], ["](https://e.com)", ""]],
    ],
  ])("still refuses a link inside a link in %j", (source, marks) => {
    expect(marksOf(source)).toEqual(marks);
  });

  it.each([
    ["Link [[x]{.underline}](https://e.com) tail", "Link [<u>x</u>](https://e.com) tail!"],
    ["[a [this]{.underline} page](https://e.com) tail", "[a <u>this</u> page](https://e.com) tail!"],
    ["[[x]{.mark}]{.underline} tail", "<u><mark>x</mark></u> tail!"],
    ["[[l](https://e.com)]{.underline} tail", "[<u>l</u>](https://e.com) tail!"],
  ])("keeps the link and both marks of %j when the paragraph is edited", (source, saved) => {
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "tail", "!");
    expect(save()).toBe(saved);
    expect(marksOf(saved)).toEqual(marksOf(`${source}!`));
  });
});

describe("Pandoc span attributes", () => {
  it.each([
    "[x]{ .underline }",
    "[x]{  .underline}",
    "[x]{.underline }",
    "[x]{\n.underline}",
  ])("reads the spaced attributes of %j as underline", (source) => {
    expect(marksOf(source)).toEqual([["x", "underline"]]);
  });

  it.each([
    "[y]{.underline .big}",
    "[y]{.mark .underline}",
    "[y]{.underline #id}",
    "[y]{#id}",
  ])("leaves %j as text because Visual cannot keep its other attributes", (source) => {
    expect(marksOf(source)).toEqual([[source, ""]]);
  });

  it("writes spans it leaves as text back as Pandoc spans when the paragraph is edited", () => {
    const source = "[y]{.underline .big} and [z]{.smallcaps} and [w]{#id} and [v]{k=\"a b\"} tail";
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "tail", "!");
    expect(save()).toBe(`${source}!`);
  });

  it("still escapes brackets that are not a span", () => {
    const { editor, save } = openMarkdown("");
    editor.view.dispatch(editor.state.tr.insertText("[a]{b c} and [d]", 1));
    expect(save()).toBe("\\[a\\]{b c} and \\[d\\]");
  });
});

describe("code inside other formatting", () => {
  it.each([
    ["A **`c`** and *`d`* and [`e`](https://e.com) tail", "A **`c`** and *`d`* and [`e`](https://e.com) tail!"],
    ["See [`c`]{.underline} and ^`d`^ tail", "See <u>`c`</u> and <sup>`d`</sup> tail!"],
    ["A **bold `c` run** and [a `b` c](https://e.com) tail", "A **bold `c` run** and [a `b` c](https://e.com) tail!"],
    ["Ticks [`` a`b ``](https://e.com) tail", "Ticks [`` a`b ``](https://e.com) tail!"],
  ])("keeps the formatting around the code in %j when the paragraph is edited", (source, saved) => {
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "tail", "!");
    expect(save()).toBe(saved);
  });

  it.each([
    ["Sup ^a~b~^ tail", "Sup <sup>a~b~</sup> tail!"],
    ["Sub ~a^b^~ tail", "Sub <sub>a^b^</sub> tail!"],
  ])("keeps a script nested in the other script in %j when the paragraph is edited", (source, saved) => {
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "tail", "!");
    expect(save()).toBe(saved);
  });

  it("still reads plain code as code", () => {
    expect(marksOf("A `c` tail")).toEqual([["A ", ""], ["c", "code"], [" tail", ""]]);
  });
});

describe("Pandoc superscript and subscript content", () => {
  it.each([
    ["Sup ^**x**^ tail", [["Sup ", ""], ["x", "bold, superscript"], [" tail", ""]]],
    ["Sup ^[a](https://e.com)^ tail", [["Sup ", ""], ["a", "link https://e.com, superscript"], [" tail", ""]]],
    ["Sub ~*x*~ tail", [["Sub ", ""], ["x", "italic, subscript"], [" tail", ""]]],
    ["a^*x^y*", [["a", ""], ["*x", "superscript"], ["y*", ""]]],
    ["x^a\\^b^", [["x", ""], ["a^b", "superscript"]]],
    ["x^a\\ b^", [["x", ""], ["a\u00a0b", "superscript"]]],
    ["x^a\u00a0b^", [["x", ""], ["a\u00a0b", "superscript"]]],
    ["x~a\u2003b~", [["x", ""], ["a\u2003b", "subscript"]]],
  ])("reads %j like Pandoc", (source, marks) => {
    expect(marksOf(source)).toEqual(marks);
  });

  it.each([
    ["about ~5 people", [["about ~5 people", ""]]],
    ["^[a b](https://e.com)^", [["^", ""], ["a b", "link https://e.com"], ["^", ""]]],
    ["^**a b**^", [["^", ""], ["a b", "bold"], ["^", ""]]],
    ["^`a b`^", [["^", ""], ["a b", "code"], ["^", ""]]],
  ])("keeps Pandoc's limits in %j", (source, marks) => {
    expect(marksOf(source)).toEqual(marks);
  });

  it.each([
    ["Sup ^**x**^ tail", "Sup **<sup>x</sup>** tail!"],
    ["Sup ^[a](https://e.com)^ tail", "Sup [<sup>a</sup>](https://e.com) tail!"],
    ["Sub ~*x*~ tail", "Sub *<sub>x</sub>* tail!"],
  ])("keeps the formatting inside %j when the paragraph is edited", (source, saved) => {
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "tail", "!");
    expect(save()).toBe(saved);
    expect(marksOf(saved)).toEqual(marksOf(`${source}!`));
  });
});

describe("typed carets", () => {
  it.each([
    ["x^2^ and H~2~O", "x^2\\^ and H\\~2\\~O"],
    ["2^10^ vs 2^10", "2^10\\^ vs 2^10"],
    ["^a^ b ^c^ d ^ e", "^a\\^ b ^c\\^ d ^ e"],
    ["^a^b^c", "^a\\^b\\^c"],
    ["x^a\u00a0b^ c", "x^a\u00a0b\\^ c"],
  ])("writes typed %j so that it reads back as typed", (typed, saved) => {
    const { editor, save } = openMarkdown("");
    editor.commands.setTextSelection(1);
    typeText(editor, typed);
    expect(save()).toBe(saved);
    expect(marksOf(saved)).toEqual([[typed, ""]]);
  });

  it("escapes a caret that follows other formatting", () => {
    const { editor, save } = openMarkdown("x ^b**c**\\^d end");
    expect(marksOf("x ^b**c**\\^d end")).toEqual([["x ^b", ""], ["c", "bold"], ["^d end", ""]]);
    typeAtEndOf(editor, "end", "!");
    expect(save()).toBe("x ^b**c**\\^d end!");
  });

  it("leaves a footnote reference unescaped", () => {
    const { editor, save } = openMarkdown("See[^1] x^2 end\n\n[^1]: Note.");
    typeAtEndOf(editor, "end", "!");
    expect(save()).toBe("See[^1] x^2 end!\n\n[^1]: Note.");
  });

  it.each([
    ["Use 2^10 bytes and word here.", "Use 2^10 bytes and word! here."],
    ["Use C^2 and (^3.29.0 and ^{N} and word.", "Use C^2 and (^3.29.0 and ^{N} and word!."],
    ["| a^2 | b |\n|---|---|\n| c | word |", "| a^2 | b |\n|---|---|\n| c | word! |"],
  ])("leaves a caret that cannot pair alone in %j", (source, saved) => {
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "word", "!");
    expect(save()).toBe(saved);
  });

  it.each([
    ["Area $x^2$ here", "Area $x^2$ here"],
    ["Area $x_{1} *y*$ and $a<b$ here", "Area $x_{1} *y*$ and $a<b$ here"],
    ["Cost $5 and x^2^ here", "Cost $5 and x^2\\^ here"],
  ])("writes math typed as plain text in %j as it was typed", (typed, saved) => {
    const { editor, save } = openMarkdown("");
    editor.view.dispatch(editor.state.tr.insertText(typed, 1));
    expect(save()).toBe(saved);
  });
});

describe("marks around inline math", () => {
  it.each([
    ["See [$x^2$](https://u.example) and word.", "See [$x^2$](https://u.example) and word!."],
    ["A **bold $x^2$** and word.", "A **bold $x^2$** and word!."],
    ["A *$x$* and ~~$y$~~ and word.", "A *$x$* and ~~$y$~~ and word!."],
    ["Sub ~$x$~ and word.", "Sub <sub>$x$</sub> and word!."],
    ["A [$x$]{.underline} and word.", "A <u>$x$</u> and word!."],
  ])("keeps the marks on the math in %j when the paragraph is edited", (source, saved) => {
    const { editor, save } = openMarkdown(source, { preservedInlineRanges: mathRanges(source) });
    typeAtEndOf(editor, "word", "!");
    expect(save()).toBe(saved);
  });

  it("keeps a link whose text is math when another word is made bold", () => {
    const source = "See [$x^2$](https://u.example) and word.";
    const { editor, save } = openMarkdown(source, { preservedInlineRanges: mathRanges(source) });
    const to = positionAfter(editor, "word");
    editor.chain().setTextSelection({ from: to - 4, to }).toggleBold().run();
    expect(save()).toBe("See [$x^2$](https://u.example) and **word**.");
  });
});

describe("reference labels with math", () => {
  it("resolves a reference whose label holds math, like Pandoc", () => {
    const source = "See [x][$a$ b] word.\n\nP2.\n\n[$a$ b]: https://a.b";
    const { editor, save } = openMarkdown(source, { preservedInlineRanges: mathRanges(source) });
    typeAtEndOf(editor, "word", "!");
    expect(save()).toBe("See [x](https://a.b) word!.\n\nP2.\n\n[$a$ b]: https://a.b");
  });
});

describe("Pandoc inline notes", () => {
  it.each([
    ["Text.^[A note] more and word.", "Text.^[A note] more and word!."],
    ["Text^[A [nested] note, `]` and $x^2$] and word.", "Text^[A [nested] note, `]` and $x^2$] and word!."],
    ["**Bold ^[note] run** and word.", "**Bold ^[note] run** and word!."],
    ["Two^[a\nb] lines and word.", "Two^[a\nb] lines and word!."],
    ["Note ^[a]^b^ and word.", "Note ^[a]<sup>b</sup> and word!."],
  ])("keeps the inline note in %j when the paragraph is edited", (source, saved) => {
    const { editor, save } = openMarkdown(source, { preservedInlineRanges: mathRanges(source) });
    typeAtEndOf(editor, "word", "!");
    expect(save()).toBe(saved);
  });

  it("reads an inline note as a footnote with its source", () => {
    const source = "Text.^[A *note* with $x$] more.";
    const nodes = parseMarkdownBody(source, { preservedInlineRanges: mathRanges(source) }).doc.content?.[0]?.content ?? [];
    expect(nodes.map((node) => [node.type, node.attrs?.source ?? node.text])).toEqual([
      ["text", "Text."],
      ["footnote", "A *note* with $x$"],
      ["text", " more."],
    ]);
  });

  it.each([
    ["x ^[a](https://e.com) y", [["x ^", ""], ["a", "link https://e.com"], [" y", ""]]],
    ["x ^[a]{.underline} y", [["x ^", ""], ["a", "underline"], [" y", ""]]],
    ["x ^[a][r] y", [["x ^[a][r] y", ""]]],
    ["x \\^[a] y", [["x ^[a] y", ""]]],
  ])("leaves %j to the link, span or text that Pandoc reads", (source, marks) => {
    expect(marksOf(source)).toEqual(marks);
  });
});
