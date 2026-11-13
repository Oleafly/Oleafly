// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createWysiwygExtensions } from "../schema";
import { destroyOpenedEditors, openMarkdown, positionAfter, typeAtEndOf, typeText } from "../test-helpers";
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
