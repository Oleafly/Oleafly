// @vitest-environment jsdom
import { createMarkdownSourceSnapshot, markdownBlockKey, type MarkdownSourceSnapshot } from "@oleafly/wysiwyg";
import { Editor } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextOperation } from "@/features/collab/live/ot";
import { RemoteDocumentSession } from "@/features/collab/live/remote-session";
import { FakeChannel } from "@/features/collab/live/tests/fake-channel";
import { NoteLiveBinding, type NoteLiveClock } from "@/features/collab/notes/note-live";
import {
  blockAtOffset,
  blockIndexAt,
  blockPosition,
  isRemoteTransaction,
  mergedDoc,
  parseSharedNote,
  type SharedNote,
  sharedNoteTransaction,
  showNoteDoc,
} from "./note-live-doc";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { NotePeerMarks } from "./note-presence-decorations";
import { NoteSuggestions } from "./note-suggestions";
import { createNoteLiveEditor } from "./use-note-live";
import { propertySeeds } from "./tests/property-seeds";

const NOTE = `---
title: Lab
kind: note
---

# Lab notes

First paragraph with *emphasis* and a [link](https://example.com).

- item one
- item two

Last paragraph.
`;

let editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

class Pad {
  readonly editor: Editor;
  snapshot: MarkdownSourceSnapshot | null;
  frontMatter: string;
  readonly adopted: string[] = [];

  constructor(text: string) {
    const parsed = parseNoteMarkdown(text);
    this.editor = new Editor({
      element: document.createElement("div"),
      extensions: [...noteBaseExtensions(), NoteSuggestions, NotePeerMarks],
      content: parsed.doc,
    });
    editors.push(this.editor);
    this.frontMatter = parsed.frontmatter;
    this.snapshot = createMarkdownSourceSnapshot(parsed.layout, this.editor.getJSON());
  }

  sourceOf = (doc: ProseMirrorNode): string => {
    const body = serializeNoteMarkdown(doc.toJSON(), this.snapshot);
    return this.frontMatter ? `${this.frontMatter}\n\n${body}` : body;
  };

  text(): string {
    return this.sourceOf(this.editor.state.doc);
  }

  adopt = ({ frontmatter, snapshot }: { frontmatter: string; snapshot: MarkdownSourceSnapshot | null }) => {
    this.snapshot = snapshot;
    if (frontmatter !== this.frontMatter) this.adopted.push(frontmatter);
    this.frontMatter = frontmatter;
  };
}

class Clock implements NoteLiveClock {
  timers: { run: () => void; live: boolean }[] = [];
  micro: (() => void)[] = [];

  later(run: () => void): () => void {
    const timer = { run, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }

  soon(run: () => void): void {
    this.micro.push(run);
  }

  pending(): { run: () => void; live: boolean }[] {
    this.timers = this.timers.filter((timer) => timer.live);
    return this.timers;
  }

  fire(index: number): void {
    const timer = this.pending()[index];
    if (!timer) return;
    timer.live = false;
    timer.run();
  }

  settle(): void {
    while (this.micro.length > 0) this.micro.shift()?.();
  }
}

function rng(seed: number): (bound: number) => number {
  let state = seed >>> 0;
  return (bound) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296) * bound);
  };
}

interface Peer {
  pad: Pad;
  session: RemoteDocumentSession;
  binding: NoteLiveBinding;
  id: string;
  errors: unknown[];
}

async function join(channel: FakeChannel, clock: Clock): Promise<Peer> {
  const pad = new Pad(channel.text);
  const session = new RemoteDocumentSession("note.md", channel.text, { transport: channel.transport() });
  const editor = createNoteLiveEditor(pad.editor, () => pad, channel.text);
  const errors: unknown[] = [];
  const binding = new NoteLiveBinding({
    session,
    editor,
    clock,
    baseline: pad.text(),
    onError: (error) => errors.push(error),
  });
  binding.start();
  await session.open();
  clock.settle();
  return { pad, session, binding, id: channel.opens.at(-1) ?? "", errors };
}

const WORDS = ["alpha ", "beta", " gamma", "x", "😀", "é"];

function randomEdit(pad: Pad, below: (bound: number) => number): void {
  const { editor } = pad;
  const size = editor.state.doc.content.size;
  const at = TextSelection.near(editor.state.doc.resolve(1 + below(Math.max(1, size - 1)))).from;
  const choice = below(10);
  editor.commands.setTextSelection(at);
  if (choice < 6) {
    editor.commands.insertContent(WORDS[below(WORDS.length)]);
  } else if (choice < 8) {
    const { $from } = editor.state.selection;
    const end = Math.min($from.end(), at + 1 + below(4));
    if (end > at) editor.commands.deleteRange({ from: at, to: end });
  } else if (choice < 9) {
    editor.commands.splitBlock();
  } else {
    editor.commands.joinBackward();
  }
}

function quiet(channel: FakeChannel, clock: Clock, peers: readonly Peer[]): void {
  for (let round = 0; round < 100; round += 1) {
    while (clock.pending().length > 0) clock.fire(0);
    clock.settle();
    channel.drain();
    clock.settle();
    if (clock.pending().length === 0 && channel.inbox.length === 0 && peers.every((peer) => channel.pendingFor(peer.id) === 0)) return;
  }
  throw new Error("The editors never settled.");
}

function showSharedNote(editor: Editor, base: SharedNote | null, next: SharedNote): void {
  const tr = sharedNoteTransaction(editor.state, base, next);
  if (tr) editor.view.dispatch(tr);
}

function shape(doc: ProseMirrorNode): string[] {
  const out: string[] = [];
  doc.descendants((node, _pos, parent) => {
    if (!node.isTextblock) return true;
    const text = node.textContent.replaceAll(/\s+/gu, " ").trim();
    if (text) out.push(`${parent?.type.name ?? ""}/${node.type.name}:${text}`);
    return false;
  });
  return out;
}

describe("live note editors", () => {
  it("converge with real Tiptap editors for 40 seeded random sessions", async () => {
    let exact = 0;
    const runs = propertySeeds(40, 4);
    for (let seed = 1; seed <= runs; seed += 1) {
      const below = rng(seed);
      const channel = new FakeChannel(NOTE);
      const clock = new Clock();
      const peers = [await join(channel, clock), await join(channel, clock)];
      const steps = 20 + below(20);
      for (let step = 0; step < steps; step += 1) {
        const roll = below(100);
        if (roll < 40) {
          const peer = peers[below(peers.length)];
          randomEdit(peer.pad, below);
          peer.binding.localChanged();
        } else if (roll < 60) {
          clock.fire(below(Math.max(1, clock.pending().length)));
        } else if (roll < 80) {
          channel.receiveOne();
        } else {
          channel.deliverOne(peers[below(peers.length)].id);
        }
        clock.settle();
      }
      quiet(channel, clock, peers);
      const expected = shape(parseSharedNote(peers[0].pad.editor.schema, channel.text).doc);
      for (const peer of peers) {
        expect(peer.errors, `seed ${seed}`).toEqual([]);
        expect(peer.session.text(), `seed ${seed}`).toBe(channel.text);
        expect(shape(parseSharedNote(peer.pad.editor.schema, peer.pad.text()).doc), `seed ${seed}`).toEqual(expected);
        if (peer.pad.text() === channel.text) exact += 1;
      }
      expect(channel.text.startsWith("---\ntitle: Lab\nkind: note\n---\n"), `seed ${seed}`).toBe(true);
    }
    expect(exact / (runs * 2)).toBeGreaterThanOrEqual(0.95);
  }, 120_000);

  it("never sends serializer changes to blocks nobody edited", async () => {
    const source = "Intro with __strong__ text.\n\n* star bullet\n* second\n\nTail.\n";
    const channel = new FakeChannel(source);
    const clock = new Clock();
    const peer = await join(channel, clock);
    const tail = peer.pad.editor.state.doc.content.size - 1;
    peer.pad.editor.commands.setTextSelection(tail);
    peer.pad.editor.commands.insertContent("!");
    peer.binding.localChanged();
    quiet(channel, clock, [peer]);
    expect(channel.text).toBe("Intro with __strong__ text.\n\n* star bullet\n* second\n\nTail.!\n");
  });

  it("shows a collaborator's edit without adding it to undo history", async () => {
    const channel = new FakeChannel("One.\n\nTwo.\n");
    const clock = new Clock();
    const [alice, bob] = [await join(channel, clock), await join(channel, clock)];
    alice.pad.editor.commands.setTextSelection(5);
    alice.pad.editor.commands.insertContent("A");
    alice.binding.localChanged();
    quiet(channel, clock, [alice, bob]);
    bob.pad.editor.commands.setTextSelection(bob.pad.editor.state.doc.content.size - 1);
    bob.pad.editor.commands.insertContent("B");
    bob.binding.localChanged();
    quiet(channel, clock, [alice, bob]);
    expect(alice.pad.text()).toBe("One.A\n\nTwo.B\n");
    alice.pad.editor.commands.undo();
    expect(alice.pad.text()).toBe("One.\n\nTwo.B\n");
  });

  it("keeps the caret in place when a collaborator edits another block", () => {
    const pad = new Pad("First line.\n\nSecond line here.\n");
    const second = pad.editor.state.doc.child(0).nodeSize + 1 + 7;
    pad.editor.commands.setTextSelection(second);
    const base = parseSharedNote(pad.editor.schema, "First line.\n\nSecond line here.\n");
    const next = parseSharedNote(pad.editor.schema, "First line, longer now.\n\nSecond line here.\n");
    showSharedNote(pad.editor, base, next);
    const { head } = pad.editor.state.selection;
    expect(pad.editor.state.doc.textBetween(head - 7, head)).toBe("Second ");
  });

  it("puts the caret back at its text offset when its block is replaced", () => {
    const pad = new Pad("- apple pie\n- banana\n\nAfter.\n");
    const list = pad.editor.state.doc.child(0);
    let target = 0;
    list.descendants((node, pos) => {
      if (node.isText && node.text === "banana") target = 1 + pos + 3;
    });
    pad.editor.commands.setTextSelection(target);

    const base = parseSharedNote(pad.editor.schema, "- apple pie\n- banana\n\nAfter.\n");
    const next = parseSharedNote(pad.editor.schema, "- apple tart\n- banana\n\nAfter.\n");
    showSharedNote(pad.editor, base, next);
    const { head } = pad.editor.state.selection;
    expect(pad.editor.state.doc.textBetween(head - 3, head + 3)).toBe("banana");
    expect(pad.editor.state.doc.child(0).textContent).toBe("apple tartbanana");
  });

  it("keeps the caret near its old place when the whole document is replaced", () => {
    const pad = new Pad("A.\n\nB.\n\nC.\n");
    const third = pad.editor.state.doc.child(0).nodeSize + pad.editor.state.doc.child(1).nodeSize + 2;
    pad.editor.commands.setTextSelection(third);
    const target = parseSharedNote(pad.editor.schema, "X.\n\nY.\n\nZ.\n").doc;
    const replaced = pad.editor.schema.topNodeType.create(null, target.content);
    const dispatched: boolean[] = [];
    pad.editor.on("transaction", ({ transaction }) => dispatched.push(isRemoteTransaction(transaction)));
    showNoteDoc(pad.editor, replaced);
    expect(dispatched).toEqual([true]);
    expect(blockIndexAt(pad.editor.state.doc, pad.editor.state.selection.head)).toBe(2);
  });

  it("replaces only the blocks that differ when the block changes do not reproduce the target", async () => {
    const diff = await import("./note-diff");
    const pad = new Pad("A.\n\nB.\n\nC.\n");
    pad.editor.commands.setTextSelection(2);
    pad.editor.commands.insertContent("x");
    const [first, second] = [pad.editor.state.doc.child(0), pad.editor.state.doc.child(1)];
    pad.editor.commands.setTextSelection(pad.editor.state.doc.content.size - 1);
    const spy = vi.spyOn(diff, "diffNoteDocs").mockReturnValueOnce([]);
    try {
      showNoteDoc(pad.editor, parseSharedNote(pad.editor.schema, "Ax.\n\nB.\n\nC!\n\nD.\n").doc);
    } finally {
      spy.mockRestore();
    }
    expect(pad.text()).toBe("Ax.\n\nB.\n\nC!\n\nD.\n");
    expect(pad.editor.state.doc.child(0)).toBe(first);
    expect(pad.editor.state.doc.child(1)).toBe(second);
    expect(blockIndexAt(pad.editor.state.doc, pad.editor.state.selection.head)).toBe(2);
    pad.editor.commands.undo();
    expect(pad.text()).toBe("A.\n\nB.\n\nC!\n\nD.\n");
  });

  it("keeps a paragraph the serializer cannot round trip when someone edits elsewhere", () => {
    const pad = new Pad("Typing here.\n\nOther.\n");
    pad.editor.commands.setTextSelection(pad.editor.state.doc.child(0).nodeSize - 1);
    pad.editor.commands.insertContent(" ");
    const typed = pad.editor.state.doc.child(0).textContent;
    const base = parseSharedNote(pad.editor.schema, "Typing here. \n\nOther.\n");
    const next = parseSharedNote(pad.editor.schema, "Typing here. \n\nOther, changed.\n");
    showSharedNote(pad.editor, base, next);
    expect(pad.editor.state.doc.child(0).textContent).toBe(typed);
    expect(pad.editor.state.doc.child(1).textContent).toBe("Other, changed.");
  });

  it("takes the shared document when the merged blocks are not a valid document", () => {
    const pad = new Pad("One.\n");
    const base = parseSharedNote(pad.editor.schema, "One.\n");
    const next = parseSharedNote(pad.editor.schema, "Two.\n");
    const unchanged = { ...next, doc: next.doc, sources: next.sources };
    expect(mergedDoc(unchanged, pad.editor.state.doc.type.create(null, []), next)).toBe(next.doc);
    expect(base.doc.childCount).toBe(1);
  });

  it("refreshes front matter facts from remote text", async () => {
    const channel = new FakeChannel(NOTE);
    const clock = new Clock();
    const peer = await join(channel, clock);
    const at = NOTE.indexOf("Lab\n");
    channel.remote(new TextOperation().retain(at).insert("Bench ").retain(NOTE.length - at));
    channel.drain();
    clock.settle();
    expect(peer.pad.adopted.at(-1)).toContain("title: Bench Lab");
    expect(peer.pad.text()).toBe(channel.text);
  });

  it("leaves a node selection to ordinary mapping", () => {
    const pad = new Pad("One.\n\nTwo.\n");
    pad.editor.view.dispatch(pad.editor.state.tr.setSelection(NodeSelection.create(pad.editor.state.doc, 0)));
    showSharedNote(pad.editor, parseSharedNote(pad.editor.schema, "One.\n\nTwo.\n"), parseSharedNote(pad.editor.schema, "One.\n\nTwo, edited.\n"));
    expect(pad.editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(pad.editor.state.doc.child(1).textContent).toBe("Two, edited.");
  });

  it("restores a caret that sat between blocks of a replaced list", () => {
    const pad = new Pad("- one\n- two\n\nEnd.\n");
    pad.editor.view.dispatch(pad.editor.state.tr.setSelection(TextSelection.create(pad.editor.state.doc, 4)));
    showSharedNote(pad.editor, parseSharedNote(pad.editor.schema, "- one\n- two\n\nEnd.\n"), parseSharedNote(pad.editor.schema, "- uno\n- two\n\nEnd.\n"));
    expect(blockIndexAt(pad.editor.state.doc, pad.editor.state.selection.head)).toBe(0);
    expect(pad.editor.state.doc.child(0).textContent).toBe("unotwo");
  });

  it("maps text offsets to blocks and back", () => {
    const pad = new Pad("# Head\n\nPara one.\n\nPara two.\n");
    const note = parseSharedNote(pad.editor.schema, "# Head\n\nPara one.\n\nPara two.\n");
    expect(note.starts).toEqual([0, 8, 19]);
    expect(blockAtOffset(note.starts, 0)).toBe(0);
    expect(blockAtOffset(note.starts, 10)).toBe(1);
    expect(blockAtOffset(note.starts, 999)).toBe(2);
    expect(blockAtOffset([], 4)).toBe(0);
    const third = blockPosition(pad.editor.state.doc, 2);
    expect(pad.editor.state.doc.nodeAt(third)?.textContent).toBe("Para two.");
    expect(blockPosition(pad.editor.state.doc, 99)).toBe(third);
    expect(blockIndexAt(pad.editor.state.doc, third + 2)).toBe(2);
  });

  it("gives every block a start even without a source layout", () => {
    const pad = new Pad("Plain.\n");
    const note = parseSharedNote(pad.editor.schema, "");
    expect(note.starts).toHaveLength(note.doc.childCount);
    expect(note.sources.every((source) => source === "")).toBe(true);
  });

  it("shows a remote edit without writing the whole note out again and reuses its snapshot", () => {
    const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index}.`);
    const start = `${paragraphs.join("\n\n")}\n`;
    const first = start.replace("Paragraph 5.", "Paragraph 5, edited.");
    const second = first.replace("Paragraph 20.", "Paragraph 20, edited.");
    const pad = new Pad(start);
    const adopted: (MarkdownSourceSnapshot | null)[] = [];
    const host = {
      sourceOf: pad.sourceOf,
      adopt: (shared: { text: string; frontmatter: string; snapshot: MarkdownSourceSnapshot | null }) => {
        pad.adopt(shared);
        adopted.push(shared.snapshot);
      },
    };
    const editor = createNoteLiveEditor(pad.editor, () => host, start);
    editor.show(start, first, false);
    const note = editor.parse(second);
    const toJSON = vi.spyOn(ProseMirrorNode.prototype, "toJSON");
    try {
      editor.show(first, second, false);
      const written = toJSON.mock.contexts as ProseMirrorNode[];
      expect(written.filter((node) => node.type.name === "doc")).toEqual([]);
      expect(written.filter((node) => node.type.name === "paragraph").length).toBeLessThan(10);
    } finally {
      toJSON.mockRestore();
    }
    expect(pad.text()).toBe(second);
    const blocks: ProseMirrorNode[] = [];
    note.doc.forEach((block) => {
      blocks.push(block);
    });
    expect(adopted.at(-1)).toEqual(createMarkdownSourceSnapshot(note.layout, note.doc.toJSON(), blocks.map(markdownBlockKey)));
    editor.show(first, second, false);
    expect(adopted.at(-1)).toBe(adopted.at(-2));
  });
});
