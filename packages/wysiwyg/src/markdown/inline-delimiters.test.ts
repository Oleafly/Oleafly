// @vitest-environment jsdom
import type { Editor, JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { destroyOpenedEditors, mathRanges, openMarkdown, positionAfter, typeAtEndOf, typeText } from "../test-helpers";
import { parseMarkdownBody } from "./parse";

afterEach(destroyOpenedEditors);

const runsOf = (content: JSONContent[] | undefined) =>
  (content ?? []).map((node) => [node.text ?? node.type, (node.marks ?? []).map((mark) => mark.type).sort().join(", ")]);

const readBack = (saved: string) => runsOf(parseMarkdownBody(saved).doc.content?.[0]?.content);

function marked(source: string, word: string, mark: string): { editor: Editor; saved: string } {
  const { editor, save } = openMarkdown(source);
  const to = positionAfter(editor, word);
  editor.chain().setTextSelection({ from: to - word.length, to }).toggleMark(mark).run();
  return { editor, saved: save() };
}

describe("mark delimiters next to punctuation", () => {
  it.each([
    ["Use x^2 here.", "x^", "bold", "Use <strong>x^</strong>2 here."],
    ["Use x^2 here.", "x^", "italic", "Use <em>x^</em>2 here."],
    ["Use x^2 here.", "x^", "strike", "Use <del>x^</del>2 here."],
    ["Use x^2 here.", "^2", "bold", "Use x<strong>^2</strong> here."],
    ["Use a_b here.", "a_", "bold", "Use <strong>a\\_</strong>b here."],
    ["Use a_b here.", "_b", "bold", "Use a<strong>\\_b</strong> here."],
    ["Use x~2 here.", "x~", "bold", "Use <strong>x\\~</strong>2 here."],
    ["See [1]s here.", "[1]", "bold", "See <strong>\\[1\\]</strong>s here."],
    ["Use a*b here.", "a*", "bold", "Use <strong>a\\*</strong>b here."],
    ["Use a*b here.", "*b", "bold", "Use a<strong>\\*b</strong> here."],
    ["Use x😀y here.", "x😀", "bold", "Use <strong>x😀</strong>y here."],
  ])("writes tags rather than shrink a mark that ends at punctuation in %j (%s, %s)", (source, word, mark, saved) => {
    const { editor, saved: written } = marked(source, word, mark);
    expect(written).toBe(saved);
    expect(readBack(written)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });

  it.each([
    ["A **strong word**s end.", "word", "underline", "A <strong>strong <u>word</u></strong>s end."],
    ["A **strong word**s end.", "word", "highlight", "A <strong>strong <mark>word</mark></strong>s end."],
    ["Use a.b here.", ".", "bold", "Use a<strong>.</strong>b here."],
    ["If a&lt;b and c>d.", "a<", "bold", "If <strong>a<</strong>b and c>d."],
  ])("writes tags when a delimiter would have to enter other markup in %j (%s, %s)", (source, word, mark, saved) => {
    const { editor, saved: written } = marked(source, word, mark);
    expect(written).toBe(saved);
    expect(readBack(written)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });

  it("keeps a strike's delimiters whole when it closes together with bold", () => {
    const { editor, save } = openMarkdown("Plain **bold run** after.");
    editor.chain().setTextSelection({ from: positionAfter(editor, "bold "), to: positionAfter(editor, "aft") }).toggleStrike().run();
    typeText(editor, "X");
    const saved = save();
    expect(saved).toBe("Plain <strong>bold ~~X~~</strong>er.");
    expect(readBack(saved)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });
});

describe("mark delimiters next to atoms and other delimiters", () => {
  const withMath = (source: string) => ({ preservedInlineRanges: mathRanges(source) });
  const readMath = (saved: string) => runsOf(parseMarkdownBody(saved, withMath(saved)).doc.content?.[0]?.content);

  function markedRange(source: string, from: string, to: string, mark: string, math = false) {
    const { editor, save } = openMarkdown(source, math ? withMath(source) : {});
    const start = positionAfter(editor, from) - from.length;
    editor.chain().setTextSelection({ from: start, to: positionAfter(editor, to) }).toggleMark(mark).run();
    return { editor, saved: save() };
  }

  it("keeps a delimiter out of an inline note that follows a letter", () => {
    const { editor, save } = openMarkdown("Text^[A note] more words here.");
    let note = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "footnote") note = position;
    });
    editor.chain().setTextSelection({ from: note, to: positionAfter(editor, " more") }).toggleBold().run();
    const saved = save();
    expect(saved).not.toContain("^**[");
    expect(runsOf(parseMarkdownBody(saved).doc.content?.[0]?.content)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });

  it("keeps a delimiter out of a wiki embed that follows a letter", () => {
    const { saved } = markedRange("word![[embed]] next words", "![[embed]] next", "![[embed]] next", "bold");
    expect(saved).not.toContain("!**[[");
    expect(saved).toContain("![[embed]]");
  });

  it.each([
    ["Value $x$(see) here", "(see)", "(see)", "bold"],
    ["A word.$x$ end", "word.", "word.", "bold"],
    ["A $x$, then", ",", ",", "strike"],
  ])("writes marks next to math in %j that read back as marks", (source, from, to, mark) => {
    const { editor, saved } = markedRange(source, from, to, mark, true);
    expect(saved).not.toMatch(/\$\*\*\(|\.\*\*\$|\$~~,/u);
    const marked = readMath(saved).filter(([, marks]) => marks !== "");
    expect(marked.length).toBeGreaterThan(0);
    expect(readMath(saved).map(([text]) => text).join("")).toBe(runsOf(editor.getJSON().content?.[0]?.content).map(([text]) => text).join(""));
  });

  it("keeps valid delimiters around math right before a letter", () => {
    const source = "**$m$**x and **$y$**, and *$z$*s here";
    const { editor, save } = openMarkdown(source, withMath(source));
    typeAtEndOf(editor, "here", "!");
    expect(save()).toBe(`${source}!`);
  });

  it("writes overlapping italic and bold so both read back", () => {
    const { editor, save } = openMarkdown("The quick fox");
    editor.chain().setTextSelection({ from: 1, to: positionAfter(editor, "The qu") }).toggleItalic().run();
    editor.chain().setTextSelection({ from: positionAfter(editor, "The "), to: positionAfter(editor, "ick") }).toggleBold().run();
    const saved = save();
    expect(saved).not.toContain("*****");
    expect(readBack(saved)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });
});

describe("marks keep their exact range", () => {
  it.each([
    ["GPU<em>.</em>", "GPU<em>.!</em>"],
    ["<em>x.</em>y and z", "<em>x.</em>y and z!"],
    ["~~a **b** c~~ end", "~~a **b** c~~ end!"],
    ["***a** b* end", "***a** b* end!"],
  ])("writes %j back with only the typed text added", (source, saved) => {
    const { editor, save } = openMarkdown(source);
    editor.view.dispatch(editor.state.tr.insertText("!", editor.state.doc.firstChild ? editor.state.doc.firstChild.nodeSize - 1 : 1));
    expect(save()).toBe(saved);
    expect(readBack(saved)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });
});

describe("delimiters and Pandoc's smart quotes", () => {
  it("writes tags for italic that holds only the opening quote", () => {
    const source = 'He said "It\'s done," and left';
    const { editor, save } = openMarkdown(source);
    const to = positionAfter(editor, "It's");
    editor.chain().setTextSelection({ from: to - 5, to }).toggleItalic().run();
    const saved = save();
    expect(saved).toBe('He said <em>"It\'s</em> done," and left');
    expect(readBack(saved)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });

  it("writes tags for a strike that ends between a pair of quotes", () => {
    const { editor, save } = openMarkdown('between "fast" end');
    editor.chain().setTextSelection({ from: positionAfter(editor, "betwee"), to: positionAfter(editor, '"fa') }).toggleStrike().run();
    editor.chain().setTextSelection({ from: positionAfter(editor, '"'), to: positionAfter(editor, "st") }).toggleBold().run();
    const saved = save();
    expect(saved).not.toMatch(/~~[^~]*"~~/u);
    expect(saved).toContain("<del>");
    expect(readBack(saved)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });

  it("keeps delimiters around a whole quotation or an apostrophe", () => {
    const { editor, save } = openMarkdown('Say "fast" and don\'t stop');
    editor.chain().setTextSelection({ from: positionAfter(editor, "Say "), to: positionAfter(editor, 'fast"') }).toggleBold().run();
    editor.chain().setTextSelection({ from: positionAfter(editor, "and "), to: positionAfter(editor, "don't") }).toggleItalic().run();
    expect(save()).toBe('Say **"fast"** and *don\'t* stop');
  });
});
