// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diffNoteDocs } from "./note-diff";
import { applyNoteEdits } from "./note-edits";
import { parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { destroyKbEditors, kbEditor, kbMarkdown, positionOf, pressKey, typeBefore } from "./tests/kb-editor-fixtures";
import {
  acceptActive,
  acceptAll,
  docWithPending,
  hasPending,
  canUndoReject,
  isReviewNavigation,
  isReviewTransaction,
  moveReview,
  NoteSuggestions,
  rejectActive,
  rejectAll,
  reviewSummary,
  showSuggestions,
  undoReject,
} from "./note-suggestions";
import { resetRemoteImagesForTest } from "@/lib/remote-image";
import "./tests/setup";

const BODY = `## Results

The encoder trains with a mask ratio of 0.75 and run 3 reached 64.1%.

Masks are sampled per pixel.

| Run | Ratio |
| --- | --- |
| 1 | 0.75 |
`;

function build(body = BODY): Editor {
  return kbEditor(body, null, [NoteSuggestions]);
}

function propose(editor: Editor, text: string, origin: "agent" | "disk" = "agent") {
  const drafts = diffNoteDocs(editor.state.doc, editor.schema.nodeFromJSON(parseNoteMarkdown(text).doc));
  showSuggestions(editor, drafts, origin);
  return drafts;
}

const markdown = kbMarkdown;

function normalized(text: string): string {
  return markdown(build(text));
}

afterEach(() => {
  destroyKbEditors();
  resetRemoteImagesForTest();
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
    expect(drafts[0]).toMatchObject({ kind: "text", text: "0.60" });
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(editor.view.dom.querySelector(".note-diff-delete")?.textContent).toBe("0.75");
    expect(editor.view.dom.querySelector(".note-diff-insert")?.textContent).toBe("0.60");
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

  it("keeps a change and compares it again when the person types inside it", () => {
    const editor = build();
    propose(editor, BODY.replace("per pixel", "per patch"), "disk");
    const before = reviewSummary(editor).activeId;
    editor.chain().insertContentAt(positionOf(editor, "pixel") + 2, "x").run();
    expect(reviewSummary(editor)).toMatchObject({ count: 1, activeId: before });
    expect(editor.view.dom.querySelector(".note-diff-delete")?.textContent).toBe("pixxel.");
    expect(serializeNoteMarkdown(docWithPending(editor, "disk").toJSON())).toContain("per patch.");
    acceptAll(editor);
    expect(markdown(editor)).toContain("per patch.");
  });

  it("inserts the formatting the comparison checked, not the formatting waiting at the cursor", () => {
    const editor = build();
    propose(editor, BODY.replace("per pixel", "per patch"));
    editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.bold.create()]));
    expect(serializeNoteMarkdown(docWithPending(editor, "agent").toJSON())).toContain("per patch.");
    acceptAll(editor);
    expect(markdown(editor)).toContain("Masks are sampled per patch.");
  });

  it.each([
    ["a callout", "> [!warning] Watch out\n> Small batches drift.\n", "drift", "wander"],
    ["a task item", "- [ ] Rerun the seeds\n- [x] Plot the loss\n", "seeds", "trials"],
    ["a nested list", "- Runs\n  - first run\n  - second run\n", "second", "third"],
    ["a highlight", "Read ==this part== carefully.\n", "part", "section"],
  ])("accepts a word change inside %s and keeps it while the person types beside it", (_where, body, word, replacement) => {
    const editor = build(body);
    propose(editor, body.replace(word, replacement));
    expect(reviewSummary(editor).count).toBe(1);
    typeBefore(editor, word, "x");
    expect(reviewSummary(editor).count).toBe(1);
    acceptAll(editor);
    expect(markdown(editor)).toBe(normalized(body.replace(word, `x${replacement}`)));
  });

  it("keeps agent and disk changes apart and applies only disk ones to the saved text", () => {
    const editor = build();
    propose(editor, BODY.replace("per pixel", "per patch"), "agent");
    propose(editor, BODY.replace("0.75 and", "0.60 and"), "disk");
    expect(reviewSummary(editor).count).toBe(2);
    expect(hasPending(editor, "disk")).toBe(true);
    const saved = serializeNoteMarkdown(docWithPending(editor, "disk").toJSON());
    expect(saved).toContain("0.60 and");
    expect(saved).toContain("per pixel");
    propose(editor, BODY, "disk");
    expect(hasPending(editor, "disk")).toBe(false);
    expect(hasPending(editor, "agent")).toBe(true);
  });
});

function press(editor: Editor, init: KeyboardEventInit & { key: string }): boolean {
  return pressKey(editor, init.key, init);
}

function transactions(editor: Editor): Transaction[] {
  const seen: Transaction[] = [];
  editor.on("transaction", ({ transaction }) => {
    seen.push(transaction);
  });
  return seen;
}

describe("reviewing note changes", () => {
  it("reports nothing to review on an editor without suggestions", () => {
    const editor = kbEditor(BODY, null);
    expect(reviewSummary(editor)).toEqual({ count: 0, index: -1, activeId: null });
    expect(hasPending(editor, "disk")).toBe(false);
  });

  it("does nothing when there is nothing to step through, accept or reject", () => {
    const editor = build();
    const before = markdown(editor);
    const seen = transactions(editor);
    moveReview(editor, 1);
    acceptActive(editor);
    rejectActive(editor);
    expect(seen).toHaveLength(0);
    expect(markdown(editor)).toBe(before);
  });

  it("tells a settled review apart from typing and from only showing changes", () => {
    const editor = build();
    const seen = transactions(editor);
    propose(editor, BODY.replace("per pixel", "per patch"));
    editor.chain().insertContentAt(1, "Draft ").run();
    rejectActive(editor);
    expect(seen.map(isReviewTransaction)).toEqual([false, false, true]);
  });

  it("keeps the review as it is when the selection moves or nothing is pending", () => {
    const editor = build();
    editor.chain().insertContentAt(1, "Draft ").run();
    expect(reviewSummary(editor).count).toBe(0);
    propose(editor, BODY.replace("per pixel", "per patch"));
    const before = reviewSummary(editor);
    editor.commands.setTextSelection(3);
    expect(reviewSummary(editor)).toEqual(before);
  });

  it("accepts the active change with Mod-Enter and leaves Escape alone", () => {
    const editor = build();
    propose(editor, BODY.replace("0.75 and", "0.60 and").replace("per pixel", "per patch"));
    expect(press(editor, { key: "Enter", ctrlKey: true })).toBe(true);
    expect(markdown(editor)).toContain("ratio of 0.60 and");
    expect(reviewSummary(editor).count).toBe(1);
    expect(press(editor, { key: "Escape" })).toBe(false);
    expect(reviewSummary(editor).count).toBe(1);
  });

  it("brings back a rejected change with Mod-z until the note changes", () => {
    const editor = build();
    propose(editor, BODY.replace("0.75 and", "0.60 and").replace("per pixel", "per patch"));
    expect(canUndoReject(editor)).toBe(false);
    rejectActive(editor);
    expect(reviewSummary(editor).count).toBe(1);
    expect(canUndoReject(editor)).toBe(true);
    expect(press(editor, { key: "z", ctrlKey: true })).toBe(true);
    expect(reviewSummary(editor)).toMatchObject({ count: 2, index: 0 });
    expect(canUndoReject(editor)).toBe(false);
    rejectAll(editor);
    expect(reviewSummary(editor).count).toBe(0);
    expect(undoReject(editor)).toBe(true);
    expect(reviewSummary(editor).count).toBe(2);
    rejectActive(editor);
    editor.chain().insertContentAt(1, "Draft ").run();
    expect(canUndoReject(editor)).toBe(false);
    expect(undoReject(editor)).toBe(false);
  });

  it("marks only the person's moves between changes as navigation", () => {
    const editor = build();
    const seen = transactions(editor);
    propose(editor, BODY.replace("0.75 and", "0.60 and").replace("per pixel", "per patch"));
    moveReview(editor, 1);
    acceptActive(editor);
    propose(editor, BODY.replace("per pixel", "per voxel"), "disk");
    expect(seen.map(isReviewNavigation)).toEqual([false, true, true, false]);
  });

  it("keeps its decorations for selection moves and maps them for typing elsewhere", () => {
    const editor = build();
    propose(editor, BODY.replace("per pixel", "per patch"));
    const shown = () =>
      editor.state.plugins
        .map((plugin) => plugin.props.decorations?.call(plugin, editor.state))
        .find((set) => set instanceof DecorationSet && set.find().length > 0);
    const before = shown();
    editor.commands.setTextSelection(3);
    expect(shown()).toBe(before);
    const insert = editor.view.dom.querySelector(".note-diff-insert")?.textContent;
    const struck = editor.view.dom.querySelector(".note-diff-delete")?.textContent;
    editor.chain().insertContentAt(1, "Draft ").run();
    expect(editor.view.dom.querySelector(".note-diff-insert")?.textContent).toBe(insert);
    expect(editor.view.dom.querySelector(".note-diff-delete")?.textContent).toBe(struck);
  });

  it("holds back remote images in a proposed block until the person loads them", async () => {
    const editor = build();
    propose(editor, `${BODY}\n![Chart](https://tracker.example/pixel.png)\n`);
    const block = editor.view.dom.querySelector(".note-diff-block") as HTMLElement;
    expect(block.querySelector("img")).toBeNull();
    const holder = await vi.waitFor(() => {
      const found = block.querySelector<HTMLElement>("[data-remote-image]");
      if (!found) throw new Error("not drawn yet");
      return found;
    });
    expect(holder.dataset.remoteImage).toBe("tracker.example");
    holder.querySelector("button")?.click();
    expect(block.querySelector("img")?.getAttribute("src")).toBe("https://tracker.example/pixel.png");
  });

  it("orders changes at the same place by where they end", () => {
    const editor = build();
    const at = positionOf(editor, "pixel");
    showSuggestions(
      editor,
      [
        { kind: "text", from: at, to: at + 5, text: "patch" },
        { kind: "text", from: at, to: at + 2, text: "po" },
      ],
      "agent",
    );
    expect(reviewSummary(editor)).toMatchObject({ count: 2, index: 1 });
  });

  it("marks only the active block change as active", () => {
    const editor = build();
    propose(editor, BODY.replace("## Results", "## Results\n\nFirst new.").replace("Masks are", "Second new.\n\nMasks are"));
    const blocks = [...editor.view.dom.querySelectorAll(".note-diff-block")];
    expect(blocks.map((block) => block.textContent)).toEqual(["First new.", "Second new."]);
    expect(blocks.map((block) => block.classList.contains("note-diff-active"))).toEqual([true, false]);
    expect(blocks.every((block) => (block as HTMLElement).contentEditable === "false")).toBe(true);
  });

  it("shows an inserted word without striking anything out", () => {
    const editor = build();
    propose(editor, BODY.replace("per pixel", "per single pixel"));
    expect(editor.view.dom.querySelector(".note-diff-delete")).toBeNull();
    expect(editor.view.dom.querySelector(".note-diff-insert")?.textContent).toBe("single ");
  });

  it("shows a removed word struck out with nothing inserted", () => {
    const editor = build();
    propose(editor, BODY.replace("sampled per pixel", "sampled pixel"));
    expect(editor.view.dom.querySelector(".note-diff-delete")?.textContent).toBe("per ");
    expect(editor.view.dom.querySelector(".note-diff-insert")).toBeNull();
    acceptAll(editor);
    expect(markdown(editor)).toContain("Masks are sampled pixel.");
  });

  it("strikes out only blocks that a block change fully covers", () => {
    const editor = build();
    showSuggestions(editor, [{ kind: "blocks", from: 1, to: 4, nodes: [] }], "agent");
    expect(reviewSummary(editor).count).toBe(1);
    expect(editor.view.dom.querySelector(".note-diff-delete-block")).toBeNull();
  });

  it("keeps a word change when the person types inside a changed paragraph's other words", () => {
    const editor = build();
    propose(editor, BODY.replace("per pixel", "per patch"));
    const at = positionOf(editor, "Masks");
    editor.chain().insertContentAt(at, "All ").run();
    expect(reviewSummary(editor).count).toBe(1);
    acceptAll(editor);
    expect(markdown(editor)).toContain("All Masks are sampled per patch.");
  });

  it("moves to the next change when the person types the active one's text", () => {
    const editor = build();
    propose(editor, BODY.replace("0.75 and", "0.60 and").replace("per pixel", "per patch"));
    const first = reviewSummary(editor).activeId;
    const at = positionOf(editor, "0.75");
    editor.view.dispatch(editor.state.tr.insertText("0.60", at, at + "0.75".length));
    const summary = reviewSummary(editor);
    expect(summary.count).toBe(1);
    expect(summary.activeId).not.toBe(first);
    expect(summary.index).toBe(0);
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
  it.each([
    ["an empty note", "", "Start."],
    ["text that ends with a blank line", "One.\n\n", "One.\n\nStart."],
    ["text that ends with a newline", "One.\n", "One.\n\nStart."],
    ["text without a final newline", "One.", "One.\n\nStart."],
  ])("appends a new paragraph to %s with one blank line before it", (_name, source, expected) => {
    expect(applyNoteEdits(source, [{ find: "", replace: "Start." }])).toEqual({ text: expected, applied: 1, skipped: 0 });
  });
});
