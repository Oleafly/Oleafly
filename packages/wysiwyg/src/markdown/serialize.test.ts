// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createWysiwygExtensions } from "../schema";
import { destroyOpenedEditors, mathRanges, openMarkdown, positionAfter, typeAtEndOf, typeText } from "../test-helpers";
import { parseMarkdownBody } from "./parse";
import { serializeMarkdownBody } from "./serialize";

afterEach(destroyOpenedEditors);

describe("serializeMarkdownBody", () => {
  it("round-trips headings, bold, italic, links, and lists", () => {
    const body = `# Heading\n\nSome **bold** and *italic* text with a [link](https://example.com).\n\n- item one\n- item two\n`;
    const { doc } = parseMarkdownBody(body);
    expect(serializeMarkdownBody(doc)).toBe(body.trimEnd());
  });

  it("is idempotent on its own output", () => {
    const body = `# Heading\n\nSome **bold** text.\n`;
    const first = serializeMarkdownBody(parseMarkdownBody(body).doc);
    const second = serializeMarkdownBody(parseMarkdownBody(first).doc);
    expect(second).toBe(first);
  });

  it("keeps Pandoc citations, footnotes, comments and a bare < when a block is rewritten", () => {
    const body =
      "Jak uvádí [@novak2020, s. 3; viz @dvorak_2019], papír[^1] <!-- ověřit --> a 1 < 2.\n\n[^1]: Poznámka.";
    expect(serializeMarkdownBody(parseMarkdownBody(body).doc)).toBe(body);
  });

  it("escapes text that would read back as HTML or a link", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Tag <b> and [@key](x) stay text." }],
        },
      ],
    };
    const out = serializeMarkdownBody(doc);
    expect(out).toBe("Tag &lt;b> and \\[@key\\](x) stay text.");
    expect(serializeMarkdownBody(parseMarkdownBody(out).doc)).toBe(out);
  });
});

describe("editing a block keeps what the editor does not model", () => {
  it.each([
    ["inline HTML", "E = mc<sup>2</sup> and H<sub>2</sub>O, <kbd>Ctrl</kbd>, <span style=\"color:red\">red</span> <img src=\"a.png\" width=\"20\"> end", "end"],
    ["wiki links and embeds", "See [[Relativity]], [[Note|label]] and ![[Figure 1]] end", "end"],
    ["inline HTML in a quote", "> mc<sup>2</sup> end", "end"],
    ["inline HTML in a list", "- H<sub>2</sub>O end\n- next", "end"],
    ["tags the editor does not model as marks", "x<sup class=\"n\">2</sup>, x<SUP>3</SUP> and y<sub>4 end", "end"],
    ["a details block", "<details>\n<summary>More</summary>\n\nHidden **text** end\n\n</details>", "end"],
    ["a div block", "<div class=\"x\">\nhello\n</div>\n\nText end", "end"],
    ["HTML inside a list item", "- item end\n\n  <div>\n  inner\n  </div>", "end"],
  ])("keeps %s byte for byte", (_name, source, needle) => {
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, needle, "!");
    expect(save()).toBe(source.replace(` ${needle}`, ` ${needle}!`));
  });

  it.each([
    "E = mc<sup>2</sup> see [[Relativity]] and ![[Figure 1]]",
    "<details>\n<summary>More</summary>\n\nHidden **text**\n\n</details>",
    "Inline `<sup>x</sup>` and `[[x]]` stay code",
    "```html\n<div>[[x]]</div>\n```",
    "- [ ] task\n- [x] done\n- [X] also",
    "> [!note] Title",
    "> [!tip]+ Open",
    "==marked== text",
  ])("writes %j back from a whole-document serialize", (source) => {
    expect(serializeMarkdownBody(parseMarkdownBody(source).doc)).toBe(source);
  });

  it("keeps tags the editor models as formatting", () => {
    const { doc } = parseMarkdownBody('<u>under</u> <b>bold</b> <span data-text-color="red">red</span> <sup>up</sup> <sub>down</sub>');
    const paragraph = doc.content?.[0].content ?? [];
    expect(paragraph.flatMap((node) => node.marks?.map((mark) => mark.type) ?? [])).toEqual([
      "underline",
      "bold",
      "textColor",
      "superscript",
      "subscript",
    ]);
    expect(paragraph.some((node) => node.type === "rawInline")).toBe(false);
    expect(serializeMarkdownBody(doc)).toMatch(
      /^<u>under<\/u> \*\*bold\*\* <span data-text-color="red"[^>]*>red<\/span> <sup>up<\/sup> <sub>down<\/sub>$/u,
    );
  });
});

describe("highlight", () => {
  it("reads a plain mark tag as highlight and writes it back", () => {
    const { editor, save } = openMarkdown("A <mark>hi</mark> b\n");
    expect(editor.getJSON().content?.[0].content?.[1].marks?.[0].type).toBe("highlight");
    expect(save()).toBe("A <mark>hi</mark> b\n");
    const end = positionAfter(editor, " b") - 1;
    editor.chain().setTextSelection({ from: end, to: end + 1 }).toggleMark("highlight").run();
    expect(save()).toBe("A <mark>hi</mark> <mark>b</mark>\n");
  });
});

describe("superscript and subscript", () => {
  it("writes the marks as sup and sub tags", () => {
    const { editor, save } = openMarkdown("H2O and x2 end\n");
    const water = positionAfter(editor, "H2") - 1;
    const square = positionAfter(editor, "x2") - 1;
    editor.chain().setTextSelection({ from: water, to: water + 1 }).toggleMark("subscript").run();
    editor.chain().setTextSelection({ from: square, to: square + 1 }).toggleMark("superscript").run();
    expect(save()).toBe("H<sub>2</sub>O and x<sup>2</sup> end\n");
    editor.chain().setTextSelection({ from: square, to: square + 1 }).toggleMark("subscript").run();
    expect(save()).toBe("H<sub>2</sub>O and x<sub>2</sub> end\n");
  });

  it.each([
    ["Mod-.", "x<sup>2</sup>"],
    ["Mod-Shift-,", "x<sub>2</sub>"],
  ])("applies a mark with %s", (shortcut, written) => {
    const { editor, save } = openMarkdown("x2\n");
    editor.commands.setTextSelection({ from: 2, to: 3 });
    editor.commands.keyboardShortcut(shortcut);
    expect(save()).toBe(`${written}\n`);
  });
});

describe("thematic breaks", () => {
  it("reads ---, *** and ___ as dividers", () => {
    const { doc } = parseMarkdownBody("above\n\n---\n\nmiddle\n\n***\n\nbelow\n\n___\n\nend");
    expect(doc.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "horizontalRule",
      "paragraph",
      "horizontalRule",
      "paragraph",
      "horizontalRule",
      "paragraph",
    ]);
    expect(serializeMarkdownBody(doc)).toBe("above\n\n---\n\nmiddle\n\n---\n\nbelow\n\n---\n\nend");
  });

  it("keeps the written form of a divider when a neighbour changes", () => {
    const { editor, save } = openMarkdown("above\n\n***\n\nbelow\n");
    typeAtEndOf(editor, "below", "!");
    expect(save()).toBe("above\n\n***\n\nbelow!\n");
  });

  it("inserts a divider with a paragraph after it", () => {
    const { editor, save } = openMarkdown("above\n");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editor.commands.setHorizontalRule()).toBe(true);
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(save()).toBe("above\n\n---\n");
  });

  it.each([
    [false, "paragraph"],
    [true, "horizontalRule"],
  ])("turns typed --- into a divider only when Markdown typing is on (%s)", (markdownTyping, type) => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createWysiwygExtensions({ markdownTyping }),
      content: "<p></p>",
    });
    typeText(editor, "---");
    expect(editor.state.doc.firstChild?.type.name).toBe(type);
    editor.destroy();
  });
});

describe("editing a block keeps the rest of it in place", () => {
  it.each([
    ["bold", "**bold**\nnext line", "**bold** next! line"],
    ["italic", "*em*\nnext line", "*em* next! line"],
    ["code", "`code`\nnext line", "`code` next! line"],
    ["a link", "[link](u)\nnext line", "[link](u) next! line"],
    ["inline HTML", "a <u>und</u>\nnext line", "a <u>und</u> next! line"],
    ["a list item", "- item **bold**\n  next line", "- item **bold** next! line"],
    ["a quote", "> quote **bold**\n> next line", "> quote **bold** next! line"],
    ["an inline note", "a^[n]\nnext line", "a^[n] next! line"],
  ])("keeps the space of a soft line break after %s", (_name, source, saved) => {
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "next", "!");
    expect(save()).toBe(saved);
  });

  it("keeps two bold runs on separate lines apart", () => {
    const runs = (parseMarkdownBody("end with bold **x**\n**y** starts").doc.content?.[0].content ?? []).map((node) => [
      node.text,
      node.marks?.map((mark) => mark.type).join() ?? "",
    ]);
    expect(runs).toEqual([["end with bold ", ""], ["x", "bold"], [" ", ""], ["y", "bold"], [" starts", ""]]);
  });

  it.each([
    ["an image before text", "![img](a.png) **b** here", "here"],
    ["an image inside text", "text ![alt](a.png) more", "more"],
    ["linked images", "[![a](a.svg)](l1) [![b](b.svg)](l2) text", "text"],
    ["an image in a heading", "# Head ![i](a.png)", "Head"],
    ["an image in a list item", "- ![alt](fig/a.png)\n- zimb next", "zimb"],
    ["an image in a table", "| ![i](a.png) | b |\n|---|---|\n| c | word |", "word"],
    ["an inline note with an escaped pipe in a table", "| a^[x\\|y] | b |\n|---|---|\n| c | word |", "word"],
    ["a quote that opens a list item", "- > quoted word\n- other item", "other"],
    ["a heading that opens a list item", "- # Title\n- other item", "other"],
    ["a code block that opens a list item", "- ```\n  code\n  ```\n- other item", "other"],
    ["a list that opens a list item", "- - nested\n- other item", "other"],
    ["a quote that opens a numbered item", "1. > quoted\n2. other item", "other"],
  ])("keeps %s where it is", (_name, source, needle) => {
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, needle, "!");
    expect(save()).toBe(source.replace(needle, `${needle}!`));
  });

  it("reads a quote that opens a list item into the item", () => {
    expect(parseMarkdownBody("- > quoted word").doc.content?.[0]).toMatchObject({
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph" }, { type: "blockquote" }] }],
    });
  });

  it.each([
    ["an escaped dollar before math", "\\$5 and $x$ here", "\\$5 and $x$ here!"],
    ["dollars that cannot close", "costs $5 and $10 here", "costs $5 and $10 here!"],
    ["a dollar in code, a link or a tag before math", "`$a` [b](u$c) <kbd x=$d>K</kbd> and $x$ here", "`$a` [b](u$c) <kbd x=$d>K</kbd> and $x$ here!"],
    ["an escaped pair", "Costs \\$5 and 6\\$ here", "Costs \\$5 and 6\\$ here!"],
    ["an escaped pair around a letter", "Write \\$x\\$ literally here", "Write \\$x\\$ literally here!"],
    ["an escaped dollar in a table cell", "| \\$5 and $x$ cell | b |\n|---|---|\n| c | here |", "| \\$5 and $x$ cell | b |\n|---|---|\n| c | here! |"],
  ])("keeps %s from reading back as math", (_name, source, saved) => {
    const at = source.indexOf("$x$");
    const { editor, save } = openMarkdown(source, { preservedInlineRanges: at < 0 ? [] : [{ from: at, to: at + 3 }] });
    typeAtEndOf(editor, "here", "!");
    expect(save()).toBe(saved);
  });

  it.each([
    ["a paragraph", "a\tb and c\td here", "a\tb and c\td **here**"],
    ["a list item", "- a\tb here\n- next", "- a\tb **here**\n- next"],
    ["a table cell", "| a\tb | here |\n|---|---|", "| a\tb | **here** |\n|---|---|"],
  ])("keeps tabs inside the text of %s", (_name, source, saved) => {
    const { editor, save } = openMarkdown(source);
    const to = positionAfter(editor, "here");
    editor.chain().setTextSelection({ from: to - 4, to }).toggleBold().run();
    expect(save()).toBe(saved);
  });

  it("keeps a tab that indents code as indentation", () => {
    const { editor, save } = openMarkdown("Para here\n\n\tcode\tline");
    expect(editor.getJSON().content?.[1]).toMatchObject({ type: "codeBlock", content: [{ text: "code\tline" }] });
    typeAtEndOf(editor, "here", "!");
    expect(save()).toBe("Para here!\n\n\tcode\tline");
  });

  it.each([
    "**a.**b and word",
    "x a**.**b and word",
    "**a\\_**b and word",
    "**👍🏽**x and word",
    "**测试。**中文 and 中文**「引用」**中文 and word",
    "__foo__bar and foo__bar__ and word",
  ])("keeps emphasis that Pandoc and Visual read differently exactly as written in %j", (source) => {
    const { editor, save } = openMarkdown(source);
    typeAtEndOf(editor, "word", "!");
    expect(save()).toBe(`${source}!`);
  });

  it.each([
    "**bold**. and *it* and __b__ and snake_case and *a **b** c* word",
    "A **s*trong* word**s end and *em*phasis here.",
    "Emoji 😀 a*nd 👍🏽 n**ext** t*o end",
    "**Path C:\\User*s\\me and \\~/home/me* d**iffer.",
  ])("still models emphasis both readers agree on as marks in %j", (source) => {
    const nodes = parseMarkdownBody(source).doc.content?.[0].content ?? [];
    expect(nodes.some((node) => node.type === "rawInline")).toBe(false);
  });

  it.each([
    ["- \\[ \\] not a task word\n- [ ] real task", "word", "- \\[ \\] not a task **word**\n- [ ] real task"],
    ["- [ ] real task\n- \\[x\\] not a task word", "task", "- [ ] real **task**\n- \\[x\\] not a task word"],
    ["1. \\[ \\] not a task word", "word", "1. \\[ \\] not a task **word**"],
  ])("keeps escaped task brackets apart from a real task in %j", (source, needle, saved) => {
    const { editor, save } = openMarkdown(source);
    const to = positionAfter(editor, needle);
    editor.chain().setTextSelection({ from: to - needle.length, to }).toggleBold().run();
    expect(save()).toBe(saved);
  });

  it("keeps an image inside its aligned div", () => {
    const { editor, save } = openMarkdown("::: {.center}\n![alt](a.png)\n\nzqe text\n:::");
    typeAtEndOf(editor, "zqe", "!");
    expect(save()).toBe("::: {.center}\n![alt](a.png)\n:::\n\n::: {.center}\nzqe! text\n:::");
  });

  it("escapes a pipe typed into an inline note inside a table, and not one inside its math", () => {
    const source = "| a^[note] | b |\n|---|---|\n| c | $|x|$^[see $|y|$] |";
    const { editor, save } = openMarkdown(source, { preservedInlineRanges: mathRanges(source) });
    let at = -1;
    editor.state.doc.descendants((node, position) => {
      if (at < 0 && node.type.name === "footnote") at = position;
    });
    editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { source: "p|q" }));
    expect(save()).toBe("| a^[p\\|q] | b |\n|---|---|\n| c | $|x|$^[see $|y|$] |");
  });

  it("keeps an HTML table split by blank lines in its place", () => {
    const source =
      "Intro.\n\n<table>\n<tr>\n<th>Identifier</th>\n<th>Description</th>\n</tr>\n\n\n<tr>\n<td>\n\n`code`\n\n</td>\n</tr>\n</table>\n\nAfter.\n";
    const { editor, save } = openMarkdown(source);
    expect(editor.getJSON().content?.some((node) => node.type === "table")).toBe(false);
    typeAtEndOf(editor, "After", "!");
    expect(save()).toBe(source.replace("After.", "After!."));
  });

  it("keeps footnote definitions on their own lines when one of them is edited", () => {
    const source = "Text[^a] and[^b].\n\n[^a]: zber zbes.\n[^b]: zbev zbew\nlazy line.\n";
    const { editor, save } = openMarkdown(source);
    expect(editor.state.doc.children.map((node) => node.textBetween(0, node.content.size, undefined, (leaf) => String(leaf.attrs.source ?? "")))).toEqual([
      "Text[^a] and[^b].",
      "[^a]: zber zbes.",
      "[^b]: zbev zbew lazy line.",
    ]);
    typeAtEndOf(editor, "zber", "!");
    expect(save()).toBe("Text[^a] and[^b].\n\n[^a]: zber! zbes.\n\n[^b]: zbev zbew\nlazy line.\n");
  });

  it("leaves a definition line inside an ordinary paragraph as Pandoc reads it", () => {
    expect(parseMarkdownBody("Next para\n[^3]: three").doc.content).toHaveLength(1);
  });
});

describe("a callout marker in a quote", () => {
  const SOURCE = "> [!NOTE] zahae callout zahaf\n";

  it.each([
    ["strike", (editor: Editor) => editor.chain().setTextSelection({ from: 2, to: positionAfter(editor, "zahaf") }).toggleStrike().run(), "> [!NOTE] ~~zahae callout zahaf~~\n"],
    ["a link", (editor: Editor) => editor.chain().setTextSelection({ from: 2, to: positionAfter(editor, "zahaf") }).setLink({ href: "https://c.d" }).run(), "> [!NOTE] [zahae callout zahaf](https://c.d)\n"],
    ["a colour", (editor: Editor) => editor.chain().setTextSelection({ from: 2, to: positionAfter(editor, "zahaf") }).setMark("textColor", { color: "teal" }).run(), /^> \[!NOTE\] <span data-text-color="teal"[^>]*>zahae callout zahaf<\/span>\n$/u],
  ])("keeps the marker first and unformatted when the whole line gets %s", (_name, act, saved) => {
    const { editor, save } = openMarkdown(SOURCE);
    act(editor);
    if (typeof saved === "string") expect(save()).toBe(saved);
    else expect(save()).toMatch(saved);
  });

  it("keeps the marker first when a link is put in before it", () => {
    const { editor, save } = openMarkdown(SOURCE);
    editor.chain().insertContentAt(2, { type: "text", text: "link text", marks: [{ type: "link", attrs: { href: "https://c.d" } }] }).run();
    expect(save()).toBe("> [!NOTE] [link text](https://c.d) zahae callout zahaf\n");
  });

  it("leaves a marker later in the quote as text", () => {
    expect(openMarkdown("> intro\n> [!NOTE] not a callout\n").save()).toBe("> intro\n> [!NOTE] not a callout\n");
    const { editor, save } = openMarkdown("> intro\n> [!NOTE] not a callout\n");
    typeAtEndOf(editor, "intro", "!");
    expect(save()).toBe("> intro! \\[!NOTE\\] not a callout\n");
  });
});
