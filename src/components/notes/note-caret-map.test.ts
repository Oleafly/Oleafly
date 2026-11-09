// @vitest-environment jsdom
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { blockCharMap, docPosAt, MATCH_WINDOW, sourceOffsetAt, unitSource } from "./note-caret-map";
import { parseSharedNote } from "./note-live-doc";
import { noteMarkdownExtensions } from "./note-markdown";

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
