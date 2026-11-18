// @vitest-environment jsdom

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { latexLanguage } from "./latex";
import { latexPairInputHandler, latexPairKeymap } from "./latex-pairs";
import { latexScriptGroups } from "./latex-scripts";
import { stubRangeGeometry } from "./test-geometry";
import { typstLanguage } from "./typst";
import { typstEditing } from "./typst-editing";
import { typstScriptGroups } from "./typst-scripts";

stubRangeGeometry();

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

type Engine = "latex" | "typst";

function engineExtensions(engine: Engine, scripts: boolean): Extension[] {
  if (engine === "typst") {
    return [
      typstLanguage(),
      scripts ? typstScriptGroups() : [],
      typstEditing({ math: true, wrap: true }),
    ];
  }
  return [
    latexLanguage(),
    scripts ? latexScriptGroups() : [],
    latexPairInputHandler({ math: true, brackets: true }),
    keymap.of(latexPairKeymap),
  ];
}

const readOnly = new Compartment();

function editor(
  markedDoc: string,
  engine: Engine = "latex",
  scripts = true,
  extra: Extension[] = [],
): EditorView {
  const cursors: number[] = [];
  let doc = "";
  for (const character of markedDoc) {
    if (character === "|") cursors.push(doc.length);
    else doc += character;
  }
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(
        cursors.map((at) => EditorSelection.cursor(at)),
      ),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        history(),
        indentUnit.of("  "),
        readOnly.of(EditorState.readOnly.of(false)),
        closeBrackets(),
        ...engineExtensions(engine, scripts),
        ...extra,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap]),
      ],
    }),
  });
  views.push(view);
  return view;
}

function marked(view: EditorView): string {
  const heads = view.state.selection.ranges
    .map((range) => range.head)
    .sort((a, b) => a - b);
  let out = "";
  let last = 0;
  for (const head of heads) {
    out += `${view.state.sliceDoc(last, head)}|`;
    last = head;
  }
  return out + view.state.sliceDoc(last);
}

function input(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  const insert = () =>
    view.state.update(view.state.replaceSelection(text), {
      userEvent: "input.type",
    });
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, text, insert));
  if (!handled) view.dispatch(insert());
}

function type(view: EditorView, text: string): EditorView {
  for (const character of text) input(view, character);
  return view;
}

function typed(markedDoc: string, text: string, engine: Engine = "latex"): string {
  return marked(type(editor(markedDoc, engine), text));
}

function press(view: EditorView, key: string): EditorView {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
  return view;
}

describe("LaTeX script groups", () => {
  it.each([
    ["x^", "10", "$x^{10|}$"],
    ["x_", "ij", "$x_{ij|}$"],
    ["x_", "ijk", "$x_{ijk|}$"],
    ["x^", "-1", "$x^{-1|}$"],
    ["x^", "-10", "$x^{-10|}$"],
    ["e^", "-x", "$e^{-x|}$"],
    ["x_", "i1", "$x_{i1|}$"],
    ["\\alpha_", "ij", "$\\alpha_{ij|}$"],
    ["{}^", "14", "${}^{14|}$"],
  ])("groups %s%s as it is typed", (before, text, expected) => {
    expect(typed(`$${before}|$`, text)).toBe(expected);
  });

  it.each([
    ["x^", "2y", "$x^2y|$"],
    ["x^", "12y", "$x^{12}y|$"],
    ["x^", "ab + c", "$x^{ab} + c|$"],
    ["x^", "2+1", "$x^2+1|$"],
    ["x_", "1,x_2", "$x_1,x_2|$"],
    ["x^", "a\\cdot", "$x^a\\cdot|$"],
    ["x^", "ab\\cdot", "$x^{ab}\\cdot|$"],
    ["x^", "1.5", "$x^1.5|$"],
    ["X^", "TX", "$X^TX|$"],
    ["A^", "HA", "$A^HA|$"],
    ["x_", "T1", "$x_{T1|}$"],
  ])("ends the group where %s%s stops being one script", (before, text, expected) => {
    expect(typed(`$${before}|$`, text)).toBe(expected);
  });

  it("splits a letter group when the same script follows it", () => {
    expect(typed("$|$", "x_iy_i")).toBe("$x_iy_i|$");
    expect(typed("$|$", "a^nb^n")).toBe("$a^nb^n|$");
    expect(typed("$|$", "x_ijk_l")).toBe("$x_{ij}k_l|$");
  });

  it("splits when the base already has the other script", () => {
    expect(typed("$|$", "\\sum_{i=1}^nx_i")).toBe("$\\sum_{i=1}^nx_i|$");
    expect(typed("$|$", "x_i^ab_")).toBe("$x_i^ab_|$");
    expect(typed("$|$", "\\alpha_i^ab_")).toBe("$\\alpha_i^ab_|$");
  });

  it("keeps the group when the other script is new to the base", () => {
    expect(typed("$|$", "x_ij^2")).toBe("$x_{ij}^2|$");
    expect(typed("$|$", "\\alpha^ab_")).toBe("$\\alpha^{ab}_|$");
  });

  it("finds the base behind a braced, escaped or numeric script", () => {
    expect(typed("$x_{i{j}}^|$", "ab_")).toBe("$x_{i{j}}^ab_|$");
    expect(typed("$x_{\\}}^|$", "ab_")).toBe("$x_{\\}}^ab_|$");
    expect(typed("$x_1^|$", "ab_")).toBe("$x_1^ab_|$");
    expect(typed("$}^|$", "ab_")).toBe("$}^{ab}_|$");
    expect(typed("$\\_^|$", "ab_")).toBe("$\\_^{ab}_|$");
  });

  it("keeps a number group when another script follows", () => {
    expect(typed("$|$", "x_12_")).toBe("$x_{12}_|$");
    expect(typed("$|$", "x_i1_")).toBe("$x_{i1}_|$");
  });

  it("steps over the closing brace", () => {
    const view = type(editor("$x^|$"), "ab}");
    expect(marked(view)).toBe("$x^{ab}|$");
    expect(marked(type(view, "c"))).toBe("$x^{ab}c|$");
  });

  it("hands the next character to the other typing rules after leaving", () => {
    expect(typed("$|$", "x^ab(")).toBe("$x^{ab}(|)$");
    expect(typed("$|$", "x^ab$")).toBe("$x^{ab}$|");
    expect(typed("$|$", "\\left(x^ab)")).toBe("$\\left(x^{ab}\\right)|$");
  });

  it("removes the braces when Backspace leaves one character", () => {
    const view = type(editor("$x^|$"), "ab");
    press(view, "Backspace");
    expect(marked(view)).toBe("$x^a|$");
    expect(marked(type(view, "c"))).toBe("$x^{ac|}$");
    expect(marked(press(editor("$x^-|$"), "Backspace"))).toBe("$x^|$");
  });

  it("keeps the braces while Backspace leaves two or more characters", () => {
    const view = type(editor("$x^|$"), "abc");
    press(view, "Backspace");
    expect(marked(view)).toBe("$x^{ab|}$");
    expect(marked(type(view, " "))).toBe("$x^{ab} |$");
  });

  it("undoes the braces on their own", () => {
    const view = type(editor("$x^|$"), "ab");
    undo(view);
    expect(marked(view)).toBe("$x^ab|$");
  });

  it("leaves the group before a new line", () => {
    const view = type(editor("\\[\n  x^|\n\\]"), "ab");
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe("\\[\n  x^{ab}\n  \n\\]");
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
  });

  it("lets Enter through untouched outside a group", () => {
    const view = editor("\\[\n  x|\n\\]");
    press(view, "Enter");
    expect(view.state.doc.lines).toBe(4);
  });

  it("forgets the group once the caret moves away", () => {
    const view = type(editor("$x^|$"), "ab");
    view.dispatch({ selection: { anchor: 1 } });
    view.dispatch({ selection: { anchor: 6 } });
    expect(marked(type(view, " "))).toBe("$x^{ab |}$");
  });

  it.each([
    ["a bad first character", { from: 4, to: 5, insert: "*" }, "$x^{*b |}$"],
    ["a bad later character", { from: 5, insert: "*" }, "$x^{a*b |}$"],
    ["one character left", { from: 5, to: 6 }, "$x^{a |}$"],
    ["a changed opening brace", { from: 3, to: 4, insert: "[" }, "$x^[ab |}$"],
  ])("stops tracking a group edited to %s", (_name, changes, expected) => {
    const view = type(editor("$x^|$"), "ab");
    view.dispatch({ changes });
    expect(marked(type(view, " "))).toBe(expected);
  });

  it("types plainly while a second caret sits inside the group", () => {
    const view = type(editor("$x^|$"), "ab");
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(5),
        EditorSelection.cursor(6),
      ]),
    });
    expect(marked(type(view, " "))).toBe("$x^{a |b |}$");
  });

  it("types plainly while another range is selected", () => {
    const view = type(editor("$x^|$ yy"), "ab");
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(6),
        EditorSelection.range(9, 11),
      ]),
    });
    expect(marked(type(view, " "))).toBe("$x^{ab |}$  |");
  });

  it("groups at every caret and leaves every group", () => {
    const view = type(editor("$x^|$ and $y_|$"), "ab");
    expect(marked(view)).toBe("$x^{ab|}$ and $y_{ab|}$");
    expect(marked(type(view, "="))).toBe("$x^{ab}=|$ and $y_{ab}=|$");
  });

  it("declines when one caret cannot start a group", () => {
    expect(typed("$x^|$ and $y|$", "ab")).toBe("$x^ab|$ and $yab|$");
  });

  it.each([
    ["outside math", "x^|", "ab", "x^ab|"],
    ["in a comment", "% $x^|$", "ab", "% $x^ab|$"],
    ["after an escaped underscore", "$a\\_|$", "bc", "$a\\_bc|$"],
    ["after a doubled caret", "$x^^|$", "ab", "$x^^ab|$"],
    ["against a following word", "$x^a|b$", "c", "$x^ac|b$"],
    ["after a non-script character", "$x^*|$", "ab", "$x^*ab|$"],
    ["at the very start", "|", "ab", "ab|"],
  ])("does nothing %s", (_name, doc, text, expected) => {
    expect(typed(doc, text)).toBe(expected);
  });

  it.each([
    ["\\label", "\\begin{equation}\n  \\label{eq_|}\n\\end{equation}", "ab", "\\begin{equation}\n  \\label{eq_ab|}\n\\end{equation}"],
    ["\\text", "$\\text{a_|}$", "bc", "$\\text{a_bc|}$"],
    ["\\tag*", "\\[ x \\tag*{a_|} \\]", "bc", "\\[ x \\tag*{a_bc|} \\]"],
    ["\\eqref", "$\\eqref{eq_|}$", "ab", "$\\eqref{eq_ab|}$"],
  ])("leaves the argument of %s alone", (_name, doc, text, expected) => {
    expect(typed(doc, text)).toBe(expected);
  });

  it.each([
    ["\\mathrm", "$\\mathrm{x_|}$", "ab", "$\\mathrm{x_{ab|}}$"],
    ["a bare group", "${x_|}$", "ab", "${x_{ab|}}$"],
    ["a closed text argument", "$\\text{a} x_|$", "ab", "$\\text{a} x_{ab|}$"],
    ["\\textcolor's second argument", "$\\textcolor{red}{x_|}$", "ab", "$\\textcolor{red}{x_{ab|}}$"],
    ["inline math inside \\text", "\\[ \\text{if $x_|$} \\]", "ab", "\\[ \\text{if $x_{ab|}$} \\]"],
    ["a text argument holding an escaped brace", "$\\text{\\{} x_|$", "ab", "$\\text{\\{} x_{ab|}$"],
  ])("groups inside %s", (_name, doc, text, expected) => {
    expect(typed(doc, text)).toBe(expected);
  });

  it("leaves keys alone in a read-only editor and in Vim normal mode", () => {
    const view = type(editor("$x^|$"), "ab");
    view.dispatch({
      effects: readOnly.reconfigure(EditorState.readOnly.of(true)),
    });
    press(view, "Backspace");
    press(view, "Enter");
    expect(marked(view)).toBe("$x^{ab|}$");
    view.dispatch({
      effects: readOnly.reconfigure(EditorState.readOnly.of(false)),
    });
    (view as unknown as { cm: unknown }).cm = {
      state: { vim: { insertMode: false } },
    };
    press(view, "Backspace");
    expect(view.state.doc.toString()).toBe("$x^{a}$");
  });

  it("ignores input that lands away from the caret", () => {
    const view = type(editor("$x^|$"), "a");
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) =>
        handler(view, 0, 0, "b", () => view.state.update({})),
      );
    expect(handled).toBe(false);
  });

  it("lets Enter accept an open completion", async () => {
    const view = editor("$x^|$", "latex", true, [
      autocompletion({
        interactionDelay: 0,
        override: [
          (context) => ({ from: context.pos, options: [{ label: "zz" }] }),
        ],
      }),
    ]);
    type(view, "ab");
    startCompletion(view);
    await vi.waitFor(() => {
      expect(completionStatus(view.state)).toBe("active");
    });
    press(view, "Enter");
    expect(marked(view)).toBe("$x^{abzz|}$");
  });

  it("ignores pasted text and the switch being off", () => {
    const view = editor("$x^|$");
    input(view, "ab");
    expect(marked(view)).toBe("$x^ab|$");
    expect(marked(type(editor("$x^|$", "latex", false), "ab"))).toBe("$x^ab|$");
  });
});

describe("Typst script groups", () => {
  it("groups a leading sign with what follows", () => {
    expect(typed("$x^|$", "-1", "typst")).toBe("$x^(-1|)$");
    expect(typed("$x^|$", "-12 ", "typst")).toBe("$x^(-12) |$");
    expect(typed("$e^|$", "-pi)", "typst")).toBe("$e^(-pi)|$");
  });

  it("leaves numbers and names to Typst", () => {
    expect(typed("$x^|$", "10", "typst")).toBe("$x^10|$");
    expect(typed("$x_|$", "ij", "typst")).toBe("$x_ij|$");
    expect(typed("$e^|$", "pi", "typst")).toBe("$e^pi|$");
  });

  it("does nothing in markup", () => {
    expect(typed("x^|", "-1", "typst")).toBe("x^-1|");
  });

  it("drops the parentheses with Backspace", () => {
    const view = type(editor("$x^|$", "typst"), "-1");
    press(view, "Backspace");
    expect(marked(view)).toBe("$x^-|$");
  });
});
