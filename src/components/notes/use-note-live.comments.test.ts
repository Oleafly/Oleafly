// @vitest-environment jsdom
import { createMarkdownSourceSnapshot, type MarkdownSourceSnapshot } from "@oleafly/wysiwyg";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteCommentMarks } from "./note-comment-marks";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { createNoteLiveEditor } from "./use-note-live";

const SOURCE = `---
title: Lab
kind: note
---

# Lab notes

The encoder masks patches.

Lower ratios help.
`;

let editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

function host(text: string) {
  const parsed = parseNoteMarkdown(text);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...noteBaseExtensions(), NoteCommentMarks],
    content: parsed.doc,
  });
  editors.push(editor);
  const pad = {
    snapshot: createMarkdownSourceSnapshot(parsed.layout, editor.getJSON()) as MarkdownSourceSnapshot | null,
    frontMatter: parsed.frontmatter,
    sourceOf: (doc: ProseMirrorNode): string => {
      const body = serializeNoteMarkdown(doc.toJSON(), pad.snapshot);
      return pad.frontMatter ? `${pad.frontMatter}\n\n${body}` : body;
    },
    adopt: () => undefined,
  };
  return { editor, adapter: createNoteLiveEditor(editor, () => pad, text), source: () => pad.sourceOf(editor.state.doc) };
}

function offsets(text: string, word: string): { from: number; to: number } {
  const from = text.indexOf(word);
  if (from < 0) throw new Error(`no ${word}`);
  return { from, to: from + word.length };
}

function wordAt(editor: Editor, word: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text?.indexOf(word) ?? -1) : -1;
    if (!found && at >= 0) found = { from: pos + at, to: pos + at + word.length };
  });
  if (!found) throw new Error(`no ${word}`);
  return found;
}

describe("comments in a live note editor", () => {
  it("draws threads given in offsets into the note's Markdown on the right words", () => {
    const { editor, adapter } = host(SOURCE);
    adapter.setComments?.({
      spans: [{ id: "t1", resolved: false, ...offsets(SOURCE, "masks") }],
      selected: "t1",
      draft: offsets(SOURCE, "ratios"),
    });
    expect(editor.view.dom.querySelector('[data-note-comment="t1"]')?.textContent).toBe("masks");
    expect(editor.view.dom.querySelector("[data-note-comment-draft]")?.textContent).toBe("ratios");
  });

  it("draws threads set inside a batch once the batch ends", () => {
    const { editor, adapter } = host(SOURCE);
    adapter.batch(() => {
      adapter.setComments?.({ spans: [{ id: "t1", resolved: false, ...offsets(SOURCE, "patches") }], selected: null, draft: null });
      expect(editor.view.dom.querySelector("[data-note-comment]")).toBeNull();
    });
    expect(editor.view.dom.querySelector('[data-note-comment="t1"]')?.textContent).toBe("patches");
  });

  it("offers the selection as a comment target in Markdown offsets, and nothing for an empty or blank selection", () => {
    const { editor, adapter } = host(SOURCE);
    editor.commands.setTextSelection(wordAt(editor, "Lower ratios"));
    expect(adapter.commentTarget?.()).toEqual({ ...offsets(SOURCE, "Lower ratios"), quote: "Lower ratios" });
    editor.commands.setTextSelection(wordAt(editor, "Lower").from);
    expect(adapter.commentTarget?.()).toBeNull();
  });

  it("reports the draft where it is now, after the person typed before it", () => {
    const { editor, adapter, source } = host(SOURCE);
    expect(adapter.commentDraft?.()).toBeNull();
    adapter.setComments?.({ spans: [], selected: null, draft: offsets(SOURCE, "ratios") });
    editor.commands.setTextSelection(wordAt(editor, "Lower").from);
    editor.commands.insertContent("Much ");
    const now = source();
    expect(now).toContain("Much Lower ratios help.");
    expect(adapter.commentDraft?.()).toEqual(offsets(now, "ratios"));
  });

  it("reveals a thread it draws", () => {
    const { adapter } = host(SOURCE);
    Element.prototype.scrollIntoView = vi.fn();
    adapter.setComments?.({ spans: [{ id: "t1", resolved: false, ...offsets(SOURCE, "masks") }], selected: null, draft: null });
    expect(adapter.revealComment?.("t1")).toBe(true);
    expect(adapter.revealComment?.("t2")).toBe(false);
  });
});
