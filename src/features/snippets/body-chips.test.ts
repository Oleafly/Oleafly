// @vitest-environment jsdom
import { cursorCharRight } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { fieldTokens, snippetFieldChips } from "./body-chips";

const views: EditorView[] = [];

function mount(doc: string): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [snippetFieldChips()] }), parent: document.body });
  views.push(view);
  return view;
}

function chips(view: EditorView): { text: string; kind: string | undefined }[] {
  return [...view.dom.querySelectorAll<HTMLElement>("[data-snippet-chip]")].map((chip) => ({
    text: chip.textContent ?? "",
    kind: chip.dataset.snippetChip,
  }));
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe("snippet field chips", () => {
  it("finds fields, choices, project fields, mirrors, variables and captures", () => {
    const body = `\\begin{figure}[\${1|htbp,t,b,H|}] \${2:0.8} \${3@image} {\${4:Caption}} fig:\${4/slug} $4 $0 \${SELECTION} [[0]] \${5/(.*)/x/}`;
    expect(fieldTokens(body).map(({ label, kind }) => [label, kind])).toEqual([
      ["1 · htbp t b H", "field"],
      ["2 · 0.8", "field"],
      ["3 · image", "field"],
      ["4 · Caption", "field"],
      ["4 · slug", "mirror"],
      ["4", "mirror"],
      ["0", "field"],
      ["SELECTION", "variable"],
      ["[[0]]", "variable"],
      ["5 · x", "mirror"],
    ]);
  });

  it("leaves escapes, plain dollars, unclosed fields and brackets as text", () => {
    expect(fieldTokens(`\\$1 \\\${2} $ $x \${1:open [x] [[a]]`)).toEqual([]);
    expect(fieldTokens(`\${1:a \${2:b}}`)).toEqual([{ from: 0, to: 13, label: "1 · a b", kind: "field" }]);
    expect(fieldTokens(`\${1/upper}`)[0]).toMatchObject({ label: "1 · upper", kind: "mirror" });
  });

  it("draws the tokens as chips and redraws them as the body changes", () => {
    const view = mount("\\frac{$1}{$2}$0");
    expect(chips(view)).toEqual([
      { text: "1", kind: "field" },
      { text: "2", kind: "field" },
      { text: "0", kind: "field" },
    ]);
    view.dispatch({ changes: { from: view.state.doc.length, insert: ` \${CLIPBOARD}` } });
    expect(chips(view).at(-1)).toEqual({ text: "CLIPBOARD", kind: "variable" });
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(chips(view)).toHaveLength(4);
  });

  it("draws a field that spans lines as one shortened chip", () => {
    const view = mount(`\${1:Method & Recall & FA/wk & Latency \\\\\nPeriodic stream & .957 & 1.8 & 72 s}$0`);
    expect(chips(view)[0]).toEqual({ text: "1 · Method & Recall & FA/wk & Latency \\ Per…", kind: "field" });
    expect(view.state.doc.lines).toBe(2);
  });

  it("moves the caret over a chip in one step", () => {
    const view = mount("a$1b");
    view.dispatch({ selection: EditorSelection.cursor(1) });
    cursorCharRight(view);
    expect(view.state.selection.main.head).toBe(3);
  });
});
