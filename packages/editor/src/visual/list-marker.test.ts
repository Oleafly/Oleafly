import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { listItemMarker } from "./list-marker";
import { LIST_DOCUMENT, positionOf } from "./test-document";
import { selectDecoratedArgument } from "./select-argument";
import { visualAtomicField } from "./atomic-decorations";
import { pointerSelectionTracking } from "./selection";

describe("listItemMarker", () => {
  const state = EditorState.create({ doc: LIST_DOCUMENT, extensions: [latexTreeSupport(), listItemMarker] });
  const itemStart = positionOf(LIST_DOCUMENT, "\\item First");

  it("moves a pointer selection in front of an item marker to after it", () => {
    const next = state.update({ selection: { anchor: itemStart }, userEvent: "select.pointer" }).state;
    expect(next.selection.main.head).toBe(itemStart + "\\item ".length);
  });

  it("moves a forward keyboard selection past the marker", () => {
    const before = state.update({ selection: { anchor: itemStart - 3 } }).state;
    const next = before.update({ selection: { anchor: itemStart + 2 }, userEvent: "select" }).state;
    expect(next.selection.main.head).toBe(itemStart + "\\item ".length);
  });

  it("moves a backward keyboard selection to the end of the previous line", () => {
    const start = positionOf(LIST_DOCUMENT, "\\item Second");
    const before = state.update({ selection: { anchor: start + 8 } }).state;
    const next = before.update({ selection: { anchor: start + 1 }, userEvent: "select" }).state;
    expect(next.selection.main.head).toBe(before.doc.lineAt(start).from - 1);
  });
});

describe("selectDecoratedArgument", () => {
  const doc = "\\begin{document}\nSome \\textbf{bold words} here.\n\\end{document}\n";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [latexTreeSupport(), pointerSelectionTracking, visualAtomicField, selectDecoratedArgument(visualAtomicField)],
  });
  const command = positionOf(doc, "\\textbf{");

  it("places a pointer click at the start of a hidden command inside the braces", () => {
    const next = state.update({ selection: { anchor: command }, userEvent: "select.pointer" }).state;
    expect(next.selection.main.head).toBe(command + "\\textbf{".length);
  });

  it("keeps a pointer click before the hidden closing brace inside the braces", () => {
    const end = command + "\\textbf{bold words}".length;
    const next = state.update({ selection: { anchor: end - 1 }, userEvent: "select.pointer" }).state;
    expect(next.selection.main.head).toBe(end - 1);
  });

  it("keeps a drag across the whole command inside the braces", () => {
    const end = command + "\\textbf{bold words}".length;
    const next = state.update({ selection: { anchor: command, head: end }, userEvent: "select.pointer" }).state;
    expect(next.selection.main.from).toBe(command + "\\textbf{".length);
    expect(next.selection.main.to).toBe(end - 1);
  });
});
