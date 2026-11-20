// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ parse: vi.fn(), units: vi.fn() }));

vi.mock("@/components/editor/markdown-typing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./markdown-typing")>();
  spies.parse.mockImplementation(actual.parse);
  return { ...actual, parse: spies.parse };
});

vi.mock("@oleafly/wysiwyg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oleafly/wysiwyg")>();
  spies.units.mockImplementation(actual.markdownUnits);
  return { ...actual, markdownUnits: spies.units };
});

import { markdownFormatKeymap, pendingAt } from "./markdown-keymap";
import { MODEL_DOC_LIMIT, MODEL_SLICE_LIMIT, RESTING_STATE, modelState, sourceTarget } from "./markdown-model";
import { shareParsingDocument } from "./tests/markdown-toolbar-corpus";

const opened: EditorView[] = [];
let unshare = () => {};

beforeAll(() => {
  unshare = shareParsingDocument();
  if (!("getClientRects" in Range.prototype)) Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
});

afterAll(() => unshare());

beforeEach(() => {
  spies.parse.mockClear();
  spies.units.mockClear();
});

afterEach(() => {
  for (const view of opened.splice(0)) view.destroy();
});

function table(rows: number): string {
  const lines = ["| model | bleu |", "| --- | --- |"];
  for (let row = 0; row < rows; row += 1) lines.push(`| model ${row} | ${row}.4 |`);
  return `${lines.join("\n")}\n`;
}

const BIG_TABLE = table(Math.ceil(MODEL_SLICE_LIMIT / 20));
const WITH_BIG_TABLE = `## Results\n\n${BIG_TABLE}\nAfter.\n`;
const IN_TABLE = WITH_BIG_TABLE.indexOf("model 5") + 2;

function stateAt(doc: string, anchor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor } });
}

function open(doc: string, anchor: number): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor }, extensions: markdownFormatKeymap }), parent: document.body });
  opened.push(view);
  return view;
}

describe("the Code-mode Markdown toolbar's size limits", () => {
  it("reads a short block of a document with a long table as before", () => {
    expect(BIG_TABLE.length).toBeGreaterThan(MODEL_SLICE_LIMIT);
    expect(modelState(stateAt(WITH_BIG_TABLE, 4)).heading).toBe(2);
    expect(spies.parse).toHaveBeenCalled();
  });

  it("never parses a block over the limit when the caret moves inside it", () => {
    let state = stateAt(WITH_BIG_TABLE, IN_TABLE);
    expect(modelState(state)).toBe(RESTING_STATE);
    state = state.update({ selection: { anchor: IN_TABLE + 1 } }).state;
    expect(modelState(state)).toBe(RESTING_STATE);
    expect(spies.parse).not.toHaveBeenCalled();
  });

  it("starts no typing run in a block over the limit and parses nothing on the next key", () => {
    const view = open(WITH_BIG_TABLE, IN_TABLE);
    sourceTarget(() => view).bold();
    expect(pendingAt(view.state)).toBeNull();
    view.dispatch({ changes: { from: IN_TABLE, insert: "X" }, selection: { anchor: IN_TABLE + 1 }, userEvent: "input.type" });
    expect(modelState(view.state)).toBe(RESTING_STATE);
    expect(view.state.doc.toString()).toBe(`${WITH_BIG_TABLE.slice(0, IN_TABLE)}X${WITH_BIG_TABLE.slice(IN_TABLE)}`);
    expect(spies.parse).not.toHaveBeenCalled();
  });

  it("leaves a document over the limit alone, without reading its blocks", () => {
    const paragraph = "Some words in a paragraph.\n\n";
    const doc = `## Head\n\n${paragraph.repeat(Math.ceil(MODEL_DOC_LIMIT / paragraph.length))}`;
    expect(modelState(stateAt(doc, 4))).toBe(RESTING_STATE);
    expect(spies.units).not.toHaveBeenCalled();
    expect(spies.parse).not.toHaveBeenCalled();
  });

  it("still hands the next key to Bold in a short block", () => {
    const view = open("Alpha bravo charlie.\n", 9);
    sourceTarget(() => view).bold();
    expect(pendingAt(view.state)).not.toBeNull();
    view.dispatch({ ...view.state.replaceSelection("X"), userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe("Alpha bra**X**vo charlie.\n");
  });
});
