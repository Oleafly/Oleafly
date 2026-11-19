// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installNoteCommentOpener } from "@/lib/collab-live-bridge";
import { NoteCommentMarks, noteCommentsOf, revealNoteComment, setNoteComments } from "./note-comment-marks";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";

let editors: Editor[] = [];
let releases: (() => void)[] = [];

function build(text: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...noteBaseExtensions(), NoteCommentMarks],
    content: parseNoteMarkdown(text).doc,
  });
  editors.push(editor);
  return editor;
}

function rangeOf(editor: Editor, text: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return;
    const at = node.text?.indexOf(text) ?? -1;
    if (at >= 0) found = { from: pos + at, to: pos + at + text.length };
  });
  if (!found) throw new Error(`no ${text}`);
  return found;
}

function opener() {
  const open = vi.fn();
  releases.push(installNoteCommentOpener(open));
  return open;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  for (const release of releases) release();
  editors = [];
  releases = [];
});

describe("comment ranges in a shared note", () => {
  it("tints each open thread's text, the selected one darker, and writes nothing into the note", () => {
    const editor = build("The encoder masks patches.\n\nLower ratios help.\n");
    const before = serializeNoteMarkdown(editor.getJSON());
    setNoteComments(editor, {
      spans: [
        { id: "t1", resolved: false, ...rangeOf(editor, "encoder") },
        { id: "t2", resolved: false, ...rangeOf(editor, "ratios") },
      ],
      selected: "t2",
      draft: null,
    });
    const ranges = [...editor.view.dom.querySelectorAll<HTMLElement>("[data-note-comment]")];
    expect(ranges.map((range) => [range.dataset.noteComment, range.textContent])).toEqual([
      ["t1", "encoder"],
      ["t2", "ratios"],
    ]);
    expect(ranges[0].getAttribute("style")).toContain("var(--comment-highlight)");
    expect(ranges[1].getAttribute("style")).toContain("var(--comment-active)");
    expect(serializeNoteMarkdown(editor.getJSON())).toBe(before);
  });

  it("leaves resolved threads untinted and draws the draft range", () => {
    const editor = build("The encoder masks patches.\n");
    setNoteComments(editor, {
      spans: [{ id: "t1", resolved: true, ...rangeOf(editor, "encoder") }],
      selected: null,
      draft: rangeOf(editor, "patches"),
    });
    expect(editor.view.dom.querySelector("[data-note-comment]")).toBeNull();
    expect(editor.view.dom.querySelector("[data-note-comment-draft]")?.textContent).toBe("patches");
    expect(editor.view.dom.querySelector("[data-note-comment-marker]")).toBeNull();
  });

  it("puts one margin marker on each block with open threads, counting them", () => {
    const editor = build("The encoder masks patches.\n\nLower ratios help.\n");
    setNoteComments(editor, {
      spans: [
        { id: "t1", resolved: false, ...rangeOf(editor, "encoder") },
        { id: "t2", resolved: false, ...rangeOf(editor, "patches") },
        { id: "t3", resolved: false, ...rangeOf(editor, "ratios") },
      ],
      selected: null,
      draft: null,
    });
    const markers = [...editor.view.dom.querySelectorAll<HTMLElement>("[data-note-comment-marker]")];
    expect(markers.map((marker) => [marker.dataset.noteCommentMarker, marker.textContent])).toEqual([
      ["t1 t2", "2"],
      ["t3", ""],
    ]);
  });

  it("keeps ranges on their words while the note is edited before and inside them", () => {
    const editor = build("The encoder masks patches.\n");
    setNoteComments(editor, { spans: [{ id: "t1", resolved: false, ...rangeOf(editor, "masks") }], selected: null, draft: null });
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("Now ");
    const moved = noteCommentsOf(editor.state).spans[0];
    expect(editor.state.doc.textBetween(moved.from, moved.to)).toBe("masks");
    editor.commands.setTextSelection(moved.to);
    editor.commands.insertContent("!");
    const after = noteCommentsOf(editor.state).spans[0];
    expect(editor.state.doc.textBetween(after.from, after.to)).toBe("masks");
  });

  it("skips an update that changes nothing", () => {
    const editor = build("The encoder masks patches.\n");
    const view = { spans: [{ id: "t1", resolved: false, ...rangeOf(editor, "masks") }], selected: null, draft: null };
    expect(setNoteComments(editor, view)).toBe(true);
    const state = editor.state;
    expect(setNoteComments(editor, { ...view, spans: [...view.spans] })).toBe(false);
    expect(editor.state).toBe(state);
  });

  it("opens the thread under a click and the first thread of a clicked marker", () => {
    const open = opener();
    const editor = build("The encoder masks patches.\n");
    const range = rangeOf(editor, "masks");
    setNoteComments(editor, { spans: [{ id: "t1", resolved: false, ...range }], selected: null, draft: null });
    editor.view.someProp("handleClick", (handle) => handle(editor.view, range.from + 1, new MouseEvent("click")));
    expect(open).toHaveBeenLastCalledWith("t1", "text");
    editor.view.someProp("handleClick", (handle) => handle(editor.view, 2, new MouseEvent("click")));
    expect(open).toHaveBeenCalledTimes(1);
    editor.view.dom
      .querySelector("[data-note-comment-marker]")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(open).toHaveBeenLastCalledWith("t1", "marker");
  });

  it("reveals a known thread and reports an unknown one", () => {
    const editor = build("The encoder masks patches.\n");
    setNoteComments(editor, { spans: [{ id: "t1", resolved: false, ...rangeOf(editor, "masks") }], selected: null, draft: null });
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    expect(revealNoteComment(editor, "t1")).toBe(true);
    expect(scroll).toHaveBeenCalled();
    expect(revealNoteComment(editor, "missing")).toBe(false);
  });
});
