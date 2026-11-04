// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { serializeLatexBody } from "../latex/serialize";
import { WYSIWYG_EXTENSIONS } from "../schema";
import { parseMarkdownBody } from "./parse";
import { serializeMarkdownBody } from "./serialize";
import { createMarkdownSourceSnapshot } from "./source-layout";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function open(source: string): { editor: Editor; save: () => string } {
  const { doc, frontmatter, layout } = parseMarkdownBody(source);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: WYSIWYG_EXTENSIONS,
    content: doc,
  });
  editors.push(editor);
  const snapshot = createMarkdownSourceSnapshot(layout, editor.getJSON());
  return {
    editor,
    save: () => frontmatter + serializeMarkdownBody(editor.getJSON(), snapshot),
  };
}

function typeAtEndOf(editor: Editor, needle: string, text: string): void {
  let at = -1;
  editor.state.doc.descendants((node, position) => {
    if (at < 0 && node.isText && node.text?.includes(needle)) {
      at = position + node.text.indexOf(needle) + needle.length;
    }
  });
  expect(at, needle).toBeGreaterThan(-1);
  editor.view.dispatch(editor.state.tr.insertText(text, at));
}

const MERMAID = "```mermaid\nflowchart TD\n  A --> B\n```";
const PAGE = `# Report\n\nBefore.\n\n${MERMAID}\n\nAfter.\n`;

const CODE_BODY = "<!-- c --> [^1] $x$ @cite **bold** <b>tag</b> & \\\\ ~~s~~";

const EDITS: [name: string, source: string, needle: string, typed: string, saved: string][] = [
  [
    "keeps the fence and every line when typing inside it",
    PAGE,
    "A --> B",
    "\n  B --> C",
    "# Report\n\nBefore.\n\n```mermaid\nflowchart TD\n  A --> B\n  B --> C\n```\n\nAfter.\n",
  ],
  [
    "keeps a whole info string, not only its first word",
    "```{.python .numberLines startFrom=\"3\"}\nx = 1\n```\n",
    "x = 1",
    "0",
    "```{.python .numberLines startFrom=\"3\"}\nx = 10\n```\n",
  ],
  [
    "uses a longer fence when the code holds one",
    "````md\n```js\nx\n```\n````\n",
    "x",
    "y",
    "````md\n```js\nxy\n```\n````\n",
  ],
  [
    "switches to tildes when the info string holds a backtick",
    "~~~a`b\none\n~~~\n",
    "one",
    " two",
    "~~~a`b\none two\n~~~\n",
  ],
  [
    "turns an edited indented block into a fence without losing text",
    "Text.\n\n    one\n      two\n",
    "two",
    "!",
    "Text.\n\n```\none\n  two!\n```\n",
  ],
  [
    "does not read Markdown syntax or preserved tokens inside code",
    `\`\`\`text\n${CODE_BODY}\n\`\`\`\n`,
    "~~s~~",
    "!",
    `\`\`\`text\n${CODE_BODY}!\n\`\`\`\n`,
  ],
  [
    "keeps blank lines and trailing spaces inside code",
    "```\none  \n\n\ntwo\n```\n",
    "two",
    "!",
    "```\none  \n\n\ntwo!\n```\n",
  ],
  [
    "keeps CRLF line endings when a fence is edited",
    "A.\r\n\r\n```js\r\none\r\ntwo\r\n```\r\n",
    "two",
    "!",
    "A.\r\n\r\n```js\r\none\r\ntwo!\r\n```\r\n",
  ],
  [
    "survives an unclosed fence at the end of a file",
    "Text.\n\n```js\none\n",
    "one",
    "!",
    "Text.\n\n```js\none!\n```\n",
  ],
  [
    "keeps a blank last line of code",
    "```\none\n\n```\n",
    "one",
    "!",
    "```\none!\n\n```\n",
  ],
];

function codeBlocks(doc: JSONContent): JSONContent[] {
  return (doc.content ?? []).flatMap((node) =>
    node.type === "codeBlock" ? [node] : codeBlocks(node),
  );
}

describe("fenced code in the Markdown visual editor", () => {
  it("opens a fence as one code block with its language", () => {
    const blocks = codeBlocks(parseMarkdownBody(PAGE).doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.language).toBe("mermaid");
    expect(blocks[0].content?.[0].text).toBe("flowchart TD\n  A --> B");
  });

  it("leaves an untouched fence byte for byte when a neighbour changes", () => {
    const source = "Before.\n\n~~~~python title=\"x\"\nprint( 1 )\n~~~~\n\nAfter.\n";
    const { editor, save } = open(source);
    typeAtEndOf(editor, "Before", " now");
    expect(save()).toBe(source.replace("Before.", "Before now."));
  });

  it.each(EDITS)("%s", (_name, source, needle, typed, saved) => {
    const { editor, save } = open(source);
    typeAtEndOf(editor, needle, typed);
    expect(save()).toBe(saved);
  });

  it("keeps fences when there is no source snapshot to fall back on", () => {
    const { doc } = parseMarkdownBody(PAGE);
    expect(serializeMarkdownBody(doc)).toBe(PAGE.trimEnd());
  });

  it("keeps a fence inside a list and a quote when it is edited", () => {
    const list = "- item\n\n  ```js\n  one\n  ```\n";
    const listed = open(list);
    typeAtEndOf(listed.editor, "one", "!");
    expect(listed.save()).toContain("  ```js\n  one!\n  ```");

    const quote = "> ```js\n> one\n> ```\n";
    const quoted = open(quote);
    typeAtEndOf(quoted.editor, "one", "!");
    expect(quoted.save()).toBe("> ```js\n> one!\n> ```\n");
  });

  it("keeps an empty fence and its language", () => {
    const { doc } = parseMarkdownBody("```js\n```\n");
    expect(serializeMarkdownBody(doc)).toBe("```js\n```");
  });

  it("starts a block from ``` with the language typed after it", () => {
    const { editor, save } = open("Text.\n");
    editor.commands.setContent("<p></p>");
    editor.view.dispatch(editor.state.tr.insertText("```js"));
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, from, to, " ", () => editor.state.tr.insertText(" ", from, to)),
    );
    expect(handled).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText("x = 1"));
    expect(editor.getJSON().content?.[0].type).toBe("codeBlock");
    expect(save()).toContain("```js\nx = 1\n```");
  });

  it("indents with Tab at the caret and keeps focus in the block", () => {
    const { editor, save } = open("```js\none\n```\n");
    editor.commands.setTextSelection(1);
    expect(editor.commands.keyboardShortcut("Tab")).toBe(true);
    expect(save()).toBe("```js\n    one\n```\n");
  });

  it("keeps a block and its info string when it moves", () => {
    const { editor, save } = open("Top.\n\n```{.js}\nx\n```\n\nEnd.\n");
    const { doc, tr } = editor.state;
    const block = doc.child(1);
    const from = doc.child(0).nodeSize;
    tr.delete(from, from + block.nodeSize).insert(0, block);
    editor.view.dispatch(tr);
    expect(save()).toBe("```{.js}\nx\n```\n\nTop.\n\nEnd.\n");
  });

  it("copies the whole info string with the block", () => {
    const { editor } = open("```{.python .numberLines}\nx\n```\n");
    const html = editor.getHTML();
    expect(html).toContain('data-info="{.python .numberLines}"');
    const pasted = new Editor({
      element: document.createElement("div"),
      extensions: WYSIWYG_EXTENSIONS,
      content: html,
    });
    editors.push(pasted);
    expect(pasted.getJSON().content?.[0].attrs?.language).toBe("{.python .numberLines}");
  });

  it("reads the language of code pasted from a web page", () => {
    const pasted = new Editor({
      element: document.createElement("div"),
      extensions: WYSIWYG_EXTENSIONS,
      content: '<pre><code class="language-rust">fn main() {}</code></pre>',
    });
    editors.push(pasted);
    expect(pasted.getJSON().content?.[0].attrs?.language).toBe("rust");
  });

  it("writes a code block as verbatim in LaTeX", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "python" },
          content: [{ type: "text", text: "x = 1 % not a comment" }],
        },
      ],
    };
    expect(serializeLatexBody(doc)).toBe(
      "\\begin{verbatim}\nx = 1 % not a comment\n\\end{verbatim}\n",
    );
  });
});
