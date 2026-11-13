// @vitest-environment jsdom
import { createMarkdownSourceSnapshot } from "@oleafly/wysiwyg";
import { Editor, getSchema } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { blockCharMap, docPosAt, MATCH_WINDOW, sourceOffsetAt, unitSource } from "./note-caret-map";
import { alignSharedNote, blockAtOffset, matchBlocks, parseSharedNote } from "./note-live-doc";
import { noteBaseExtensions, noteMarkdownExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { NotePeerMarks } from "./note-presence-decorations";
import { NoteSuggestions } from "./note-suggestions";

const schema = getSchema(noteMarkdownExtensions());

const NOTE = [
  "---",
  "title: Caret map",
  "kind: note",
  "id: caret-map-0001",
  "---",
  "",
  "## Masking results",
  "",
  "Run **3** used a [mask ratio](oleafly://note/abc) of 0.60 and $x^2$ after.",
  "",
  "- [ ] Rerun with ratio 0.75",
  "- [x] Plot the loss",
  "",
  "> [!note] Caveat",
  "> Ratios above 0.75 were unstable.",
  "",
  "```python",
  "def f(x):",
  "    return x",
  "```",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | ==two== |",
  "",
].join("\n");

function textPositions(doc: ReturnType<typeof parseSharedNote>["doc"]) {
  const out: { pos: number; char: string }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (let index = 0; index < (node.text ?? "").length; index += 1) out.push({ pos: pos + index, char: node.text?.[index] ?? "" });
    return false;
  });
  return out;
}

describe("note caret map", () => {
  it("maps every character of the note to the same character in its Markdown and back", () => {
    const note = parseSharedNote(schema, NOTE);
    const positions = textPositions(note.doc);
    expect(positions.length).toBeGreaterThan(100);
    for (const { pos, char } of positions) {
      const offset = sourceOffsetAt(note, note.doc, pos + 1) - 1;
      expect(note.text[offset], `char ${JSON.stringify(char)} at ${pos}`).toBe(char);
      expect(docPosAt(note, note.doc, offset + 1)).toBe(pos + 1);
    }
  });

  it("places a caret before a block's first character after its Markdown prefix", () => {
    const note = parseSharedNote(schema, NOTE);
    const heading = textPositions(note.doc)[0];
    const offset = sourceOffsetAt(note, note.doc, heading.pos);
    expect(note.text.slice(offset, offset + 7)).toBe("Masking");
    expect(docPosAt(note, note.doc, note.text.indexOf("## Masking"))).toBe(heading.pos);
  });

  it("skips inline math by its source so the text after it lines up", () => {
    const note = parseSharedNote(schema, NOTE);
    const after = textPositions(note.doc).find(({ char }, index, all) => char === "a" && all[index + 1]?.char === "f" && all[index + 2]?.char === "t");
    expect(after).toBeDefined();
    const offset = sourceOffsetAt(note, note.doc, (after?.pos ?? 0) + 1) - 1;
    expect(note.text.slice(offset, offset + 5)).toBe("after");
  });

  it("keeps offsets inside a block's source and positions inside the document", () => {
    const note = parseSharedNote(schema, NOTE);
    expect(docPosAt(note, note.doc, -50)).toBeGreaterThanOrEqual(0);
    expect(docPosAt(note, note.doc, note.text.length + 50)).toBeLessThanOrEqual(note.doc.content.size);
    expect(sourceOffsetAt(note, note.doc, note.doc.content.size)).toBeLessThanOrEqual(note.text.length);
  });

  it("answers zero for an empty note", () => {
    const empty = parseSharedNote(schema, "");
    expect(sourceOffsetAt(empty, empty.doc, 0)).toBe(0);
    expect(docPosAt(empty, empty.doc, 10)).toBeGreaterThanOrEqual(0);
  });

  it("answers the block start when a note has no mapped blocks or sources", () => {
    const parsed = parseSharedNote(schema, "Hi\n");
    expect(sourceOffsetAt({ ...parsed, starts: [], sources: [] }, parsed.doc, 1)).toBe(0);
    expect(docPosAt({ ...parsed, starts: [], sources: [] }, parsed.doc, 1)).toBe(0);
    expect(sourceOffsetAt({ ...parsed, starts: [0], sources: [] }, parsed.doc, 2)).toBe(0);
  });

  it("matches the text after an inline atom whose source is missing from the block", () => {
    const parsed = parseSharedNote(schema, "a $x$ b\n");
    const note = { ...parsed, sources: ["0:a  b"], starts: [0] };
    const b = textPositions(note.doc).find(({ char }) => char === "b");
    expect(sourceOffsetAt(note, note.doc, (b?.pos ?? 0) + 1)).toBe(4);
  });

  it("reads the node key off a block source", () => {
    expect(unitSource("2:## Title")).toEqual({ node: 2, source: "## Title" });
    expect(unitSource("plain")).toEqual({ node: 0, source: "plain" });
    expect(unitSource("x:y")).toEqual({ node: 0, source: "x:y" });
  });

  it("continues a unit's later nodes after the text its earlier nodes matched", () => {
    const parsed = parseSharedNote(schema, "ab\n\ncd\n");
    const note = { ...parsed, sources: ["0:ab\ncd", "1:ab\ncd"], starts: [0, 0] };
    const second = textPositions(note.doc).find(({ char }) => char === "c");
    expect(second).toBeDefined();
    expect(sourceOffsetAt(note, note.doc, second?.pos ?? 0)).toBe(3);
    expect(docPosAt(note, note.doc, 4)).toBe((second?.pos ?? 0) + 1);
  });

  it("leaves a character it cannot find within the window unmatched and reuses its cache", () => {
    const note = parseSharedNote(schema, "Hello");
    const block = note.doc.child(0);
    const far = `${"#".repeat(MATCH_WINDOW + 5)}Hello`;
    expect(blockCharMap(block, 0, far).pm).toEqual([]);
    const near = blockCharMap(block, 0, "Hello");
    expect(near.src).toEqual([0, 1, 2, 3, 4]);
    expect(blockCharMap(block, 0, "Hello")).toBe(near);
  });
});

let editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

function liveEditor(text: string) {
  const parsed = parseNoteMarkdown(text);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...noteBaseExtensions(), NoteSuggestions, NotePeerMarks],
    content: parsed.doc,
  });
  editors.push(editor);
  const snapshot = createMarkdownSourceSnapshot(parsed.layout, editor.getJSON());
  const shared = () => parseSharedNote(editor.schema, serializeNoteMarkdown(editor.getJSON(), snapshot));
  return { editor, shared };
}

function textIn(editor: Editor, needle: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0;
    const index = node.text?.indexOf(needle) ?? -1;
    if (index >= 0) found = pos + index;
    return false;
  });
  return found;
}

describe("note caret map below an empty paragraph", () => {
  const TEXT = "One\n\nTwo\n\nThree\n";

  function withBlankLine() {
    const live = liveEditor(TEXT);
    live.editor.commands.setTextSelection(textIn(live.editor, "One") + 3);
    live.editor.commands.splitBlock();
    const note = live.shared();
    expect(live.editor.state.doc.childCount).toBe(note.doc.childCount + 1);
    expect(note.text).toBe(TEXT);
    return { ...live, note };
  }

  it("sends a caret in a later block at that block's text", () => {
    const { editor, note } = withBlankLine();
    const caret = textIn(editor, "Three") + 2;
    expect(sourceOffsetAt(note, editor.state.doc, caret)).toBe(TEXT.indexOf("Three") + 2);
    expect(sourceOffsetAt(note, editor.state.doc, textIn(editor, "Two") + 1)).toBe(TEXT.indexOf("Two") + 1);
  });

  it("draws a collaborator's caret in the block their text is in", () => {
    const { editor, note } = withBlankLine();
    const pos = docPosAt(note, editor.state.doc, TEXT.indexOf("Two") + 1);
    expect(editor.state.doc.textBetween(pos - 1, pos + 2)).toBe("Two");
    const later = docPosAt(note, editor.state.doc, TEXT.indexOf("Three") + 3);
    expect(editor.state.doc.textBetween(later - 3, later + 2)).toBe("Three");
  });

  it("gives the empty paragraph no text of its own and finds the next block for its offset", () => {
    const { editor, note } = withBlankLine();
    const aligned = alignSharedNote(note, editor.state.doc);
    expect(aligned.starts).toEqual([0, TEXT.indexOf("Two"), TEXT.indexOf("Two"), TEXT.indexOf("Three")]);
    expect(aligned.sources[1]).toBe("");
    expect(blockAtOffset(aligned.starts, TEXT.indexOf("Two"))).toBe(2);
    expect(sourceOffsetAt(note, editor.state.doc, 6)).toBe(TEXT.indexOf("Two"));
    expect(alignSharedNote(note, editor.state.doc)).toBe(aligned);
    expect(alignSharedNote(note, note.doc)).toBe(note);
  });

  it("pairs a block the serializer changes with its source even next to an empty paragraph", () => {
    const schema = getSchema(noteMarkdownExtensions());
    const paragraph = (text?: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
    const source = [paragraph("One"), paragraph("Two"), paragraph("Three")];
    expect(matchBlocks(source, [paragraph("One"), paragraph(), paragraph("Two "), paragraph("Three")])).toEqual([0, -1, 1, 2]);
    expect(matchBlocks(source, [paragraph("Uno"), paragraph("Dos"), paragraph("Three")])).toEqual([0, 1, 2]);
    expect(matchBlocks(source, [paragraph(), paragraph("One"), paragraph("Two"), paragraph("Three"), paragraph()])).toEqual([
      -1, 0, 1, 2, -1,
    ]);
  });
});
