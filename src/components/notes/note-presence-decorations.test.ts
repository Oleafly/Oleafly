// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteBaseExtensions, parseNoteMarkdown } from "./note-markdown";
import {
  NotePeerMarks,
  peerCaretsOf,
  peerMarksOf,
  placeNotePeerCarets,
  setNotePeerCarets,
  setNotePeerMarks,
} from "./note-presence-decorations";

let editors: Editor[] = [];

function build(text: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...noteBaseExtensions(), NotePeerMarks],
    content: parseNoteMarkdown(text).doc,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe("collaborator margin marks", () => {
  it("draws one coloured mark per collaborator at the start of their block", () => {
    const editor = build("First.\n\nSecond.\n\n- item\n");
    setNotePeerMarks(editor, [
      { id: "alice", name: "Alice", hue: 10, index: 1 },
      { id: "bob", name: "Bob", hue: 200, index: 1 },
      { id: "carol", name: "Carol", hue: 90, index: 2 },
    ]);
    const groups = editor.view.dom.querySelectorAll("[data-note-peers]");
    expect([...groups].map((group) => group.getAttribute("data-note-peers"))).toEqual(["alice bob", "carol"]);
    expect(groups[0].getAttribute("aria-hidden")).toBe("true");
    expect(editor.view.dom.querySelector('[data-note-peer-name="bob"]')?.textContent).toBe("Bob");
  });

  it("keeps marks on their blocks while the document changes and skips unchanged updates", () => {
    const editor = build("First.\n\nSecond.\n");
    setNotePeerMarks(editor, [{ id: "alice", name: "Alice", hue: 10, index: 1 }]);
    const before = peerMarksOf(editor.state)[0].pos;
    const state = editor.state;
    setNotePeerMarks(editor, [{ id: "alice", name: "Alice", hue: 10, index: 1 }]);
    expect(editor.state).toBe(state);
    editor.commands.setTextSelection(2);
    editor.commands.insertContent("Much longer ");
    const after = peerMarksOf(editor.state)[0].pos;
    expect(after).toBe(before + "Much longer ".length);
    expect(editor.state.doc.nodeAt(after)?.textContent).toBe("Second.");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent("!");
    expect(peerMarksOf(editor.state)[0].pos).toBe(after);
  });

  it("clamps marks past the end to the last block and clears them", () => {
    const editor = build("Only.\n");
    setNotePeerMarks(editor, [{ id: "alice", name: "Alice", hue: 10, index: 9 }]);
    expect(peerMarksOf(editor.state)[0].pos).toBe(0);
    editor.commands.selectAll();
    editor.commands.deleteSelection();
    expect(peerMarksOf(editor.state)).toHaveLength(1);
    setNotePeerMarks(editor, []);
    expect(editor.view.dom.querySelector("[data-note-peers]")).toBeNull();
  });

  it("skips leaf blocks", () => {
    const editor = build("Text.\n\nAfter.\n");
    const leaf = Object.values(editor.schema.nodes).find((type) => type.isLeaf && type.isBlock && !type.spec.content);
    if (!leaf) throw new Error("The note schema has no leaf block.");
    editor.commands.insertContentAt(editor.state.doc.child(0).nodeSize, { type: leaf.name });
    let rule = -1;
    editor.state.doc.forEach((node, _offset, index) => {
      if (node.isLeaf) rule = index;
    });
    setNotePeerMarks(editor, [{ id: "alice", name: "Alice", hue: 10, index: rule }]);
    expect(editor.state.doc.child(rule).isLeaf).toBe(true);
    expect(editor.view.dom.querySelector("[data-note-peers]")).toBeNull();
  });
});

describe("collaborator carets", () => {
  const caret = (id: string, head: number, anchor = head, name: string | null = `Person ${id}`) => ({ id, name, hue: 200, head, anchor });

  it("draws a named caret with its label shade and a tinted selection", () => {
    const editor = build("First line.\n\nSecond.\n");
    setNotePeerCarets(editor, [caret("alice", 3, 1), caret("bob", 15, 15, null)], (offset) => offset);
    const alice = editor.view.dom.querySelector('[data-note-peer-caret="alice"]') as HTMLElement;
    expect(alice.textContent).toBe("Person alice");
    expect(alice.getAttribute("aria-hidden")).toBe("true");
    expect(alice.getAttribute("contenteditable")).toBe("false");
    expect(alice.style.getPropertyValue("--remote-hue")).toBe("200");
    expect((alice.firstElementChild as HTMLElement).style.getPropertyValue("--remote-label-lightness")).toMatch(/%$/u);
    expect(editor.view.dom.querySelector(".note-remote-selection")?.textContent).toBe("Fi");
    expect(editor.view.dom.querySelector('[data-note-peer-caret="bob"]')?.childElementCount).toBe(0);
  });

  it("follows local typing and keeps a position whose report has not changed", () => {
    const editor = build("First line.\n\nSecond.\n");
    setNotePeerCarets(editor, [caret("alice", 4)], (offset) => offset);
    editor.commands.insertContentAt(1, "Big ");
    expect(peerCaretsOf(editor.state)[0].head).toBe(8);
    let placed = 0;
    setNotePeerCarets(editor, [caret("alice", 4)], (offset) => {
      placed += 1;
      return offset;
    });
    expect(placed).toBe(0);
    expect(peerCaretsOf(editor.state)[0].head).toBe(8);
    setNotePeerCarets(editor, [caret("alice", 6)], (offset) => offset);
    expect(peerCaretsOf(editor.state)[0].head).toBe(6);
    setNotePeerCarets(editor, [caret("alice", 6), caret("bob", 2)], (offset) => offset);
    setNotePeerCarets(editor, [caret("alice", 6), caret("bob", 2)], (offset) => offset + 2, new Set(["alice"]));
    expect(peerCaretsOf(editor.state).map((placed) => [placed.id, placed.head])).toEqual([
      ["alice", 8],
      ["bob", 2],
    ]);
  });

  it("clamps places outside the note, skips unchanged updates and clears", () => {
    const editor = build("Hi.\n");
    const size = editor.state.doc.content.size;
    setNotePeerCarets(editor, [caret("bob", Number.NaN)], (offset) => offset);
    expect(peerCaretsOf(editor.state)[0].head).toBe(0);
    setNotePeerCarets(editor, [caret("alice", 999, -5)], (offset) => offset);
    expect(peerCaretsOf(editor.state)[0]).toMatchObject({ head: size, anchor: 0 });
    const before = editor.state;
    setNotePeerCarets(editor, [caret("alice", 999, -5)], (offset) => offset);
    expect(editor.state).toBe(before);
    setNotePeerCarets(editor, [], () => 0);
    expect(peerCaretsOf(editor.state)).toEqual([]);
    expect(editor.view.dom.querySelector("[data-note-peer-caret]")).toBeNull();
  });

  it("renames and recolours a kept caret without moving it", () => {
    const editor = build("First line.\n");
    const doc = editor.state.doc;
    const placed = placeNotePeerCarets(doc, [], [caret("alice", 3)], (offset) => offset);
    const next = placeNotePeerCarets(doc, [{ ...placed[0], head: 5, anchor: 5 }], [{ ...caret("alice", 3), name: "Alice", hue: 40 }], () => 1);
    expect(next[0]).toMatchObject({ head: 5, anchor: 5, name: "Alice", hue: 40 });
  });
});

describe("collaborators drawn with a document change", () => {
  const caret = (id: string, head: number) => ({ id, name: `Person ${id}`, hue: 200, head, anchor: head });

  it("adds marks and carets to the change's own transaction and leaves out what the change already moved", () => {
    const editor = build("First.\n\nSecond.\n");
    setNotePeerMarks(editor, [{ id: "alice", name: "Alice", hue: 10, index: 1 }]);
    setNotePeerCarets(editor, [caret("bob", 10)], (offset) => offset);
    let dispatched = 0;
    editor.on("transaction", () => {
      dispatched += 1;
    });
    const unchanged = editor.state.tr.insertText("Big ", 1);
    expect(setNotePeerMarks(editor, [{ id: "alice", name: "Alice", hue: 10, index: 1 }], unchanged)).toBe(false);
    expect(setNotePeerCarets(editor, [caret("bob", 10)], (offset) => offset, undefined, unchanged)).toBe(false);
    expect(dispatched).toBe(0);
    const tr = editor.state.tr.insertText("Big ", 1);
    expect(setNotePeerMarks(editor, [{ id: "carol", name: "Carol", hue: 90, index: 0 }], tr)).toBe(true);
    expect(setNotePeerCarets(editor, [caret("bob", 3)], (offset) => offset, new Set(["bob"]), tr)).toBe(true);
    expect(setNotePeerMarks(editor, [{ id: "carol", name: "Carol", hue: 90, index: 0 }], tr)).toBe(false);
    expect(dispatched).toBe(0);
    editor.view.dispatch(tr);
    expect(dispatched).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("Big First.");
    expect(peerMarksOf(editor.state).map((mark) => [mark.id, mark.pos])).toEqual([["carol", 0]]);
    expect(peerCaretsOf(editor.state).map((placed) => [placed.id, placed.head])).toEqual([["bob", 3]]);
  });
});
