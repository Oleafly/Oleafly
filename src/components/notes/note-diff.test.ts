// @vitest-environment jsdom
import { getSchema } from "@tiptap/core";
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { createWysiwygExtensions, parseMarkdownBody } from "@oleafly/wysiwyg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { myersEditScript } from "@/lib/myers-diff";
import { diffNoteDocs } from "./note-diff";

vi.mock("@/lib/myers-diff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/myers-diff")>();
  return { ...actual, myersEditScript: vi.fn(actual.myersEditScript) };
});

const schema = getSchema(createWysiwygExtensions());

function doc(markdown: string): ProseMirrorNode {
  return schema.nodeFromJSON(parseMarkdownBody(markdown).doc);
}

const inlineSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    chip: { group: "inline", inline: true, content: "text*" },
    pin: { group: "inline", inline: true, atom: true },
  },
});

function paragraph(...content: ProseMirrorNode[]): ProseMirrorNode {
  return inlineSchema.node("doc", null, [inlineSchema.node("paragraph", null, content)]);
}

const text = (value: string) => inlineSchema.text(value);

afterEach(() => {
  vi.mocked(myersEditScript).mockClear();
});

describe("note diff", () => {
  it("proposes a word deletion as an empty replacement", () => {
    const before = doc("Masks are sampled per pixel.\n");
    const changes = diffNoteDocs(before, doc("Masks are sampled pixel.\n"));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "text", text: "" });
    const change = changes[0] as { from: number; to: number };
    expect(before.textBetween(change.from, change.to)).toBe("per ");
  });

  it("proposes a word insertion without removing anything", () => {
    const changes = diffNoteDocs(doc("Masks are sampled per pixel.\n"), doc("Masks are sampled per single pixel.\n"));
    expect(changes).toEqual([{ kind: "text", from: 23, to: 23, text: "single " }]);
  });

  it("adds a block after the last one at the end of the note", () => {
    const before = doc("First.\n");
    const changes = diffNoteDocs(before, doc("First.\n\nSecond.\n"));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "blocks", from: before.content.size, to: before.content.size });
    expect((changes[0] as { nodes: ProseMirrorNode[] }).nodes.map((node) => node.textContent)).toEqual(["Second."]);
  });

  it("removes a paragraph as a block change with nothing in its place", () => {
    const before = doc("First.\n\nSecond.\n");
    const first = before.firstChild?.nodeSize ?? 0;
    expect(diffNoteDocs(before, doc("First.\n"))).toEqual([
      { kind: "blocks", from: first, to: before.content.size, nodes: [] },
    ]);
  });

  it("treats new formatting on the same words as a block change", () => {
    const before = doc("Masks are sampled per pixel.\n");
    const after = doc("Masks are sampled **per pixel**.\n");
    expect(diffNoteDocs(before, after)).toEqual([
      { kind: "blocks", from: 0, to: before.content.size, nodes: [after.firstChild] },
    ]);
  });

  it("replaces the whole note when the block diff gives up", () => {
    vi.mocked(myersEditScript).mockReturnValueOnce(null);
    const before = doc("First.\n\nSecond.\n");
    const after = doc("Other.\n");
    expect(diffNoteDocs(before, after)).toEqual([
      { kind: "blocks", from: 0, to: before.content.size, nodes: [after.firstChild] },
    ]);
  });

  it("orders changes that start at the same place by where they end", () => {
    vi.mocked(myersEditScript).mockReturnValueOnce([
      { kind: "add", oldStart: 0, newStart: 0, length: 1 },
      { kind: "same", oldStart: 0, newStart: 1, length: 0 },
      { kind: "del", oldStart: 0, newStart: 1, length: 1 },
      { kind: "add", oldStart: 1, newStart: 1, length: 1 },
    ]);
    const before = doc("Alpha.\n");
    const changes = diffNoteDocs(before, doc("Inserted.\n\n# Alpha.\n"));
    expect(changes.map((change) => [change.kind, change.from, change.to])).toEqual([
      ["blocks", 0, 0],
      ["blocks", 0, before.content.size],
    ]);
  });

  it("treats a paragraph with nested inline content as one block change", () => {
    const before = paragraph(text("a "), inlineSchema.node("chip", null, [text("x")]), text(" b"));
    const after = paragraph(text("a "), inlineSchema.node("chip", null, [text("y")]), text(" b"));
    expect(diffNoteDocs(before, after)).toEqual([
      { kind: "blocks", from: 0, to: before.firstChild?.nodeSize, nodes: [after.firstChild] },
    ]);
  });

  it("treats a new inline object inside a paragraph as one block change", () => {
    const before = paragraph(text("a b"));
    const after = paragraph(text("a "), inlineSchema.node("pin"), text("b"));
    expect(diffNoteDocs(before, after)).toEqual([
      { kind: "blocks", from: 0, to: before.firstChild?.nodeSize, nodes: [after.firstChild] },
    ]);
  });
});
