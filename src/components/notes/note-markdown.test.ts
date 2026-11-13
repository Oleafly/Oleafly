// @vitest-environment jsdom
import { createMarkdownSourceSnapshot } from "@oleafly/wysiwyg";
import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { withNoteIdentity } from "./note-file";
import { joinNoteSource, noteMarkdownExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor, typeInto } from "./tests/kb-editor-fixtures";

afterEach(destroyKbEditors);

function roundTrip(markdown: string): string {
  return serializeNoteMarkdown(parseNoteMarkdown(markdown).doc);
}

function savedNote(text: string): string {
  const parsed = parseNoteMarkdown(text);
  const snapshot = createMarkdownSourceSnapshot(parsed.layout, parsed.doc);
  const body = serializeNoteMarkdown(parsed.doc, snapshot);
  const frontMatter = withNoteIdentity(parsed.frontmatter, "x").replace(/\s+$/u, "");
  return joinNoteSource(frontMatter, parsed.separator, body);
}

describe("saving a whole note", () => {
  it.each([
    "---\ntitle: A\nkind: note\nid: x\n---\n\n# Heading\n\nBody\n",
    "---\ntitle: A\nkind: note\nid: x\n---\n# Heading\n\nBody\n",
    "---\ntitle: A\nkind: note\nid: x\n---\n\n\n# Heading\n",
    "---\ntitle: A\nkind: note\nid: x\n---\nBody",
    "---\ntitle: A\nkind: note\nid: x\n...\n\nBody\n",
    "\uFEFF---\ntitle: A\nkind: note\nid: x\n---\n\nBody\n",
    "\uFEFF---\ntitle: A\nkind: note\nid: x\n...\n# Heading\n",
    "---\r\ntitle: A\r\nkind: note\r\nid: x\r\n---\r\n\r\nBody\r\n",
    "---\ntitle: A\nkind: note\nid: x\n---\n",
    "---\ntitle: A\nkind: note\nid: x\n---",
    "---\ntitle: A\nkind: note\nid: x\n---\n\n",
  ])("writes %j back byte for byte", (text) => {
    expect(savedNote(text)).toBe(text);
  });

  it.each([
    ["\uFEFF---\ntitle: A\n---\n\nBody\n", "\uFEFF---\ntitle: A\nkind: note\nid: x\n---\n\nBody\n"],
    ["---\ntitle: A\n...\n\nBody\n", "---\ntitle: A\nkind: note\nid: x\n...\n\nBody\n"],
    ["\uFEFFBody\n", "\uFEFF---\nkind: note\nid: x\n---\n\nBody\n"],
    ["Body\n", "---\nkind: note\nid: x\n---\n\nBody\n"],
  ])("adds the identity to the front matter %j already has", (text, saved) => {
    expect(savedNote(text)).toBe(saved);
  });

  it("puts a blank line before a body that follows front matter with no break", () => {
    expect(joinNoteSource("---\ntitle: A\n---", "", "Body\n")).toBe("---\ntitle: A\n---\n\nBody\n");
    expect(joinNoteSource("", "\n", "Body\n")).toBe("Body\n");
  });
});

function withSnapshot(markdown: string, edit?: (doc: JSONContent) => JSONContent): string {
  const parsed = parseNoteMarkdown(markdown);
  const snapshot = createMarkdownSourceSnapshot(parsed.layout, parsed.doc);
  return serializeNoteMarkdown(edit ? edit(parsed.doc) : parsed.doc, snapshot);
}

function typesIn(node: JSONContent, found: string[] = []): string[] {
  if (node.type) found.push(node.type);
  for (const child of node.content ?? []) typesIn(child, found);
  for (const mark of node.marks ?? []) found.push(`mark:${mark.type}`);
  return found;
}

describe("Notes Markdown", () => {
  it.each([
    "- [ ] Buy reagents\n- [x] Book the microscope",
    "- [ ] Outer\n  - [x] Inner\n  - plain inner",
    "- plain\n- [ ] task\n- [x] done",
    "- [ ]\n- [x] Done",
    "Some ==highlighted== text and ==two **bold** words==.",
    "> [!note] Title\n> Body line",
    "> [!warning]- Folded title\n>\n> Body paragraph",
    "> [!tip]+\n> Open without a title",
    "> [!theorem] Pythagoras\n> $a^2 + b^2 = c^2$",
    "> [!info] Only a title",
    "> [!question]",
    "> [!note] Outer\n> > [!bug] Inner\n> > Body",
    "> [!example] Steps\n> - [ ] one\n> - [x] two",
    "See [Intro](oleafly://note/abc-1#getting-started) and [Plan](oleafly://note/abc-1).",
    "See [Café](oleafly://note/abc-1#caf%C3%A9-au-lait).",
    "![Method](oleafly://note/abc-1)",
    "![Method](oleafly://note/abc-1#setup)",
    "Plain > quote stays\n\n> just a quote",
  ])("writes %j back byte for byte", (markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
    expect(withSnapshot(markdown)).toBe(markdown);
  });

  it("reads tasks, highlights, callouts, heading links and embeds into their own nodes", () => {
    const { doc } = parseNoteMarkdown(
      "- [ ] a\n- b\n\n==hi==\n\n> [!note] T\n> body\n\n[x](oleafly://note/n1#h)\n\n![E](oleafly://note/n1)",
    );
    const types = typesIn(doc);
    expect(types).toEqual(expect.arrayContaining(["taskList", "taskItem", "mark:highlight", "callout", "calloutTitle", "mark:link", "image"]));
    const list = doc.content?.[0];
    expect(list?.content?.map((item) => item.attrs)).toEqual([
      { task: true, checked: false, blockId: null },
      { task: false, checked: false, blockId: null },
    ]);
    const callout = doc.content?.find((node) => node.type === "callout");
    expect(callout?.attrs).toMatchObject({ type: "note", fold: "", gap: false });
  });

  it("keeps untouched blocks verbatim when another block changes", () => {
    const markdown = "* [X] Odd marker\n\n> [!NOTE]-   Spaced\n> body\n\nedit me";
    const out = withSnapshot(markdown, (doc) => ({
      ...doc,
      content: doc.content?.map((node, index) =>
        index === 2 ? { type: "paragraph", content: [{ type: "text", text: "edited" }] } : node,
      ),
    }));
    expect(out).toBe("* [X] Odd marker\n\n> [!NOTE]-   Spaced\n> body\n\nedited");
  });

  it("leaves ordered lists that start with a box as text", () => {
    expect(typesIn(parseNoteMarkdown("1. [ ] stays text").doc)).not.toContain("taskList");
  });

  it("writes canonical task and callout forms for new content", () => {
    expect(roundTrip("* [X] Odd marker")).toBe("- [x] Odd marker");
    expect(roundTrip("> [!NOTE]-   Spaced\n> body")).toBe("> [!NOTE]- Spaced\n> body");
  });

  it.each([
    ["[t](oleafly://note/a#x)", "[t](oleafly://note/a#x)"],
    ["[t](oleafly://project/p/)", "[t](oleafly://project/p/)"],
    ["[t](oleafly://template/a)", "t"],
  ])("keeps note and project links and drops other app links: %j", (markdown, saved) => {
    expect(roundTrip(markdown)).toBe(saved);
  });

  it.each([
    "\uFEFF---\nprice: $5\n---\nThe $x$ value",
    "---\nprice: $5\n...\nThe $x$ value",
    "--- \nprice: $5\n---\nThe $x$ value",
  ])("finds math in the body after front matter %j", (source) => {
    expect(typesIn(parseNoteMarkdown(source).doc)).toContain("mathInline");
  });

  it("builds the Markdown schema once", () => {
    expect(noteMarkdownExtensions()).toBe(noteMarkdownExtensions());
  });
});

function edited(source: string, needle: string, typed: string): string {
  const editor = kbEditor(source);
  placeCursor(editor, needle, needle.length);
  typeInto(editor, typed);
  return kbMarkdown(editor);
}

describe("diagram block fences", () => {
  it.each([
    ["d2", "a -> b: label {style.stroke-dash: 3}\nb.shape: cylinder"],
    ["tikz", "\\usetikzlibrary{calc}\n\\begin{tikzpicture}\n  \\draw ($(0,0)!0.5!(2,0)$) -- (1,1); % midpoint\n\\end{tikzpicture}"],
    ["circuitikz", "\\begin{circuitikz}\n  \\draw (0,0) to[R, l=$R_1$, *-*] (2,0);\n\\end{circuitikz}"],
  ])("reads a %s fence as a block of that kind and writes it back unchanged", (kind, body) => {
    const markdown = `Before.\n\n\`\`\`${kind}\n${body}\n\`\`\`\n\nAfter.`;
    const block = parseNoteMarkdown(markdown).doc.content?.find((node) => node.type === "codeBlock");
    expect(block?.attrs?.language).toBe(kind);
    expect(block?.content?.[0]?.text).toBe(body);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps the longer fence a D2 block needs around its own code fence", () => {
    const markdown = "````d2\nexplain: |md\n  ```python\n  print(1)\n  ```\n|\n````";
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe("editing a note keeps what the editor does not model", () => {
  it.each([
    ["| Condition | Value |\n|:--|--:|\n| P(A \\| B) | 0.3 |", "0.3", "5", "| Condition | Value |\n|:--|--:|\n| P(A \\| B) | 0.35 |"],
    ["E = mc<sup>2</sup> see [[Relativity]] and ![[Figure 1]]", "see", "n", "E = mc<sup>2</sup> seen [[Relativity]] and ![[Figure 1]]"],
    ["| a | [[Beta\\|alias]] |\n| --- | --- |\n| `x\\|y` | 1 |", "1", "2", "| a | [[Beta\\|alias]] |\n| --- | --- |\n| `x\\|y` | 12 |"],
    ["<details>\n<summary>More</summary>\n\nHidden text\n\n</details>", "Hidden", "!", "<details>\n<summary>More</summary>\n\nHidden! text\n\n</details>"],
  ])("writes %j back with only the edit changed", (source, needle, typed, saved) => {
    expect(edited(source, needle, typed)).toBe(saved);
  });

  it("turns typed inline math into a formula that saves without doubled backslashes", () => {
    const editor = kbEditor("Text");
    placeCursor(editor, "Text", 4);
    typeInto(editor, " $\\alpha + \\beta$ end");
    expect(kbMarkdown(editor)).toBe("Text $\\alpha + \\beta$ end");
    expect(JSON.stringify(editor.getJSON())).toContain('"mathInline"');
  });

  it("turns typed --- on a new line into a divider", () => {
    const editor = kbEditor("above");
    placeCursor(editor, "above", 5);
    editor.commands.splitBlock();
    typeInto(editor, "---");
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["paragraph", "horizontalRule", "paragraph"]);
    expect(kbMarkdown(editor)).toBe("above\n\n---");
  });

  it("shows a thematic break as a divider", () => {
    expect(kbEditor("above\n\n---\n\nbelow").getJSON().content?.map((node) => node.type)).toEqual([
      "paragraph",
      "horizontalRule",
      "paragraph",
    ]);
  });

  const code = "fit <- lm(df$y ~ df$x) <!-- todo --> [^1]";
  it.each([
    ["a fence in a callout", `> [!example] Model\n> \`\`\`r\n> ${code}\n> \`\`\``, "Model"],
    ["a fence in a quote", `> Intro\n>\n> \`\`\`r\n> ${code}\n> \`\`\``, "Intro"],
    ["a fence in a nested list", `- outer\n  - Intro\n\n    \`\`\`r\n    ${code}\n    \`\`\``, "Intro"],
    ["a fence in a 10. list item", `10. Intro\n\n    \`\`\`r\n    ${code}\n    \`\`\``, "Intro"],
    ["indented code", `Intro\n\n    ${code}`, "Intro"],
    ["indented code in a quote", `> Intro\n>\n>     ${code}`, "Intro"],
  ])("keeps math, comments and footnote marks in %s as code", (_name, source, needle) => {
    const editor = kbEditor(source);
    const texts: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "codeBlock") texts.push(node.textContent);
    });
    expect(texts).toEqual([code]);
    placeCursor(editor, needle, needle.length);
    typeInto(editor, " 2");
    expect(kbMarkdown(editor)).toContain(code);
  });
});
