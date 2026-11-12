// @vitest-environment jsdom
import { blockIdOf } from "@oleafly/wysiwyg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockFragment, blockOfFragment, newBlockId, shortText, stripBlockIdMarkers, textFragment, textOfFragment } from "./note-block-ids";
import {
  assignNoteBlockId,
  docBlockAt,
  docBlocks,
  ensureDocBlockId,
  findDocBlock,
  findTextBlock,
  noteBlock,
  noteBlocks,
  noteBlockSource,
  noteItemLines,
  revealBlock,
  revealTextBlock,
  withBlockId,
} from "./note-block-links";
import { embedSource, fragmentLabel } from "./note-embeds";
import { noteHeadings, noteLinkHref, parseNoteLink } from "./note-link-format";
import { noteLinkExtensions } from "./note-links";
import { parseNoteMarkdown } from "./note-markdown";
import { destroyKbEditors, kbEditor, kbMarkdown, kbNote, placeCursor } from "./tests/kb-editor-fixtures";
import "./tests/setup";

afterEach(destroyKbEditors);

const NOTE = [
  "---",
  "id: n-1",
  "---",
  "## Results ^res",
  "",
  "Accuracy rose to 64% ^acc",
  "",
  "- [ ] check the seed ^task",
  "- plain item",
  "  - nested item ^deep",
  "",
  "> [!warning] Cable",
  "> Check it twice",
  "",
  "^warn",
  "",
  "| run | acc |",
  "| --- | --- |",
  "| 3 | 64 |",
  "",
  "^tbl",
  "",
  "No id here",
  "",
].join("\n");

function topLevel(markdown: string): (string | undefined)[] {
  return (parseNoteMarkdown(markdown).doc.content ?? []).map((node) => node.type);
}

describe("block ids in Markdown", () => {
  it("lists every block with its id, kind and text", () => {
    const blocks = noteBlocks(NOTE).map((block) => [block.kind, block.id, block.text]);
    expect(blocks).toEqual([
      ["heading", "res", "Results"],
      ["paragraph", "acc", "Accuracy rose to 64%"],
      ["item", "task", "check the seed"],
      ["item", null, "plain item"],
      ["item", "deep", "nested item"],
      ["callout", "warn", "Cable"],
      ["table", "tbl", "run | acc"],
      ["paragraph", null, "No id here"],
    ]);
  });

  it("counts list items the way the editor reads them, not lines inside math", () => {
    expect(noteItemLines("- [ ] Call Bob\n\n$$\nx = a\n  + b\n$$\n\n- [ ] Second\n")).toEqual([0, 7]);
    expect(noteItemLines("---\ntitle: x\n---\n\n- one\n\n$$\n- y\n$$\n\n- two\n")).toEqual([4, 10]);
    expect(noteItemLines("Sum $$\nx\n$$\n2. two\n")).toEqual([]);
  });

  it("cuts out one block as Markdown without its marker", () => {
    expect(noteBlockSource(NOTE, "acc")).toBe("Accuracy rose to 64%");
    expect(noteBlockSource(NOTE, "tbl")).toBe("| run | acc |\n| --- | --- |\n| 3 | 64 |");
    expect(noteBlockSource(NOTE, "warn")).toBe("> [!warning] Cable\n> Check it twice");
    expect(noteBlockSource(NOTE, "missing")).toBeNull();
    expect(embedSource(NOTE, "^task")).toBe("- [ ] check the seed");
    expect(embedSource(NOTE, undefined)).not.toContain("^acc");
    expect(fragmentLabel(NOTE, "^acc")).toBe("Accuracy rose to 64%");
    expect(fragmentLabel(NOTE, "results")).toBe("Results");
  });

  it("adds an id to a block in the file text", () => {
    const blocks = noteBlocks(NOTE);
    const plain = blocks.find((block) => block.text === "plain item");
    const last = blocks.find((block) => block.text === "No id here");
    if (!plain || !last) throw new Error("missing blocks");
    const first = withBlockId(NOTE, plain, "new1");
    expect(first).toContain("- plain item ^new1\n");
    expect(noteBlock(first, "new1")?.text).toBe("plain item");
    const quote = "> quoted\nNext\n";
    const [block] = noteBlocks(quote);
    expect(withBlockId(quote, { ...block, trailing: true, idLine: 0 }, "q")).toBe("> quoted\n\n^q\n\nNext\n");
    expect(withBlockId("a\r\nb\r\n", { idLine: 1, trailing: false, kind: "paragraph", nested: false }, "x")).toBe("a\r\nb ^x\r\n");
    expect(noteBlock(withBlockId(NOTE, last, "end"), "end")?.text).toBe("No id here");
  });

  it("writes a nested block's id line inside its list item or quote", () => {
    const listed = "- item\n\n  ```js\n  x\n  ```\n- next\n";
    const code = noteBlocks(listed).find((block) => block.kind === "code");
    if (!code) throw new Error("no code block");
    const inList = withBlockId(listed, code, "cb");
    expect(inList).toBe("- item\n\n  ```js\n  x\n  ```\n\n  ^cb\n\n- next\n");
    expect(noteBlock(inList, "cb")?.kind).toBe("code");
    expect(topLevel(inList)).toEqual(topLevel(listed));
    const quoted = "> quoted\n>\n> ```\n> y\n> ```\nafter\n";
    const fence = noteBlocks(quoted).find((block) => block.kind === "code");
    if (!fence) throw new Error("no fence");
    const inQuote = withBlockId(quoted, fence, "qq");
    expect(inQuote).toBe("> quoted\n>\n> ```\n> y\n> ```\n>\n> ^qq\n>\nafter\n");
    expect(noteBlock(inQuote, "qq")?.kind).toBe("code");
    expect(topLevel(inQuote)).toEqual(topLevel(quoted));
    const quoteInItem = "- item\n  > q\n- next\n";
    const quote = noteBlocks(quoteInItem).find((block) => block.kind === "quote");
    if (!quote) throw new Error("no quote");
    const kept = withBlockId(quoteInItem, quote, "q1");
    expect(kept).toBe("- item\n  > q\n\n  ^q1\n\n- next\n");
    expect(noteBlock(kept, "q1")?.kind).toBe("quote");
    const crlf = "- item\r\n\r\n  ```\r\n  x\r\n  ```\r\n";
    const crlfCode = noteBlocks(crlf).find((block) => block.kind === "code");
    if (!crlfCode) throw new Error("no CRLF code block");
    expect(withBlockId(crlf, crlfCode, "cr")).toBe("- item\r\n\r\n  ```\r\n  x\r\n  ```\r\n\r\n  ^cr\r\n");
  });

  it("keeps heading slugs and link addresses free of the marker", () => {
    expect(noteHeadings(NOTE).map((heading) => heading.slug)).toEqual(["results"]);
    expect(noteLinkHref("note", "n-1", "^acc")).toBe("oleafly://note/n-1#^acc");
    expect(noteLinkHref("note", "n-1", "two words")).toBe("oleafly://note/n-1#two%20words");
    expect(parseNoteLink("oleafly://note/n-1#^acc")).toEqual({ kind: "note", id: "n-1", heading: "^acc" });
    expect(parseNoteLink("oleafly://note/n-1#%5Eacc")?.heading).toBe("^acc");
  });

  it("strips markers from preview text but not from code", () => {
    expect(stripBlockIdMarkers("One ^a\n\n^b\n```\nx ^c\n```\nx^2")).toBe("One\n\n```\nx ^c\n```\nx^2");
    expect(blockOfFragment("^ok-1")).toBe("ok-1");
    expect(blockOfFragment("heading")).toBeNull();
    expect(blockOfFragment("^bad id")).toBeNull();
    expect(blockFragment("x")).toBe("^x");
    expect(shortText("a ".repeat(40), 10)).toBe("a a a a a…");
    const values = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const next = vi.fn(() => values.shift() ?? 0);
    expect(newBlockId(new Set(["dddddd"]), next)).toBe("ssssss");
  });
});

describe("block ids in the editor", () => {
  it("round-trips ids through the note editor", () => {
    const { save } = kbNote(NOTE);
    expect(save()).toBe(NOTE);
  });

  it("finds the block around the cursor and gives it an id once", () => {
    const editor = kbEditor(NOTE);
    placeCursor(editor, "nested item", 2);
    expect(docBlockAt(editor.state)?.id).toBe("deep");
    placeCursor(editor, "Check it twice", 1);
    expect(docBlockAt(editor.state)?.kind).toBe("callout");
    placeCursor(editor, "No id here", 1);
    const block = docBlockAt(editor.state);
    if (!block) throw new Error("no block");
    const id = ensureDocBlockId(editor.view, block);
    expect(id).toMatch(/^[a-z0-9]{6}$/u);
    expect(ensureDocBlockId(editor.view, docBlockAt(editor.state) as NonNullable<ReturnType<typeof docBlockAt>>)).toBe(id);
    expect(kbMarkdown(editor)).toContain(`No id here ^${id}`);
  });

  it("lists linkable blocks and reveals one with a flash that outlives a redraw", () => {
    vi.useFakeTimers();
    const links = noteLinkExtensions({ getNotes: () => [], getProjects: () => [], onOpenNote: vi.fn(), onOpenProject: vi.fn() });
    const editor = kbEditor(NOTE, { callout: null }, links);
    expect(docBlocks(editor.state.doc).map((block) => block.id ?? block.text)).toEqual([
      "res",
      "acc",
      "task",
      "plain item",
      "deep",
      "warn",
      "tbl",
      "No id here",
    ]);
    expect(revealBlock(editor.view, "acc")).toBe(true);
    const found = findDocBlock(editor.state.doc, "acc");
    expect(editor.state.selection.from).toBe((found?.pos ?? 0) + 1);
    const flashed = () => {
      const pos = findDocBlock(editor.state.doc, "acc")?.pos ?? -1;
      return (editor.view.nodeDOM(pos) as HTMLElement | null)?.classList.contains("note-block-flash");
    };
    expect(flashed()).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText("x", 1));
    expect(flashed()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(flashed()).toBe(false);
    expect(revealBlock(editor.view, "gone")).toBe(false);
    vi.useRealTimers();
  });

  it("keeps a task's id on its text through Enter at its start, and a list item's when Backspace lifts it out", () => {
    const split = kbNote("- [ ] check the seed ^task\n");
    placeCursor(split.editor, "check the seed");
    expect(split.editor.commands.keyboardShortcut("Enter")).toBe(true);
    expect(findDocBlock(split.editor.state.doc, "task")?.text).toBe("check the seed");
    expect(split.save()).toContain("- [ ] check the seed ^task");
    const joined = kbNote("- alpha\n- beta ^b\n");
    placeCursor(joined.editor, "beta");
    expect(joined.editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(findDocBlock(joined.editor.state.doc, "b")?.text).toBe("beta");
    expect(joined.save()).toBe("- alpha\n\nbeta ^b\n");
  });

  it("refuses to add an id when the note can't be edited", () => {
    const editor = kbEditor("Plain\n");
    editor.setEditable(false);
    const block = docBlockAt(editor.state, 1);
    expect(block && ensureDocBlockId(editor.view, block)).toBeNull();
  });
});

describe("finding a block by its text", () => {
  it("opens the block whose text starts with, or holds, the words of a search hit", () => {
    const links = noteLinkExtensions({ getNotes: () => [], getProjects: () => [], onOpenNote: vi.fn(), onOpenProject: vi.fn() });
    const editor = kbEditor(NOTE, { callout: null }, links);
    expect(findTextBlock(editor.state.doc, "nested   ITEM")?.kind).toBe("item");
    expect(findTextBlock(editor.state.doc, "twice")?.kind).toBe("callout");
    expect(findTextBlock(editor.state.doc, "   ")).toBeNull();
    expect(revealTextBlock(editor.view, "No id here")).toBe(true);
    expect(editor.state.doc.resolve(editor.state.selection.from).parent.textContent).toBe("No id here");
    expect(revealTextBlock(editor.view, "nowhere at all")).toBe(false);
    expect(textOfFragment("~…Ask about the cable #lab…")).toBe("Ask about the cable #lab");
    expect(textOfFragment(textFragment("  "))).toBeNull();
    expect(textOfFragment("^acc")).toBeNull();
  });

  it("waits for a block that isn't in the page yet before scrolling to it", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const links = noteLinkExtensions({ getNotes: () => [], getProjects: () => [], onOpenNote: vi.fn(), onOpenProject: vi.fn() });
    const editor = kbEditor(NOTE, { callout: null }, links);
    const holder = editor.view.dom.parentElement as HTMLElement;
    holder.remove();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    expect(revealBlock(editor.view, "acc")).toBe(true);
    expect(scroll).not.toHaveBeenCalled();
    document.body.append(holder);
    frames.shift()?.(0);
    expect(scroll).toHaveBeenCalledWith({ block: "center" });
    vi.restoreAllMocks();
  });
});

describe("assignNoteBlockId", () => {
  it("writes a new id into a closed note's file", async () => {
    const save = vi.fn(() => Promise.resolve());
    const spot = { id: null, kind: "paragraph" as const, text: "No id here", at: 22, live: false };
    const id = await assignNoteBlockId(spot, { editor: () => null, load: () => Promise.resolve({ text: NOTE, version: "v1" }), save });
    expect(id).toMatch(/^[a-z0-9]{6}$/u);
    expect(save).toHaveBeenCalledWith(NOTE.replace("No id here", `No id here ^${id}`), "v1");
  });

  it("uses the open editor when the note is open, and keeps existing ids", async () => {
    const editor = kbEditor(NOTE);
    const save = vi.fn();
    const writer = { editor: () => editor.view, load: vi.fn(), save };
    const block = docBlocks(editor.state.doc).find((entry) => entry.text === "plain item");
    const id = await assignNoteBlockId({ id: null, kind: "item", text: "plain item", at: block?.pos ?? -1, live: true }, writer);
    expect(findDocBlock(editor.state.doc, id ?? "")?.text).toBe("plain item");
    expect(save).not.toHaveBeenCalled();
    expect(await assignNoteBlockId({ id: "acc", kind: "paragraph", text: "", at: 0, live: false }, writer)).toBe("acc");
    const node = editor.state.doc.nodeAt(block?.pos ?? 0);
    expect(node && blockIdOf(node)).toBe(id);
  });
});
