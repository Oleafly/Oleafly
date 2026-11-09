// @vitest-environment jsdom
import { createMarkdownSourceSnapshot } from "@oleafly/wysiwyg";
import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { withNoteIdentity } from "./note-file";
import {
  joinNoteSource,
  NOTE_ITEM_LINK,
  noteMarkdownExtensions,
  parseNoteMarkdown,
  serializeNoteMarkdown,
  withNoteHrefs,
} from "./note-markdown";

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
      { task: true, checked: false },
      { task: false, checked: false },
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

  it("accepts note links with a heading and refuses other app links", () => {
    expect(NOTE_ITEM_LINK.test("oleafly://note/a#x")).toBe(true);
    expect(NOTE_ITEM_LINK.test("oleafly://project/p/")).toBe(true);
    expect(NOTE_ITEM_LINK.test("oleafly://note/a#x y")).toBe(false);
    expect(NOTE_ITEM_LINK.test("oleafly://template/a")).toBe(false);
    expect(roundTrip("[t](oleafly://template/a)")).toBe("t");
  });

  it("leaves extensions other than links alone", () => {
    const [first] = noteMarkdownExtensions();
    expect(withNoteHrefs(first)).toBe(first);
    expect(noteMarkdownExtensions()).toBe(noteMarkdownExtensions());
  });
});
