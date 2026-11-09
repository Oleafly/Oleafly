// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { DocAttrStep, ReplaceAroundStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadNamespace } from "@/i18n";
import { destroyKbEditors, kbEditor } from "./kb-test-editor";
import { noteLinkExtensions, type LinkableNote } from "./note-links";
import { noteTagExtensions } from "./note-tag-chips";
import { redecorateTextblocks, touchedTextblocks } from "./touched-textblocks";

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(destroyKbEditors);

const SOURCE = [
  "# Title with #heading-tag",
  "",
  "Paragraph one see [Alpha](oleafly://note/alpha) and #topic and [Project](oleafly://project/p-1).",
  "",
  "- item with [Beta](oleafly://note/beta) #listed",
  "- [Missing](oleafly://note/gone) and #ml/vision",
  "",
  "> quote #quoted with [Alpha](oleafly://note/alpha#part)",
  "",
  "```",
  "#fenced [x](oleafly://note/alpha)",
  "```",
  "",
  "| a | b |",
  "| - | - |",
  "| #cell | [Beta](oleafly://note/beta) |",
  "",
  "Last paragraph #end",
].join("\n");

const notes: LinkableNote[] = [
  { noteId: "alpha", projectId: "p-alpha", title: "Alpha", color: "#2563eb" },
  { noteId: "beta", projectId: "p-beta", title: "Beta" },
];

function decorationsOf(editor: Editor): string[] {
  const ours = editor.state.plugins.filter((plugin) => /^note(?:Links|Tags)\$/u.test((plugin as unknown as { key: string }).key));
  const plugins = ours.flatMap((plugin) => {
    const set = plugin.props.decorations?.call(plugin, editor.state);
    return set instanceof DecorationSet ? [set] : [];
  });
  return plugins
    .flatMap((set) => set.find())
    .map((decoration) => JSON.stringify([decoration.from, decoration.to, (decoration as unknown as { type: { attrs: unknown } }).type.attrs]))
    .sort();
}

function fresh(editor: Editor): string[] {
  const state = EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins });
  const view = { state } as unknown as Editor;
  return decorationsOf(view);
}

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

function randomEdit(editor: Editor, random: () => number): void {
  const { state } = editor;
  const size = state.doc.content.size;
  const pick = () => Math.floor(random() * size);
  const kind = Math.floor(random() * 7);
  const at = Math.max(1, Math.min(size - 1, pick()));
  const $at = state.doc.resolve(at);
  let tr: Transaction = state.tr;
  if (kind === 0 && $at.parent.isTextblock) tr = state.tr.insertText(random() < 0.5 ? " #new" : "x", at);
  else if (kind === 1) {
    const to = Math.min(size, at + 1 + Math.floor(random() * 6));
    try {
      tr = state.tr.delete(at, to);
    } catch {
      return;
    }
  } else if (kind === 2 && $at.parent.isTextblock) tr = state.tr.split(at);
  else if (kind === 3 && $at.parent.isTextblock && $at.parentOffset < $at.parent.content.size) {
    const link = state.schema.marks.link.create({ href: random() < 0.5 ? "oleafly://note/alpha" : "oleafly://note/zeta" });
    tr = state.tr.addMark(at, Math.min($at.end(), at + 3), link);
  } else if (kind === 4 && $at.parent.isTextblock) tr = state.tr.removeMark($at.start(), $at.end(), state.schema.marks.link);
  else if (kind === 5 && $at.parent.isTextblock) {
    tr = state.tr.insertText("#a", at).insertText("b ", at);
  } else if (kind === 6 && $at.depth > 0 && $at.parent.isTextblock) {
    try {
      tr = state.tr.join($at.before());
    } catch {
      return;
    }
  }
  if (!tr.docChanged) return;
  editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size)))));
}

function build(): Editor {
  return kbEditor(SOURCE, { callout: null }, [
    ...noteLinkExtensions({ getNotes: () => notes, getProjects: () => [{ projectId: "p-1", title: "P", color: "#16a34a" }], onOpenNote: () => {}, onOpenProject: () => {} }),
    ...noteTagExtensions({ getTags: () => [], getOpenTag: () => () => {} }),
  ]);
}

describe("incremental note decorations", () => {
  it("matches a full rebuild after every random edit", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const editor = build();
      const random = seeded(seed);
      for (let step = 0; step < 40; step += 1) {
        randomEdit(editor, random);
        expect(decorationsOf(editor)).toEqual(fresh(editor));
      }
    }
  }, 30_000);

  it("matches a full rebuild after wrapping, replacing everything and doc attribute steps", () => {
    const editor = build();
    const { state } = editor;
    const paragraph = state.doc.child(1);
    const start = state.doc.child(0).nodeSize;
    const end = start + paragraph.nodeSize;
    const wrap = state.tr.step(
      new ReplaceAroundStep(start, end, start, end, new Slice(Fragment.from(state.schema.nodes.blockquote.create()), 0, 0), 1, true),
    );
    editor.view.dispatch(wrap);
    expect(decorationsOf(editor)).toEqual(fresh(editor));
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Fresh #start" }] }] });
    expect(decorationsOf(editor)).toEqual(fresh(editor));
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, {}));
    expect(decorationsOf(editor)).toEqual(fresh(editor));
  });
});

describe("touchedTextblocks", () => {
  it("lists only the textblocks a transaction touched", () => {
    const editor = build();
    const tr = editor.state.tr.insertText("z", 3);
    expect(touchedTextblocks(tr)?.map((block) => block.pos)).toEqual([0]);
  });

  it("reports nothing it can place for steps without positions", () => {
    const editor = build();
    const tr = editor.state.tr.step(new DocAttrStep("lang", "en"));
    expect(touchedTextblocks(tr)).toBeNull();
    const set = DecorationSet.create(editor.state.doc, [Decoration.inline(1, 3, { class: "x" })]);
    expect(redecorateTextblocks(set, tr, () => [])).toBeNull();
  });

  it("keeps decorations outside the touched blocks and drops stale ones inside", () => {
    const editor = build();
    const doc = editor.state.doc;
    const outside = Decoration.inline(doc.child(0).nodeSize + 2, doc.child(0).nodeSize + 4, { class: "keep" });
    const inside = Decoration.inline(2, 4, { class: "stale" });
    const set = DecorationSet.create(doc, [outside, inside]);
    const tr = editor.state.tr.insertText("z", 3);
    const next = redecorateTextblocks(set, tr, () => []);
    expect(next?.find().map((decoration) => (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class)).toEqual(["keep"]);
  });
});
