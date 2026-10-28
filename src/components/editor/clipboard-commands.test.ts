// @vitest-environment jsdom

import { EditorSelection, EditorState, Transaction, type EditorStateConfig, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clipboard = vi.hoisted(() => ({
  readClipboardText: vi.fn(async () => ""),
  writeClipboardText: vi.fn(async (_text: string) => {}),
}));

vi.mock("@/lib/clipboard", () => clipboard);

import { copySelection, cutSelection, hasSelectedText, pasteClipboard, selectAllText } from "./clipboard-commands";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

class FakeDataTransfer {
  private readonly data = new Map<string, string>();
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? "";
  }
}

class FakeClipboardEvent extends Event {
  readonly clipboardData: FakeDataTransfer | null;
  constructor(type: string, init: EventInit & { clipboardData?: FakeDataTransfer }) {
    super(type, init);
    this.clipboardData = init.clipboardData ?? null;
  }
}

// A webview whose ClipboardEvent drops the clipboard data it was given.
class DataLessClipboardEvent extends Event {
  readonly clipboardData = null;
}

const views: EditorView[] = [];
let transactions: Transaction[] = [];

function editor(doc: string, selection: EditorStateConfig["selection"], extensions: Extension = []): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        EditorView.updateListener.of((update) => transactions.push(...update.transactions)),
        extensions,
      ],
    }),
  });
  views.push(view);
  return view;
}

function userEvents(): (string | undefined)[] {
  return transactions.filter((tr) => tr.docChanged).map((tr) => tr.annotation(Transaction.userEvent));
}

describe("editor clipboard commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactions = [];
    clipboard.readClipboardText.mockResolvedValue("");
    clipboard.writeClipboardText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    while (views.length > 0) views.pop()?.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("reports whether any range holds text", () => {
    expect(hasSelectedText(EditorState.create({ doc: "abc", selection: EditorSelection.single(1, 2) }))).toBe(true);
    expect(hasSelectedText(EditorState.create({ doc: "abc", selection: EditorSelection.cursor(1) }))).toBe(false);
  });

  it("copies every selected range, one per line", async () => {
    const view = editor("one two three", EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.cursor(5), EditorSelection.range(8, 13)]));

    await copySelection(view);

    expect(clipboard.writeClipboardText).toHaveBeenCalledWith("one\nthree");
    expect(view.state.doc.toString()).toBe("one two three");
  });

  it("copies nothing without a selection and survives a refused write", async () => {
    await copySelection(editor("text", EditorSelection.cursor(2)));
    expect(clipboard.writeClipboardText).not.toHaveBeenCalled();

    clipboard.writeClipboardText.mockRejectedValue(new Error("denied"));
    await expect(copySelection(editor("text", EditorSelection.single(0, 2)))).resolves.toBeUndefined();
  });

  it("cuts the selection as a cut edit", async () => {
    const view = editor("keep cut keep", EditorSelection.single(5, 9));

    await cutSelection(view);

    expect(clipboard.writeClipboardText).toHaveBeenCalledWith("cut ");
    expect(view.state.doc.toString()).toBe("keep keep");
    expect(userEvents()).toEqual(["delete.cut"]);
  });

  it("leaves the text in place when the cut cannot reach the clipboard", async () => {
    clipboard.writeClipboardText.mockRejectedValue(new Error("denied"));
    const view = editor("keep cut", EditorSelection.single(5, 8));

    await cutSelection(view);

    expect(view.state.doc.toString()).toBe("keep cut");
  });

  it("cuts nothing from a read-only or unselected view", async () => {
    await cutSelection(editor("locked", EditorSelection.single(0, 3), EditorState.readOnly.of(true)));
    await cutSelection(editor("plain", EditorSelection.cursor(2)));

    expect(clipboard.writeClipboardText).not.toHaveBeenCalled();
  });

  it("pastes through CodeMirror's own paste handling", async () => {
    vi.stubGlobal("DataTransfer", FakeDataTransfer);
    vi.stubGlobal("ClipboardEvent", FakeClipboardEvent);
    clipboard.readClipboardText.mockResolvedValue("new\r\nlines");
    const view = editor("before after", EditorSelection.single(7, 12), EditorView.clipboardInputFilter.of((text) => text.toUpperCase()));
    const focus = vi.spyOn(view, "focus");
    const seen: Event[] = [];
    view.contentDOM.addEventListener("paste", (event) => seen.push(event));

    await pasteClipboard(view);

    expect(focus).toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0].defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("before NEW\nLINES");
    expect(userEvents()).toEqual(["input.paste"]);
  });

  it("inserts the text as a paste with LF line endings when no paste event can carry it", async () => {
    vi.stubGlobal("ClipboardEvent", DataLessClipboardEvent);
    vi.stubGlobal("DataTransfer", FakeDataTransfer);
    clipboard.readClipboardText.mockResolvedValue("a\r\nb\rc");
    const view = editor("x", EditorSelection.cursor(1), EditorState.lineSeparator.of("\n"));

    await pasteClipboard(view);

    expect(view.state.doc.toString()).toBe("xa\nb\nc");
    expect(userEvents()).toEqual(["input.paste"]);

    vi.stubGlobal("DataTransfer", undefined);
    clipboard.readClipboardText.mockResolvedValue("d");
    await pasteClipboard(view);
    expect(view.state.doc.toString()).toBe("xa\nb\ncd");
  });

  it("pastes nothing into a read-only view, from an empty clipboard, or when reading fails", async () => {
    await pasteClipboard(editor("locked", EditorSelection.cursor(0), EditorState.readOnly.of(true)));
    expect(clipboard.readClipboardText).not.toHaveBeenCalled();

    const view = editor("plain", EditorSelection.cursor(5));
    await pasteClipboard(view);
    clipboard.readClipboardText.mockRejectedValue(new Error("not text"));
    await pasteClipboard(view);

    expect(view.state.doc.toString()).toBe("plain");
    expect(userEvents()).toEqual([]);
  });

  it("selects the whole document and focuses the editor", () => {
    const view = editor("all of it", EditorSelection.cursor(3));
    const focus = vi.spyOn(view, "focus");

    selectAllText(view);

    expect(view.state.selection.main).toMatchObject({ from: 0, to: 9 });
    expect(focus).toHaveBeenCalled();
  });
});
