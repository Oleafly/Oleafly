// @vitest-environment jsdom

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { visualAtomicField } from "./atomic-decorations";
import { visualMode } from "./index";
import { skipAtomicRanges } from "./skip-preamble";
import { positionOf, SAMPLE_DOCUMENT } from "./test-document";
import { collapsePreambleEffect } from "./widgets/preamble";


if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

const ports = { resolveImage: async () => null };
let view: EditorView | null = null;

function mount(doc: string, cursor?: number): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: cursor === undefined ? undefined : { anchor: cursor },
      extensions: [latexTreeSupport(), visualMode(ports)],
    }),
    parent,
  });
  return view;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
});

const doc = SAMPLE_DOCUMENT;
const preambleEnd = positionOf(doc, "\\begin{document}") + "\\begin{document}".length;
const firstHeadingText = positionOf(doc, "Widgets");

describe("cursor placement on open", () => {
  it("moves a cursor at the start of the document past the collapsed preamble and the hidden heading command", async () => {
    const editor = mount(doc);
    await settle();
    expect(editor.state.selection.main.head).toBe(firstHeadingText);
    expect(editor.dom.classList.contains("ofl-visual-parsed")).toBe(true);
  });

  it("leaves a cursor that was restored inside the body alone", async () => {
    const inside = positionOf(doc, "Einstein");
    const editor = mount(doc, inside);
    await settle();
    expect(editor.state.selection.main.head).toBe(inside);
  });

  it("returns the cursor to the document body when the preamble collapses", async () => {
    const inPreamble = positionOf(doc, "amsmath");
    const editor = mount(doc, inPreamble);
    await settle();
    expect(editor.state.selection.main.head).toBe(inPreamble);
    expect(editor.state.field(visualAtomicField).preamble.to).toBe(preambleEnd);
    editor.dispatch({ effects: collapsePreambleEffect.of(true) });
    await settle();
    expect(editor.state.selection.main.head).toBe(firstHeadingText);
  });
});

describe("atomic ranges", () => {
  it("skips replaced ranges when placing the cursor", async () => {
    const editor = mount(doc, positionOf(doc, "Einstein"));
    await settle();
    const sets = editor.state.facet(EditorView.atomicRanges).map((source) => source(editor));
    const partStart = positionOf(doc, "\\part{");
    expect(skipAtomicRanges(editor.state, sets, partStart)).toBe(partStart + "\\part{".length);
    expect(skipAtomicRanges(editor.state, sets, 0)).toBe(firstHeadingText);
  });

  it("moves the cursor over rendered inline math in one step", async () => {
    const editor = mount(doc, positionOf(doc, "Einstein"));
    await settle();
    const before = positionOf(doc, "$E = mc^2$");
    const moved = editor.moveByChar(EditorSelection.cursor(before), true);
    expect(moved.head).toBe(before + "$E = mc^2$".length);
  });

  it("re-enters the source when the cursor lands inside a rendered range", async () => {
    const editor = mount(doc, positionOf(doc, "Einstein"));
    await settle();
    editor.dispatch({ selection: { anchor: positionOf(doc, "mc^2") } });
    const decorations = editor.state.field(visualAtomicField).decorations;
    let covered = false;
    decorations.between(positionOf(doc, "mc^2"), positionOf(doc, "mc^2"), (from, to) => {
      if (to > from) covered = true;
    });
    expect(covered).toBe(false);
  });
});
