// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { createWysiwygExtensions, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { afterEach, describe, expect, it } from "vitest";
import { diffNoteDocs } from "./note-diff";
import { applyNoteEdits } from "./note-edits";
import {
  acceptActive,
  acceptAll,
  docWithPending,
  hasPending,
  moveReview,
  NoteSuggestions,
  rejectActive,
  rejectAll,
  reviewSummary,
  showSuggestions,
} from "./note-suggestions";

const BODY = `## Results

The encoder trains with a mask ratio of 0.75 and run 3 reached 64.1%.

Masks are sampled per pixel.

| Run | Ratio |
| --- | --- |
| 1 | 0.75 |
`;

let editors: Editor[] = [];

function build(body = BODY): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...createWysiwygExtensions(), NoteSuggestions],
    content: parseMarkdownBody(body).doc,
  });
  editors.push(editor);
  return editor;
}

function propose(editor: Editor, text: string, origin: "agent" | "disk" = "agent") {
  const drafts = diffNoteDocs(editor.state.doc, editor.schema.nodeFromJSON(parseMarkdownBody(text).doc));
  showSuggestions(editor, drafts, origin);
  return drafts;
}

function markdown(editor: Editor): string {
  return serializeMarkdownBody(editor.getJSON());
}

function normalized(text: string): string {
  const editor = build(text);
  return markdown(editor);
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe("note changes", () => {
  it("finds nothing when the proposal matches the note", () => {
    const editor = build();
    expect(propose(editor, BODY)).toEqual([]);
  });

  it("shows word changes inside a paragraph without touching the document", () => {
    const editor = build();
    const before = editor.state.doc.toJSON();
    const proposed = BODY.replace("0.75 and", "0.60 and");
    const drafts = propose(editor, proposed);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: "text", text: "0.60 " });
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(editor.view.dom.querySelector(".note-diff-delete")?.textContent).toBe("0.75 ");
    expect(editor.view.dom.querySelector(".note-diff-insert")?.textContent).toBe("0.60 ");
  });

  it.each([
    ["a changed word", BODY.replace("per pixel", "per patch")],
    ["a new paragraph", BODY.replace("Masks are", "Run 3 is the first run with the lower ratio.\n\nMasks are")],
    ["a removed paragraph", BODY.replace("Masks are sampled per pixel.\n\n", "")],
    ["a changed table", BODY.replace("| 1 | 0.75 |", "| 1 | 0.75 |\n| 3 | 0.60 |")],
    ["a heading turned into text", BODY.replace("## Results", "Results")],
    ["bold text", BODY.replace("per pixel", "**per patch**")],
    ["several edits at once", BODY.replace("0.75 and", "0.60 and").replace("## Results", "## Where things stand")],
  ])("reaches the proposal when every change for %s is accepted", (_name, proposed) => {
    const editor = build();
    propose(editor, proposed);
    expect(reviewSummary(editor).count).toBeGreaterThan(0);
    acceptAll(editor);
    expect(markdown(editor)).toBe(normalized(proposed));
    expect(reviewSummary(editor).count).toBe(0);
  });

  it("keeps the note as it was when every change is rejected", () => {
    const editor = build();
    const before = markdown(editor);
    propose(editor, BODY.replace("0.75 and", "0.60 and").replace("Masks are", "New.\n\nMasks are"));
    rejectAll(editor);
    expect(markdown(editor)).toBe(before);
  });

  it("accepts and rejects one change at a time and steps between them", () => {
    const editor = build();
    propose(editor, BODY.replace("0.75 and", "0.60 and").replace("per pixel", "per patch"));
    expect(reviewSummary(editor)).toMatchObject({ count: 2, index: 0 });
    moveReview(editor, -1);
    expect(reviewSummary(editor).index).toBe(1);
    moveReview(editor, 1);
    acceptActive(editor);
    expect(markdown(editor)).toContain("mask ratio of 0.60 and");
    rejectActive(editor);
    expect(markdown(editor)).toContain("per pixel");
    expect(reviewSummary(editor).count).toBe(0);
  });

  it("keeps a change on the right words after the person types above it", () => {
    const editor = build();
    propose(editor, BODY.replace("per pixel", "per patch"));
    editor.chain().insertContentAt(1, "Draft ").run();
    acceptAll(editor);
    expect(markdown(editor)).toContain("## Draft Results");
    expect(markdown(editor)).toContain("per patch");
  });

  it("drops a change when the person edits the same words", () => {
    const editor = build();
    propose(editor, BODY.replace("per pixel", "per patch"));
    const at = editor.state.doc.textContent.indexOf("pixel");
    let position = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes("pixel")) position = pos + (node.text.indexOf("pixel"));
    });
    expect(at).toBeGreaterThan(0);
    editor.chain().insertContentAt(position + 2, "x").run();
    expect(reviewSummary(editor).count).toBe(0);
  });

  it("keeps agent and disk changes apart and applies only disk ones to the saved text", () => {
    const editor = build();
    propose(editor, BODY.replace("per pixel", "per patch"), "agent");
    propose(editor, BODY.replace("0.75 and", "0.60 and"), "disk");
    expect(reviewSummary(editor).count).toBe(2);
    expect(hasPending(editor, "disk")).toBe(true);
    const saved = serializeMarkdownBody(docWithPending(editor, "disk").toJSON());
    expect(saved).toContain("0.60 and");
    expect(saved).toContain("per pixel");
    propose(editor, BODY, "disk");
    expect(hasPending(editor, "disk")).toBe(false);
    expect(hasPending(editor, "agent")).toBe(true);
  });
});

describe("agent edits", () => {
  it("applies each edit that matches the note once", () => {
    const result = applyNoteEdits(BODY, [
      { find: "per pixel", replace: "per patch" },
      { find: "0.75", replace: "0.60" },
      { find: "absent", replace: "x" },
    ]);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.text).toContain("per patch");
    expect(result.text).toContain("ratio of 0.75");
  });

  it("refuses overlapping edits and appends an edit with nothing to find", () => {
    const result = applyNoteEdits("One two three.\n", [
      { find: "One two", replace: "1 2" },
      { find: "two three", replace: "2 3" },
      { find: "", replace: "A new paragraph." },
    ]);
    expect(result).toEqual({ text: "1 2 three.\n\nA new paragraph.", applied: 2, skipped: 1 });
  });
});
