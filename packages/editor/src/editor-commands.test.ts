// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  EDITOR_COMMANDS,
  EDITOR_COMMAND_IDS,
  deleteLineCommand,
  duplicateSelection,
  editorCommandKeymap,
  lowercaseSelection,
  titleCaseSelection,
  uppercaseSelection,
} from "./editor-commands";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

let view: EditorView | null = null;

function mount(doc: string, selection?: { anchor: number; head?: number }): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: selection ? EditorSelection.single(selection.anchor, selection.head) : undefined,
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
    parent: document.body,
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("case commands", () => {
  it("uppercases and lowercases the selected text", () => {
    const editor = mount("alpha beta", { anchor: 0, head: 5 });
    expect(uppercaseSelection(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("ALPHA beta");
    expect(editor.state.selection.main.from).toBe(0);
    expect(editor.state.selection.main.to).toBe(5);
    expect(lowercaseSelection(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("alpha beta");
  });

  it("operates on the word under an empty caret", () => {
    const editor = mount("alpha beta", { anchor: 8 });
    expect(uppercaseSelection(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("alpha BETA");
    expect(editor.state.selection.main.empty).toBe(true);
    expect(editor.state.selection.main.head).toBe(8);
  });

  it("title-cases every word of the selection", () => {
    const editor = mount("the QUICK brown fox", { anchor: 0, head: 19 });
    expect(titleCaseSelection(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("The Quick Brown Fox");
  });

  it("declines when the target is already in the requested case", () => {
    const editor = mount("ALPHA", { anchor: 0, head: 5 });
    expect(uppercaseSelection(editor)).toBe(false);
  });

  it("declines on an empty caret with no word under it", () => {
    const editor = mount("   ", { anchor: 1 });
    expect(uppercaseSelection(editor)).toBe(false);
  });

  it("changes every range of a multi-cursor selection", () => {
    const editor = mount("one two");
    editor.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(4, 7),
      ]),
    });
    expect(uppercaseSelection(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("ONE TWO");
  });
});

describe("duplicateSelection", () => {
  it("copies the whole line below when nothing is selected", () => {
    const editor = mount("first\nsecond\n", { anchor: 2 });
    expect(duplicateSelection(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("first\nfirst\nsecond\n");
  });

  it("copies the selected text after the selection and selects the copy", () => {
    const editor = mount("alpha beta", { anchor: 0, head: 5 });
    expect(duplicateSelection(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("alphaalpha beta");
    expect(editor.state.selection.main.from).toBe(5);
    expect(editor.state.selection.main.to).toBe(10);
  });
});

describe("deleteLineCommand", () => {
  it("removes the line holding the caret", () => {
    const editor = mount("first\nsecond\nthird\n", { anchor: 7 });
    expect(deleteLineCommand(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("first\nthird\n");
  });
});

describe("editorCommandKeymap", () => {
  it("binds only the ids that carry a key", () => {
    const bindings = editorCommandKeymap({ uppercase: "Ctrl-u", lowercase: "", deleteLine: "Mod-d" });
    expect(bindings.map((binding) => binding.key)).toEqual(["uppercase", "deleteLine"].map(
      (id) => (id === "uppercase" ? "Ctrl-u" : "Mod-d"),
    ));
    expect(bindings[0].run).toBe(uppercaseSelection);
  });

  it("ignores whitespace-only keys", () => {
    expect(editorCommandKeymap({ uppercase: "   " })).toEqual([]);
  });

  it("exposes a command for every id", () => {
    for (const id of EDITOR_COMMAND_IDS) {
      expect(typeof EDITOR_COMMANDS[id]).toBe("function");
    }
  });
});
