// @vitest-environment jsdom

import { closeBrackets } from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  WYSIWYG_EXTENSIONS,
  createMarkdownSourceSnapshot,
  parseMarkdownBody,
  serializeMarkdownBody,
} from "@oleafly/wysiwyg";
import { afterEach, describe, expect, it } from "vitest";
import { markdownFormatKeymap } from "./markdown-keymap";
import { type MarkdownTarget, modelEdit, modelState, RESTING_STATE, sourceTarget, visualStateOf, visualTarget } from "./markdown-model";

type Pick = { word: string } | { caret: string } | { before: string } | { range: [string, string] } | { end: true };
type Act = (target: MarkdownTarget) => void;

const opened: { destroy: () => void }[] = [];

afterEach(() => {
  for (const item of opened.splice(0)) item.destroy();
});

function textRange(source: string, pick: Pick): { from: number; to: number } {
  if ("end" in pick) return { from: source.trimEnd().length, to: source.trimEnd().length };
  if ("word" in pick) {
    const from = source.indexOf(pick.word);
    return { from, to: from + pick.word.length };
  }
  if ("caret" in pick) {
    const at = source.indexOf(pick.caret) + pick.caret.length;
    return { from: at, to: at };
  }
  if ("before" in pick) {
    const at = source.indexOf(pick.before);
    return { from: at, to: at };
  }
  const from = source.indexOf(pick.range[0]);
  const end = source.indexOf(pick.range[1]) + pick.range[1].length;
  return { from, to: end };
}

function docPosition(editor: Editor, needle: string, after: boolean): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText || !node.text) return found < 0;
    const index = node.text.indexOf(needle);
    if (index >= 0) found = pos + index + (after ? needle.length : 0);
    return false;
  });
  if (found < 0) throw new Error(`no ${needle}`);
  return found;
}

function visualEditor(source: string, pick: Pick) {
  const { doc, frontmatter, layout } = parseMarkdownBody(source);
  const editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: doc });
  opened.push(editor);
  const snapshot = createMarkdownSourceSnapshot(layout, editor.getJSON());
  const set = (from: number, to: number) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  if ("end" in pick) set(editor.state.doc.content.size - 1, editor.state.doc.content.size - 1);
  else if ("word" in pick) {
    const from = docPosition(editor, pick.word, false);
    set(from, from + pick.word.length);
  } else if ("caret" in pick) set(docPosition(editor, pick.caret, true), docPosition(editor, pick.caret, true));
  else if ("before" in pick) set(docPosition(editor, pick.before, false), docPosition(editor, pick.before, false));
  else set(docPosition(editor, pick.range[0], false), docPosition(editor, pick.range[1], true));
  return { editor, save: () => frontmatter + serializeMarkdownBody(editor.getJSON(), snapshot) };
}

function visualSave(source: string, pick: Pick, act: Act, typed?: string): string {
  const { editor, save } = visualEditor(source, pick);
  act(visualTarget(editor));
  if (typed !== undefined) editor.view.dispatch(editor.state.tr.insertText(typed));
  return save();
}

function codeView(source: string, pick: Pick, extensions: Extension[] = []) {
  const { from, to } = textRange(source, pick);
  const view = new EditorView({
    state: EditorState.create({ doc: source, selection: { anchor: from, head: to }, extensions }),
    parent: document.body,
  });
  opened.push(view);
  return view;
}

function codeSave(source: string, pick: Pick, act: Act, typed?: string): string {
  const view = codeView(source, pick);
  act(sourceTarget(() => view));
  if (typed !== undefined) view.dispatch(view.state.replaceSelection(typed));
  return view.state.doc.toString();
}

const SOURCE = "Intro text here.\n\nSecond para word end.\n";
const TWO = "First para tail.\n\nSecond para head.\n";
const LIST = "- one\n- two\n- three\n";
const SPAN = 'A <span data-text-color="red!85!black" style="color: rgb(217, 0, 0);">bravo</span> b.\n';

const CASES: [string, string, Pick, Act][] = [
  ["bold", SOURCE, { word: "word" }, (target) => target.bold()],
  ["bold off", "A **word** b.\n", { word: "word" }, (target) => target.bold()],
  ["italic", SOURCE, { word: "word" }, (target) => target.italic()],
  ["italic off", "A *word* b.\n", { word: "word" }, (target) => target.italic()],
  ["strikethrough", SOURCE, { word: "word" }, (target) => target.strike()],
  ["inline code", SOURCE, { word: "word" }, (target) => target.code()],
  ["underline", SOURCE, { word: "word" }, (target) => target.underline()],
  ["highlight", SOURCE, { word: "word" }, (target) => target.highlight()],
  ["superscript", SOURCE, { word: "word" }, (target) => target.superscript()],
  ["subscript", SOURCE, { word: "word" }, (target) => target.subscript()],
  ["superscript off", "x<sup>2</sup> y\n", { word: "2" }, (target) => target.superscript()],
  ["text colour", SOURCE, { word: "word" }, (target) => target.color("red!85!black")],
  ["bold across two paragraphs", TWO, { range: ["tail.", "Second"] }, (target) => target.bold()],
  ["italic across two paragraphs", TWO, { range: ["tail.", "Second"] }, (target) => target.italic()],
  ["code across two paragraphs", TWO, { range: ["tail.", "Second"] }, (target) => target.code()],
  ["highlight across two paragraphs", TWO, { range: ["tail.", "Second"] }, (target) => target.highlight()],
  ["colour across two paragraphs", TWO, { range: ["tail.", "Second"] }, (target) => target.color("teal")],
  ["bold with a trailing space", "Alpha bravo charlie.\n", { word: "bravo " }, (target) => target.bold()],
  ["strike with a trailing space", "Alpha bravo charlie.\n", { word: "bravo " }, (target) => target.strike()],
  ["italic overlapping bold", "Plain **bold run** after.\n", { range: ["run", "aft"] }, (target) => target.italic()],
  ["strike overlapping bold", "Plain **bold run** after.\n", { range: ["run", "aft"] }, (target) => target.strike()],
  ["code overlapping bold", "Plain **bold run** after.\n", { range: ["run", "aft"] }, (target) => target.code()],
  ["code over a backtick", "Use a`b here.\n", { word: "a`b" }, (target) => target.code()],
  ["underline off inside a run", "A <u>bravo</u> b.\n", { word: "rav" }, (target) => target.underline()],
  ["highlight off inside a run", "A <mark>bravo</mark> b.\n", { word: "rav" }, (target) => target.highlight()],
  ["superscript off inside a run", "A <sup>bravo</sup> b.\n", { word: "rav" }, (target) => target.superscript()],
  ["recolour inside a span", SPAN, { word: "rav" }, (target) => target.color("teal")],
  ["recolour a mixed selection", SPAN, { range: ["ravo", "b."] }, (target) => target.color("teal")],
  ["bold off at the run start", "A **bravo** b.\n", { word: "bra" }, (target) => target.bold()],
  ["bold off at the run end", "A **bravo** b.\n", { word: "avo" }, (target) => target.bold()],
  ["italic off at the run start", "A *bravo* b.\n", { word: "bra" }, (target) => target.italic()],
  ["strike off at the run start", "A ~~bravo~~ b.\n", { word: "bra" }, (target) => target.strike()],
  ["code off at the run start", "A `bravo` b.\n", { word: "bra" }, (target) => target.code()],
  ["underline off at the run start", "A <u>bravo</u> b.\n", { word: "bra" }, (target) => target.underline()],
  ["underscore italic off", "A _bravo_ b.\n", { word: "bravo" }, (target) => target.italic()],
  ["underscore bold off", "A __bravo__ b.\n", { word: "bravo" }, (target) => target.bold()],
  ["bold at a bare caret", "Alpha bravo charlie.\n", { caret: "bra" }, (target) => target.bold()],
  ["italic inside a snake_case word", "snake_case_name ok\n", { word: "case" }, (target) => target.italic()],
  ["heading 2", SOURCE, { caret: "Second" }, (target) => target.heading(2)],
  ["heading 2 to 3", "## Title\n\nx\n", { caret: "Tit" }, (target) => target.heading(3)],
  ["heading 2 off", "## Title\n\nx\n", { caret: "Tit" }, (target) => target.heading(2)],
  ["heading 6", SOURCE, { caret: "Intro" }, (target) => target.heading(6)],
  ["heading on a list item", LIST, { caret: "tw" }, (target) => target.heading(2)],
  ["heading on a quoted line", "> quoted line\n", { caret: "quo" }, (target) => target.heading(2)],
  ["heading over two paragraphs", TWO, { range: ["First", "head."] }, (target) => target.heading(2)],
  ["heading on a soft-wrapped line", "line one\nline two\n", { caret: "line t" }, (target) => target.heading(2)],
  ["bullet list", SOURCE, { caret: "Second" }, (target) => target.bullet()],
  ["bullet list off", "- item\n\nx\n", { caret: "ite" }, (target) => target.bullet()],
  ["numbered list", SOURCE, { caret: "Second" }, (target) => target.ordered()],
  ["bullet to numbered", "- item\n\nx\n", { caret: "ite" }, (target) => target.ordered()],
  ["bullet over three paragraphs", "Pa one.\n\nPb two.\n\nPc three.\n", { range: ["Pa", "three."] }, (target) => target.bullet()],
  ["numbered over three paragraphs", "Pa one.\n\nPb two.\n\nPc three.\n", { range: ["Pa", "three."] }, (target) => target.ordered()],
  ["bullet on a heading", "## Head\n", { caret: "He" }, (target) => target.bullet()],
  ["numbered on a heading", "## Head\n", { caret: "He" }, (target) => target.ordered()],
  ["bullet off one item", LIST, { caret: "tw" }, (target) => target.bullet()],
  ["clear one list item", LIST, { caret: "tw" }, (target) => target.clear()],
  ["bullet on a quoted line", "> quoted line\n", { caret: "quo" }, (target) => target.bullet()],
  ["quote on a list item", LIST, { caret: "tw" }, (target) => target.quote()],
  ["quote", SOURCE, { caret: "Second" }, (target) => target.quote()],
  ["quote off", "> said\n\nx\n", { caret: "sa" }, (target) => target.quote()],
  ["quote over two paragraphs", "Pa one.\n\nPb two.\n", { range: ["Pa", "two."] }, (target) => target.quote()],
  ["quote off over two paragraphs", "> Pa one.\n>\n> Pb two.\n", { range: ["Pa", "two."] }, (target) => target.quote()],
  ["align center", SOURCE, { caret: "Second" }, (target) => target.align("center")],
  ["align right on a centred block", "::: {.center}\nMid\n:::\n\nx\n", { caret: "Mi" }, (target) => target.align("right")],
  ["align left removes the block", "::: {.center}\nMid\n:::\n\nx\n", { caret: "Mi" }, (target) => target.align("left")],
  ["align justify a heading", "## Head\n\nx\n", { caret: "He" }, (target) => target.align("justify")],
  ["align a list item", LIST, { caret: "tw" }, (target) => target.align("center")],
  ["align a quoted line", "> quoted line\n", { caret: "quo" }, (target) => target.align("center")],
  ["align two paragraphs", TWO, { range: ["First", "head."] }, (target) => target.align("center")],
  ["clear formatting", "## **Bold** and *it*\n\nx\n", { range: ["Bold", "it"] }, (target) => target.clear()],
  ["clear part of a line", "## **Bold** and [link](https://a.b) end\n", { range: ["old", "lin"] }, (target) => target.clear()],
  ["clear inside an underline", "A <u>bravo</u> b.\n", { word: "rav" }, (target) => target.clear()],
  ["link on a word", SOURCE, { word: "word" }, (target) => target.link("https://a.b")],
  ["link at the caret", SOURCE, { caret: "word" }, (target) => target.link("https://a.b")],
  ["link text with a bracket", "see a]b here.\n", { word: "a]b" }, (target) => target.link("https://a.b")],
  ["link to a URL with a space", "Alpha bravo charlie.\n", { word: "bravo" }, (target) => target.link("https://a.b/x y")],
  ["link to a URL with an open paren", "Alpha bravo charlie.\n", { word: "bravo" }, (target) => target.link("https://a.b/x(y")],
  ["link to a path with a space", "Alpha bravo charlie.\n", { word: "bravo" }, (target) => target.link("docs/my file.md")],
  ["unlink", "A [word](https://a.b) b.\n", { caret: "wo" }, (target) => target.unlink()],
  ["unlink a URL with parens", "A [word](https://en.wikipedia.org/wiki/Foo_(bar)) b.\n", { caret: "wo" }, (target) => target.unlink()],
  ["image at the end", "Intro\n\n", { end: true }, (target) => target.image("fig/a.png")],
  ["image inside a paragraph", SOURCE, { caret: "Second" }, (target) => target.image("fig/a.png")],
  ["image with a space and parens", "Intro\n\n", { end: true }, (target) => target.image("fig/a (1).png")],
  ["table", SOURCE, { caret: "end." }, (target) => target.table()],
  ["table in the middle of a paragraph", "Alpha bravo charlie.\n", { caret: "bra" }, (target) => target.table()],
  ["emoji", SOURCE, { caret: "word" }, (target) => target.emoji("🎉")],
  ["bullet inside a code block", "```\ncode line\n```\n", { caret: "code l" }, (target) => target.bullet()],
  ["heading inside a code block", "```\ncode line\n```\n", { caret: "code l" }, (target) => target.heading(2)],
  ["bold inside a code block", "```\ncode line\n```\n", { word: "code" }, (target) => target.bold()],
  ["underline off on Pandoc syntax", "A [bravo]{.underline} b.\n", { word: "bravo" }, (target) => target.underline()],
  ["highlight off on Pandoc syntax", "A [bravo]{.mark} b.\n", { word: "bravo" }, (target) => target.highlight()],
  ["superscript off on Pandoc syntax", "A x^2^ b.\n", { word: "2" }, (target) => target.superscript()],
  ["subscript off on Pandoc syntax", "A H~2~O b.\n", { word: "2" }, (target) => target.subscript()],
  ["bold far from a reference link", "A [x][r] word b.\n\nMiddle.\n\nMore.\n\n[r]: https://a.b\n", { word: "word" }, (target) => target.bold()],
];

describe("Markdown toolbar actions in Code mode", () => {
  it.each(CASES)("writes what Visual saves for %s", (_name, source, pick, act) => {
    expect(codeSave(source, pick, act)).toBe(visualSave(source, pick, act));
  });

  const CARETS: [string, string, Pick, Act][] = [
    ["bullet", "Intro\n\nSecond line\n", { caret: "Sec" }, (target) => target.bullet()],
    ["numbered", "Intro\n\nSecond line\n", { caret: "Sec" }, (target) => target.ordered()],
    ["quote", "Intro\n\nSecond line\n", { caret: "Sec" }, (target) => target.quote()],
    ["clear on a heading", "Intro\n\n## Second line\n", { caret: "Sec" }, (target) => target.clear()],
    ["heading at the line start", "Intro\n\nSecond line\n", { before: "Second" }, (target) => target.heading(2)],
    ["center at the block start", "Intro\n\nSecond line\n", { before: "Second" }, (target) => target.align("center")],
    ["link at a bare caret", "Intro\n\nSecond line\n", { caret: "line" }, (target) => target.link("https://a.b")],
    ["table", "Intro\n\nSecond line\n", { caret: "line" }, (target) => target.table()],
    ["bullet over a selection", "Alpha bravo charlie.\n", { word: "bravo" }, (target) => target.bullet()],
    ["quote over a selection", "Alpha bravo charlie.\n", { word: "bravo" }, (target) => target.quote()],
    ["clear over a selection", "## Second line\n", { word: "Second" }, (target) => target.clear()],
    ["unlink over a selection", "A [word](https://a.b) b.\n", { word: "word" }, (target) => target.unlink()],
    ["bold over a selection", "Alpha bravo charlie.\n", { word: "bravo" }, (target) => target.bold()],
  ];

  it.each(CARETS)("puts what you type next where Visual does after %s", (_name, source, pick, act) => {
    expect(codeSave(source, pick, act, "X")).toBe(visualSave(source, pick, act, "X"));
  });

  it.each([
    ["underline", "A [bravo]{.underline} b.\n", "bravo", (target: MarkdownTarget) => target.underline()],
    ["highlight", "A [bravo]{.mark} b.\n", "bravo", (target: MarkdownTarget) => target.highlight()],
    ["superscript", "A x^2^ b.\n", "2", (target: MarkdownTarget) => target.superscript()],
    ["subscript", "A H~2~O b.\n", "2", (target: MarkdownTarget) => target.subscript()],
  ] as const)("takes %s off text written in Pandoc's own syntax by older files", (_name, source, word, act) => {
    expect(codeSave(source, { word }, act).replace(/\s+/gu, " ")).toBe(source.replace(/\[bravo\]\{\.\w+\}|\^2\^|~2~/u, word === "2" ? "2" : "bravo").replace(/\s+/gu, " "));
  });

  it("undoes one action with one undo and gives the selection back", () => {
    const view = codeView("Alpha bravo charlie.\n\nNext.\n", { word: "bravo" }, [history()]);
    const target = sourceTarget(() => view);
    target.italic();
    target.bold();
    expect(view.state.doc.toString()).toBe("Alpha ***bravo*** charlie.\n\nNext.\n");
    undo(view);
    expect(view.state.doc.toString()).toBe("Alpha *bravo* charlie.\n\nNext.\n");
    undo(view);
    expect(view.state.doc.toString()).toBe("Alpha bravo charlie.\n\nNext.\n");
    expect(view.state.selection.main).toMatchObject({ from: 6, to: 11 });
  });

  it("selects an inserted image the way Visual does, so typing replaces it", () => {
    const act = (target: MarkdownTarget) => target.image("a.png");
    expect(codeSave("Intro\n\nSecond line\n", { caret: "line" }, act, "X")).toBe(visualSave("Intro\n\nSecond line\n", { caret: "line" }, act, "X"));
  });

  it("keeps other cursors when formatting the main one", () => {
    const view = codeView("one two three\n", { word: "two" }, [EditorState.allowMultipleSelections.of(true)]);
    view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.range(4, 7)], 1) });
    sourceTarget(() => view).bold();
    expect(view.state.doc.toString()).toBe("one **two** three\n");
    expect(view.state.selection.ranges).toHaveLength(2);
  });

  it("does nothing to a read-only file", () => {
    const view = codeView(SOURCE, { word: "word" }, [EditorState.readOnly.of(true)]);
    sourceTarget(() => view).bold();
    expect(view.state.doc.toString()).toBe(SOURCE);
  });

  it("treats a caret on the blank line between paragraphs as the end of the paragraph above", () => {
    const source = "Para one.\n\nPara two.\n";
    const view = codeView(source, { caret: "one.\n" });
    sourceTarget(() => view).bullet();
    expect(view.state.doc.toString()).toBe("- Para one.\n\nPara two.\n");
  });

  it("reads an autolink's address when the caret is inside it", () => {
    const view = codeView("Alpha <https://zqz.example> beta.\n", { caret: "zq" });
    expect(sourceTarget(() => view).linkHref()).toBe("https://zqz.example");
  });

  it("reads the link under the caret, parentheses and all", () => {
    const view = codeView("A [word](https://en.wikipedia.org/wiki/Foo_(bar)) b.\n", { caret: "wo" });
    expect(sourceTarget(() => view).linkHref()).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });
});

const FAR_DEFINITION = "\n\nMore.\n\nEnd.\n\n[a]: https://a.b\n";
const LONG_URL = "https://example.com/a/very/long/path/to/the/documentation/page.html";

const SAFE_CASES: [string, string, Pick, Act][] = [
    ["bold before a heading", `Para one word.\n\n## Next\n\nMore text.${FAR_DEFINITION}`, { word: "word" }, (target) => target.bold()],
    ["bold before a list", `Intro.\n\nPara one word.\n\n- item\n- item2${FAR_DEFINITION}`, { word: "word" }, (target) => target.bold()],
    ["italic before a fence", `Para word here.\n\n\`\`\`\ncode\n\`\`\`${FAR_DEFINITION}`, { word: "word" }, (target) => target.italic()],
    ["link before a heading", "[a]: https://a.b\n\nX.\n\nY.\n\nSee word now.\n\n## Usage\n", { word: "word" }, (target) => target.link("https://c.d")],
    ["bullet before a quote", `P.\n\nQ word.\n\n> quoted${FAR_DEFINITION}`, { caret: "Q w" }, (target) => target.bullet()],
    ["heading after a heading", "# Paper\n\nIntro with a [ref][k] and more.\n\n- point one\n\n[k]: https://k.example\n", { caret: "with a " }, (target) => target.heading(2)],
    [
      "bold in a README",
      "# Tool\n\nInstall it with the [installer][inst] and read the [guide][g].\n\n## Use\n\nRun it.\n\n[inst]: https://i.example\n[g]: https://g.example\n",
      { word: "Install" },
      (target) => target.bold(),
    ],
    ["bold between two rules", "Intro.\n\n---\n\nBetween rules.\n\n---\n\nBelow.\n", { word: "rules" }, (target) => target.bold()],
    ["heading between two rules", "Intro.\n\n---\n\nBetween rules.\n\n---\n\nBelow.\n", { caret: "Betw" }, (target) => target.heading(2)],
    ["bullet between two rules", "Intro.\n\n---\n\nBetween rules.\n\n---\n\nBelow.\n", { caret: "Betw" }, (target) => target.bullet()],
    ["bold on a setext heading after a rule", "Intro.\n\n---\n\nTitle\n---\n\nBody word.\n", { word: "Title" }, (target) => target.bold()],
    ["bold after a rule with a dots line below", "Intro.\n\n---\n\nBetween word.\n\nA line\n...\n", { word: "word" }, (target) => target.bold()],
    ["bold across blocks between rules", "Intro.\n\n---\n\nAlpha one.\n\nBeta two.\n\n---\n\nEnd.\n", { range: ["one", "Beta"] }, (target) => target.bold()],
    ["bold on a slide between breaks", "## Slide one\n\n---\n\nPoint word.\n\n---\n\n## Slide two\n", { word: "word" }, (target) => target.bold()],
    ["bold with a duplicate label", "[a]: https://first.example\n\nX1.\n\nX2.\n\nSee [x][a] word.\n\n[a]: https://second.example\n", { word: "word" }, (target) => target.bold()],
    ["bold with a definition in a quote", "A [x][r] word.\n\nB.\n\nC.\n\n> [r]: https://a.b\n", { word: "word" }, (target) => target.bold()],
    ["bold with a definition in a list", "A [x][r] word.\n\nB.\n\nC.\n\n- [r]: https://a.b\n", { word: "word" }, (target) => target.bold()],
    ["bold with an escaped label", "A [x][a\\]b] word.\n\nB.\n\nC.\n\n[a\\]b]: https://a.b\n", { word: "word" }, (target) => target.bold()],
    ["bold next to a private-use character", "Icon  here and word.\n\nNext.\n", { word: "word" }, (target) => target.bold()],
    ["bullet next to a private-use character", "Icon  here and word.\n\nNext.\n", { caret: "wo" }, (target) => target.bullet()],
    ["link inside an autolink", "Alpha <https://zqz.example> beta.\n", { caret: "zqz" }, (target) => target.link("https://other.example")],
    ["bold inside an autolink", "Alpha <https://zqz.example> beta.\n", { word: "zqz" }, (target) => target.bold()],
    ["italic on a word and space before an underscore run", "1. zahq _zaiq_\n2. zajq\n", { word: "zahq " }, (target) => target.italic()],
];

describe("Markdown toolbar actions only touch the text you picked", () => {
  it.each(SAFE_CASES)("writes what Visual saves for %s", (_name, source, pick, act) => {
    expect(codeSave(source, pick, act)).toBe(visualSave(source, pick, act));
  });

  it.each([
    ["H2", (target: MarkdownTarget) => target.heading(2)],
    ["Bullet", (target: MarkdownTarget) => target.bullet()],
    ["Quote", (target: MarkdownTarget) => target.quote()],
    ["Center", (target: MarkdownTarget) => target.align("center")],
    ["Unlink", (target: MarkdownTarget) => target.unlink()],
  ] as const)("acts on the link's own paragraph for %s with the caret deep in its URL", (_name, act) => {
    const source = `First para.\n\nRead [the docs](${LONG_URL}) now.\n\nLast para.\n`;
    expect(codeSave(source, { caret: "path/to" }, act)).toBe(visualSave(source, { caret: "the docs" }, act));
  });

  it("acts on a list item whose URL holds the caret, not on the end of the file", () => {
    const source = `Para.\n\n- item [x](${LONG_URL}) end\n`;
    expect(codeSave(source, { caret: "path/to/the" }, (target) => target.heading(2))).toBe(
      visualSave(source, { before: " end" }, (target) => target.heading(2)),
    );
  });

  it.each([
    ["a span's colour attribute", `First para.\n\n${SPAN}\nLast para.\n`, 'data-text-color="re'],
    ["a span's style attribute", `First para.\n\n${SPAN}\nLast para.\n`, 'style="color: rgb(2'],
    ["display math", "First para.\n\n$$\nx + y = z + w + v + u\n$$\n\nAfter para.\n", "x + y = z"],
    ["front matter", "---\ntitle: T\n---\n\nFirst word para.\n\nSecond.\n", "tit"],
    ["a reference definition", "Para one.\n\n[d]: https://a.b/definition/target\n\nPara two.\n", "https://a.b/def"],
  ])("changes no other block when the caret sits in %s", (_name, source, caret) => {
    for (const act of [(target: MarkdownTarget) => target.heading(2), (target: MarkdownTarget) => target.bullet(), (target: MarkdownTarget) => target.table()]) {
      const after = codeSave(source, { caret }, act);
      const at = source.indexOf(caret);
      const blockFrom = source.lastIndexOf("\n\n", at) + 2;
      const blockTo = source.indexOf("\n\n", at);
      let prefix = 0;
      while (prefix < source.length && source[prefix] === after[prefix]) prefix += 1;
      let suffix = 0;
      while (suffix < source.length - prefix && source.at(-1 - suffix) === after.at(-1 - suffix)) suffix += 1;
      if (after !== source) {
        expect(prefix).toBeGreaterThanOrEqual(blockFrom);
        expect(source.length - suffix).toBeLessThanOrEqual(blockTo + 2);
      }
    }
  });

  it.each([
    ["a table", (target: MarkdownTarget) => target.table()],
    ["a heading", (target: MarkdownTarget) => target.heading(1)],
    ["an emoji", (target: MarkdownTarget) => target.emoji("🎉")],
    ["an image", (target: MarkdownTarget) => target.image("a.png")],
  ] as const)("adds %s to a file that has only front matter", (_name, act) => {
    const body = visualSave("", { end: true }, act);
    for (const source of ["---\ntitle: T\n---\n\n", "---\ntitle: T\n---\n"]) {
      const view = codeView(source, { end: true });
      view.dispatch({ selection: { anchor: source.length } });
      act(sourceTarget(() => view));
      expect(view.state.doc.toString()).toBe(`---\ntitle: T\n---\n\n${body}`);
    }
  });

  it.each([
    ["Bold on the word", { word: "comment" }, (target: MarkdownTarget) => target.bold()],
    ["Center on the paragraph", { caret: "Alpha" }, (target: MarkdownTarget) => target.align("center")],
    ["Italic over the sentence", { range: ["Alpha", "beta."] as [string, string] }, (target: MarkdownTarget) => target.italic()],
  ] as const)("keeps a comment anchored on part of a word after %s", (_name, pick, act) => {
    const source = "Alpha comment word beta.\n\nNext.\n";
    const view = codeView(source, pick);
    let anchor = { from: 8, to: 12 };
    const original = view.dispatch.bind(view);
    view.dispatch = ((...specs: Parameters<EditorView["dispatch"]>) => {
      const [spec] = specs;
      if (spec && "changes" in spec && spec.changes) {
        const set = view.state.changes(spec.changes);
        anchor = { from: set.mapPos(anchor.from, 1), to: set.mapPos(anchor.to, -1) };
      }
      original(...specs);
    }) as EditorView["dispatch"];
    act(sourceTarget(() => view));
    expect(view.state.doc.sliceString(anchor.from, anchor.to)).toBe("mmen");
  });

  it("never splits an emoji in two when it inserts one next to another", () => {
    const view = codeView("🎉 Party\n", { before: "🎉" });
    const inserted: string[] = [];
    const bounds: number[] = [];
    const original = view.dispatch.bind(view);
    view.dispatch = ((...specs: Parameters<EditorView["dispatch"]>) => {
      const [spec] = specs;
      if (spec && "changes" in spec && spec.changes && !("startState" in spec)) {
        const set = view.state.changes(spec.changes);
        set.iterChanges((fromA, toA, _fromB, _toB, text) => {
          bounds.push(fromA, toA);
          inserted.push(text.toString());
        });
      }
      original(...specs);
    }) as EditorView["dispatch"];
    sourceTarget(() => view).emoji("🎊");
    expect(view.state.doc.toString()).toBe("🎊🎉 Party\n");
    for (const text of inserted) expect(text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    for (const at of bounds) expect("🎉 Party\n".charCodeAt(at)).not.toBeGreaterThanOrEqual(0xdc00);
  });
});

function codeTyped(source: string, pick: Pick, act: Act, typed: string): string {
  const view = codeView(source, pick, [markdownFormatKeymap]);
  act(sourceTarget(() => view));
  view.dispatch({ ...view.state.replaceSelection(typed), userEvent: typed ? "input.type" : "delete.backward" });
  return view.state.doc.toString();
}

function visualDeleted(source: string, pick: Pick, act: Act): string {
  const { editor, save } = visualEditor(source, pick);
  act(visualTarget(editor));
  editor.view.dispatch(editor.state.tr.deleteSelection());
  return save();
}

describe("Markdown toolbar actions stay inside the caret's block and never throw", () => {
  const README = "# Tool\n\nInstall it with the [installer][inst].\n\n[inst]: https://i.example\n[g]: https://g.example\n";
  const DEFINITION = "Para [x][r] word.\n\n[r]: https://a.example\n";
  const CENTRED = "Intro para.\n\n::: {.center}\n## Title here\n:::\n\nAfter para.\n";
  const ACTIONS: Act[] = [(target) => target.heading(2), (target) => target.align("center"), (target) => target.bold(), (target) => target.table()];

  it.each([
    ["a reference definition line", DEFINITION, DEFINITION.indexOf("[r]:"), DEFINITION.length],
    ["a README's definitions", README, README.indexOf("[inst]:"), README.length],
    ["a closing fence after Center", CENTRED, CENTRED.lastIndexOf(":::"), CENTRED.lastIndexOf(":::") + 3],
  ])("reads the state and runs every action at each caret in %s without throwing", (_name, source, from, to) => {
    for (let at = from; at <= to; at += 1) {
      const state = EditorState.create({ doc: source, selection: { anchor: at } });
      expect(() => modelState(state)).not.toThrow();
      for (const act of ACTIONS) expect(() => modelEdit(state, act)).not.toThrow();
    }
  });

  it("lights nothing and does nothing at a caret it can't place, even if the engine throws", () => {
    const state = EditorState.create({ doc: DEFINITION, selection: { anchor: DEFINITION.indexOf("[r]:") + 1 } });
    expect(modelState(state)).toEqual(RESTING_STATE);
    expect(modelEdit(state, (target) => target.heading(2))).toBeNull();
  });

  const BLOCKS = "Intro para.\n\n## Title here\n\nAfter para.\n";
  it.each([
    ["column 0 of a heading", BLOCKS, BLOCKS.indexOf("## Title"), "Title"],
    ["column 0 of a list item", "- item one\n- item two\n", "- item one\n".length, "item two"],
    ["column 0 of a numbered item", "1. first\n2. second\n", "1. first\n".length, "second"],
    ["column 0 of a heading under a heading", "# Top heading\n\n## Title here\n", "# Top heading\n\n".length, "Title"],
  ])("acts on the caret's own block at %s", (_name, source, at, word) => {
    for (const act of [(target: MarkdownTarget) => target.heading(2), (target: MarkdownTarget) => target.bullet(), (target: MarkdownTarget) => target.quote()]) {
      const view = codeView(source, { before: "" });
      view.dispatch({ selection: { anchor: at } });
      act(sourceTarget(() => view));
      expect(view.state.doc.toString()).toBe(visualSave(source, { before: word }, act));
    }
  });

  it.each([
    ["a closing ::: fence", CENTRED, CENTRED.lastIndexOf(":::") + 3, "Title here", true],
    ["a closing code fence", "Intro para.\n\n```\ncode here\n```\n\nAfter para.\n", "Intro para.\n\n```\ncode here\n```".length, "code here", true],
    ["a rule", "Intro para.\n\n---\n\nAfter para.\n", "Intro para.\n\n---".length, null, false],
    ["a setext underline", "Intro para.\n\nTitle\n------------\n\nAfter para.\n", "Intro para.\n\nTitle\n------------".length, "Title", true],
    ["the closing --- of front matter", "---\ntitle: T\n---\n\nFirst word para.\n\nSecond.\n", "---\ntitle: T\n---".length, null, false],
  ])("never edits the next block from the end of %s", (_name, source, at, word, acts) => {
    for (const act of [(target: MarkdownTarget) => target.heading(2), (target: MarkdownTarget) => target.align("center"), (target: MarkdownTarget) => target.table()]) {
      const view = codeView(source, { before: "" });
      view.dispatch({ selection: { anchor: at } });
      act(sourceTarget(() => view));
      const after = view.state.doc.toString();
      if (!acts) expect(after).toBe(source);
      else {
        expect(after.endsWith(source.slice(source.lastIndexOf("\n\n")))).toBe(true);
        expect(after).toContain(word ?? "");
      }
    }
  });

  it("formats a heading picked as a line with Home then Shift+End, and types into it", () => {
    const view = codeView(BLOCKS, { before: "" }, [markdownFormatKeymap]);
    view.dispatch({ selection: { anchor: BLOCKS.indexOf("## Title"), head: BLOCKS.indexOf("here") + 4 } });
    sourceTarget(() => view).bold();
    view.dispatch({ ...view.state.replaceSelection("X"), userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe("Intro para.\n\n## **X**\n\nAfter para.\n");
  });
});

describe("Typing straight after a Markdown toolbar action in Code mode", () => {
  const KEEPS_EDGE_SPACE = new Set(["bold with a trailing space", "strike with a trailing space", "italic on a word and space before an underscore run"]);
  const SAME_MEANING = new Set(["code over a backtick"]);

  it.each([...CASES, ...SAFE_CASES].filter(([name]) => !KEEPS_EDGE_SPACE.has(name)))("types where Visual types after %s", (name, source, pick, act) => {
    const code = codeTyped(source, pick, act, "X");
    const visual = visualSave(source, pick, act, "X");
    if (SAME_MEANING.has(name)) expect(parseMarkdownBody(code).doc).toEqual(parseMarkdownBody(visual).doc);
    else expect(code).toBe(visual);
  });

  it.each([
    ["bold", (target: MarkdownTarget) => target.bold(), "Alpha **X** charlie.\n"],
    ["strike", (target: MarkdownTarget) => target.strike(), "Alpha ~~X~~ charlie.\n"],
  ] as const)("keeps the space after a %s word typed over, where Visual drops it", (_name, act, expected) => {
    expect(codeTyped("Alpha bravo charlie.\n", { word: "bravo " }, act, "X")).toBe(expected);
  });

  it("types bold text after Bold at a bare caret, then keeps typing inside it", () => {
    const view = codeView("Alpha bravo charlie.\n", { caret: "bra" }, [markdownFormatKeymap]);
    sourceTarget(() => view).bold();
    expect(view.state.selection.main.head).toBe(9);
    for (const key of ["X", "Y"]) view.dispatch({ ...view.state.replaceSelection(key), userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe("Alpha bra**XY**vo charlie.\n");
  });

  it("leaves the text alone when what you type means the same either way", () => {
    const source = "Line one wraps\nhere and word.\n";
    const view = codeView(source, { caret: "and " }, [markdownFormatKeymap]);
    sourceTarget(() => view).unlink();
    view.dispatch({ ...view.state.replaceSelection("X"), userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe("Line one wraps\nhere and Xword.\n");
  });

  it.each([
    ["Bold over the start of a link", "See [inline](https://a.b/c) and more.\n", { range: ["See", "inline"] as [string, string] }, (target: MarkdownTarget) => target.bold()],
  ] as const)("types where Visual types after %s", (_name, source, pick, act) => {
    expect(codeTyped(source, pick, act, "X")).toBe(visualSave(source, pick, act, "X"));
  });

  it("types where Visual types after Ordered over a backward selection between list items", () => {
    const source = "- one\n- two **b**\n- three\n";
    const act = (target: MarkdownTarget) => target.ordered();
    const view = codeView(source, { before: "- one" }, [markdownFormatKeymap]);
    view.dispatch({ selection: { anchor: source.indexOf("three"), head: source.indexOf("**\n") + 2 } });
    act(sourceTarget(() => view));
    view.dispatch({ ...view.state.replaceSelection("X"), userEvent: "input.type" });
    const { editor, save } = visualEditor(source, { before: "one" });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, docPosition(editor, "three", false), docPosition(editor, "b", true))));
    act(visualTarget(editor));
    editor.view.dispatch(editor.state.tr.insertText("X"));
    expect(view.state.doc.toString()).toBe(save());
  });

  it.each([
    ["Quote", (target: MarkdownTarget) => target.quote()],
    ["Left", (target: MarkdownTarget) => target.align("left")],
    ["Unlink", (target: MarkdownTarget) => target.unlink()],
    ["no colour", (target: MarkdownTarget) => target.color(null)],
  ] as const)("leaves the caret where it was when %s changes nothing", (_name, act) => {
    const view = codeView("- [x] done two\n", { caret: "- [" }, [markdownFormatKeymap]);
    act(sourceTarget(() => view));
    if (view.state.doc.toString() === "- [x] done two\n") expect(view.state.selection.main.head).toBe(3);
  });

  function typedAfter(source: string, caretAfter: string, act: Act, keys: string[], extensions: Extension[] = []): string {
    const view = codeView(source, { caret: caretAfter }, [markdownFormatKeymap, ...extensions]);
    act(sourceTarget(() => view));
    for (const key of keys) view.dispatch({ ...view.state.replaceSelection(key), userEvent: "input.type" });
    return view.state.doc.toString();
  }

  it.each([
    ["a '*' list", "* item and bravo word\n* two\n", "* item and bravo".length - 2, "* item and bra**Hi**vo word\n* two\n"],
    ["'__strong__'", "__strong__ and bravo end.\n", "__strong__ and bravo".length - 2, "__strong__ and bra**Hi**vo end.\n"],
    ["a two-space hard break", "Line with two trailing  \nhard and bravo word.\n", "Line with two trailing  \nhard and bravo".length - 2, "Line with two trailing  \nhard and bra**Hi**vo word.\n"],
    ["a soft-wrapped paragraph", "Line one wraps\nhere and bravo word.\n", "Line one wraps\nhere and bravo".length - 2, "Line one wraps\nhere and bra**Hi**vo word.\n"],
    ["a reference link", "See [x][r] and bravo end.\n\n[r]: https://a.b\n", "See [x][r] and bravo".length - 2, "See [x][r] and bra**Hi**vo end.\n\n[r]: https://a.b\n"],
  ])("types bold after Bold at a bare caret in %s and leaves the rest of the block as written", (_name, source, at, expected) => {
    const view = codeView(source, { before: "" }, [markdownFormatKeymap]);
    view.dispatch({ selection: { anchor: at } });
    sourceTarget(() => view).bold();
    for (const key of ["H", "i"]) view.dispatch({ ...view.state.replaceSelection(key), userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe(expected);
  });

  it("types bold after a word, a space and Bold", () => {
    expect(typedAfter("Some text \n", "Some text ", (target) => target.bold(), ["H", "i"])).toBe("Some text **Hi**\n");
  });

  it("keeps Bold on punctuation typed first, as Visual's model holds it, with no dangling '**'", () => {
    const keys = ['"', "H", "i", '"'];
    const { editor } = visualEditor("Alpha bravo charlie.\n", { caret: "bravo" });
    visualTarget(editor).bold();
    for (const key of keys) editor.view.dispatch(editor.state.tr.insertText(key));
    const code = typedAfter("Alpha bravo charlie.\n", "bravo", (target) => target.bold(), keys);
    expect(code).not.toMatch(/"\*\*(?!H)|\*\*"\s/u);
    expect(editor.schema.nodeFromJSON(parseMarkdownBody(code).doc).toJSON().content?.[0]).toEqual(editor.getJSON().content?.[0]);
  });

  it("lets auto-closed brackets type plainly after Bold, in the right order", () => {
    const view = codeView("Alpha bravo charlie.\n", { caret: "bravo" }, [markdownFormatKeymap, closeBrackets()]);
    sourceTarget(() => view).bold();
    view.dispatch({ changes: { from: 11, insert: "()" }, selection: { anchor: 12 }, userEvent: "input.type" });
    for (const key of ["a", "b"]) view.dispatch({ ...view.state.replaceSelection(key), userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe("Alpha bravo(ab) charlie.\n");
  });

  it("keeps both fences when typing after Center over a paragraph and an indented code block", () => {
    const after = typedAfter("Alpha zctq zcuq.\n\n    zcvq zcwq code\n", "Alpha zctq ", (target) => target.align("center"), []);
    const view = codeView("Alpha zctq zcuq.\n\n    zcvq zcwq code\n", { range: ["zcuq", "zcvq"] }, [markdownFormatKeymap]);
    sourceTarget(() => view).align("center");
    view.dispatch({ ...view.state.replaceSelection("X"), userEvent: "input.type" });
    const text = view.state.doc.toString();
    expect(after).toContain(":::");
    expect(text.match(/^:::/gmu)?.length).toBe(2);
    expect(text).toContain("X");
  });

  it("deletes a selection that crosses a closing delimiter the way Visual does", () => {
    const act = (target: MarkdownTarget) => target.italic();
    const pick = { range: ["run", "aft"] as [string, string] };
    expect(codeTyped("Plain **bold run** after.\n", pick, act, "")).toBe(visualDeleted("Plain **bold run** after.\n", pick, act));
  });
});

describe("Markdown toolbar state in Code mode", () => {
  const STATES: [string, string, Pick][] = [
    ["a heading", "## Title\n", { caret: "Tit" }],
    ["a heading line inside a code block", "```bash\n# install deps\n```\n", { caret: "inst" }],
    ["a quoted heading", "> ## Quoted head\n", { caret: "Quo" }],
    ["a setext heading", "Title here\n=====\n", { caret: "Tit" }],
    ["a fence over two paragraphs", "::: {.center}\nFirst para\n\nSecond para\n:::\n", { caret: "Sec" }],
    ["a bare-word fence", "::: center\nMid\n:::\n", { caret: "Mi" }],
    ["a heading inside a list item", "- ## Head\n", { caret: "He" }],
    ["a link", "A [word](https://a.b) b.\n", { caret: "wo" }],
    ["a coloured span", SPAN, { caret: "bra" }],
    ["a table", "| a | b |\n| --- | --- |\n| c | d |\n", { caret: "c" }],
    ["a pipeless table", "a1 | b1\n--- | ---\nc1 | d1\n", { caret: "c1" }],
    ["a nested code fence", "````md\n```\ninner zz\n```\n````\n", { caret: "zz" }],
    ["an autolink", "A <https://example.com> b.\n", { caret: "exam" }],
    ["a reference link", "A [ref text][r] b.\n\n[r]: https://a.b\n", { caret: "ref" }],
    ["an indented code block", "Para.\n\n    indented code\n", { caret: "inden" }],
  ];

  it.each(STATES)("lights what Visual lights for %s", (_name, source, pick) => {
    const { from } = textRange(source, pick);
    const { editor } = visualEditor(source, pick);
    expect(modelState(EditorState.create({ doc: source, selection: { anchor: from } }))).toEqual(visualStateOf(editor));
  });
});
