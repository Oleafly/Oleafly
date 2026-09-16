// @vitest-environment jsdom

import {
  closeBrackets,
  closeBracketsKeymap,
  type Completion,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  isolateHistory,
  undo,
} from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { latexLanguage } from "./latex";
import {
  inLatexIgnoredRegion,
  latexIgnoredRangesField,
  mathContextAt,
} from "./latex-lexical";
import { type LatexDelimiterCompletionSpec } from "./latex-delimiters";
import {
  latexDelimiterCompletionApply,
  latexPairChange,
  latexPairInputHandler,
  latexPairKeymap,
} from "./latex-pairs";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

const views: EditorView[] = [];
let transactionCount = 0;

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

interface PairOptions {
  math?: boolean;
  brackets?: boolean;
}

function mount(
  doc: string,
  selection: EditorSelection,
  options: PairOptions = {},
): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        history(),
        indentUnit.of("  "),
        latexLanguage(),
        closeBrackets(),
        latexPairInputHandler({
          math: options.math ?? true,
          brackets: options.brackets ?? true,
        }),
        keymap.of([
          ...latexPairKeymap,
          ...closeBracketsKeymap,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          transactionCount += update.transactions.length;
        }),
      ],
    }),
  });
  views.push(view);
  return view;
}

function editor(markedDoc: string, options?: PairOptions): EditorView {
  const cursors: number[] = [];
  let doc = "";
  for (const character of markedDoc) {
    if (character === "|") cursors.push(doc.length);
    else doc += character;
  }
  if (cursors.length === 0) throw new Error("missing | cursor marker");
  return mount(
    doc,
    EditorSelection.create(cursors.map((at) => EditorSelection.cursor(at))),
    options,
  );
}

function marked(target: EditorView): string {
  const heads = [...target.state.selection.ranges]
    .map((range) => range.head)
    .sort((a, b) => a - b);
  let out = "";
  let last = 0;
  for (const head of heads) {
    out += `${target.state.sliceDoc(last, head)}|`;
    last = head;
  }
  return out + target.state.sliceDoc(last);
}

function type(target: EditorView, text: string): boolean {
  const { from, to } = target.state.selection.main;
  for (const handler of target.state.facet(EditorView.inputHandler)) {
    if (
      handler(target, from, to, text, () =>
        target.state.update({ changes: { from, to, insert: text } }),
      )
    ) {
      return true;
    }
  }
  target.dispatch({
    ...target.state.replaceSelection(text),
    userEvent: "input.type",
    scrollIntoView: true,
  });
  return false;
}

function typed(
  markedDoc: string,
  text: string,
  options?: PairOptions,
): string {
  const target = editor(markedDoc, options);
  type(target, text);
  return marked(target);
}

function press(target: EditorView, key: string): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  target.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

const FILLER = "filler text that pads the document.\n".repeat(120);

describe("latexIgnoredRangesField", () => {
  const stateWith = (doc: string) =>
    EditorState.create({ doc, extensions: [latexIgnoredRangesField] });

  it("finds a comment that opened far above the caret window", () => {
    const doc = `% a comment ${FILLER.replace(/\n/gu, " ")} tail`;
    expect(doc.length).toBeGreaterThan(4 * 1024);
    expect(inLatexIgnoredRegion(stateWith(doc), doc.length)).toBe(true);
  });

  it("finds a verbatim environment that opened far above the caret", () => {
    const doc = `\\begin{verbatim}\n${FILLER}cost \n\\end{verbatim}`;
    const at = doc.indexOf("cost ") + "cost ".length;
    expect(at).toBeGreaterThan(4 * 1024);
    expect(inLatexIgnoredRegion(stateWith(doc), at)).toBe(true);
  });

  it("keeps ranges correct after an edit inside a region", () => {
    const doc = `\\begin{lstlisting}\n${FILLER}code \n\\end{lstlisting}\ntail`;
    const state = stateWith(doc);
    const at = doc.indexOf("code ") + "code ".length;
    const next = state.update({ changes: { from: at, insert: "x" } }).state;
    expect(inLatexIgnoredRegion(next, at + 1)).toBe(true);
    expect(inLatexIgnoredRegion(next, next.doc.length)).toBe(false);
  });

  it("re-opens a region when its opener is typed above existing text", () => {
    const state = stateWith("plain\ntail");
    const next = state.update({ changes: { from: 0, insert: "% " } }).state;
    expect(inLatexIgnoredRegion(next, "% plain".length)).toBe(true);
    expect(inLatexIgnoredRegion(next, next.doc.length)).toBe(false);
  });

  it("closes a region when its opener is deleted", () => {
    const doc = "% plain\ntail";
    const state = stateWith(doc);
    expect(inLatexIgnoredRegion(state, 4)).toBe(true);
    const next = state.update({ changes: { from: 0, to: 2 } }).state;
    expect(inLatexIgnoredRegion(next, 4)).toBe(false);
  });

  it("works without the field installed", () => {
    expect(
      inLatexIgnoredRegion(EditorState.create({ doc: "% c" }), 3),
    ).toBe(true);
  });

  it("extends an unfinished region that ends at the restart boundary", () => {
    const state = stateWith("\\begin{verbatim}\n");
    const next = state.update({
      changes: { from: state.doc.length, insert: " " },
    }).state;
    expect(inLatexIgnoredRegion(next, next.doc.length)).toBe(true);
  });
});

describe("mathContextAt", () => {
  const context = (markedDoc: string) => {
    const at = markedDoc.indexOf("|");
    const doc = markedDoc.slice(0, at) + markedDoc.slice(at + 1);
    return mathContextAt(EditorState.create({ doc }), at);
  };

  it("reports plain text outside math", () => {
    expect(context("Plain text |here")).toEqual({
      inMath: false,
      delimiter: null,
      from: null,
      width: 0,
    });
  });

  it("reports the delimiter that opened the region and where it starts", () => {
    expect(context("$x + |$")).toEqual({
      inMath: true,
      delimiter: "$",
      from: 0,
      width: 1,
    });
    expect(context("ab $$x + |$$")).toEqual({
      inMath: true,
      delimiter: "$",
      from: 3,
      width: 2,
    });
    expect(context("\\(x + |\\)")).toEqual({
      inMath: true,
      delimiter: "\\(",
      from: 0,
      width: 2,
    });
    expect(context("\\[x + |\\]")).toEqual({
      inMath: true,
      delimiter: "\\[",
      from: 0,
      width: 2,
    });
    expect(context("\\begin{equation}\n  x|\n")).toMatchObject({
      inMath: true,
      delimiter: "env",
    });
  });

  it("closes the region at its delimiter", () => {
    expect(context("$x$ and |")).toMatchObject({ inMath: false });
    expect(context("\\[x\\] and |")).toMatchObject({ inMath: false });
    expect(
      context("\\begin{equation}x\\end{equation} and |"),
    ).toMatchObject({ inMath: false });
  });

  it("does not carry an unclosed dollar across a blank line", () => {
    expect(context("$ x\n\nnext paragraph |")).toMatchObject({
      inMath: false,
    });
  });

  it("ignores dollars inside comments and verbatim", () => {
    expect(context("% price $5\nplain |")).toMatchObject({ inMath: false });
    expect(
      context("\\begin{verbatim}\n$\n\\end{verbatim}\nplain |"),
    ).toMatchObject({ inMath: false });
  });

  it("treats an escaped dollar as text", () => {
    expect(context("\\$5 and |")).toMatchObject({ inMath: false });
  });
});

describe("typing $", () => {
  it("row 1: pairs in text with an empty selection", () => {
    expect(typed("Text |", "$")).toBe("Text $|$");
  });

  it("row 2: wraps a non-empty selection", () => {
    const target = mount("abc", EditorSelection.single(0, 3), {});
    expect(type(target, "$")).toBe(true);
    expect(target.state.doc.toString()).toBe("$abc$");
    expect(target.state.selection.main.from).toBe(1);
    expect(target.state.selection.main.to).toBe(4);
  });

  it("row 3: overtypes the closing dollar of an open region", () => {
    expect(typed("$x|$", "$")).toBe("$x$|");
  });

  it("row 4: stays plain right after a single backslash", () => {
    expect(typed("cost \\|", "$")).toBe("cost \\$|");
  });

  it("row 5: pairs after an escaped backslash", () => {
    expect(typed("line \\\\|", "$")).toBe("line \\\\$|$");
  });

  it("row 6: stays plain inside a comment", () => {
    expect(typed("% a price of |\ntext", "$")).toBe("% a price of $|\ntext");
  });

  it("row 7: stays plain inside verbatim environments", () => {
    expect(
      typed("\\begin{verbatim}\ncost |\n\\end{verbatim}", "$"),
    ).toBe("\\begin{verbatim}\ncost $|\n\\end{verbatim}");
  });

  it("row 7: stays plain inside lstlisting", () => {
    expect(
      typed("\\begin{lstlisting}\ncost |\n\\end{lstlisting}", "$"),
    ).toBe("\\begin{lstlisting}\ncost $|\n\\end{lstlisting}");
  });

  it("row 7: stays plain inside minted", () => {
    expect(
      typed("\\begin{minted}{py}\ncost |\n\\end{minted}", "$"),
    ).toBe("\\begin{minted}{py}\ncost $|\n\\end{minted}");
  });

  it("row 7: stays plain inside inline verbatim", () => {
    const target = mount("\\verb+cost +", EditorSelection.single(11), {});
    type(target, "$");
    expect(target.state.doc.toString()).toBe("\\verb+cost $+");
  });

  it("row 7: stays plain inside \\lstinline", () => {
    const target = mount("\\lstinline|cost |", EditorSelection.single(16), {});
    type(target, "$");
    expect(target.state.doc.toString()).toBe("\\lstinline|cost $|");
  });

  it("stays plain inside a comment that opened outside the scan window", () => {
    const head = `% ${FILLER.replace(/\n/gu, " ")}cost `;
    expect(head.length).toBeGreaterThan(4 * 1024);
    const target = mount(`${head}\ntext`, EditorSelection.single(head.length));
    type(target, "$");
    expect(target.state.sliceDoc(head.length - 5, head.length + 1)).toBe(
      "cost $",
    );
  });

  it("stays plain inside verbatim that opened outside the scan window", () => {
    const head = `\\begin{verbatim}\n${FILLER}cost `;
    expect(head.length).toBeGreaterThan(4 * 1024);
    const target = mount(
      `${head}\n\\end{verbatim}`,
      EditorSelection.single(head.length),
    );
    type(target, "$");
    expect(target.state.sliceDoc(head.length, head.length + 2)).toBe("$\n");
  });

  const unfinishedBlocks: { name: string; opener: string }[] = [
    { name: "verbatim", opener: "\\begin{verbatim}\n" },
    { name: "lstlisting", opener: "\\begin{lstlisting}\n" },
    { name: "minted", opener: "\\begin{minted}{python}\n" },
  ];

  it.each(unfinishedBlocks)(
    "stays plain inside an unfinished $name block growing at the end of the document",
    ({ opener }) => {
      const target = editor(`${opener}|`);
      type(target, " ");
      type(target, "$");
      expect(target.state.doc.toString()).toBe(`${opener} $`);
    },
  );

  it("stays plain inside an unfinished inline verbatim at the end of the document", () => {
    const target = editor("\\verb+cost|");
    type(target, " ");
    type(target, "$");
    expect(target.state.doc.toString()).toBe("\\verb+cost $");
  });

  it("still pairs below a verbatim region that closed far above", () => {
    const head = `\\begin{verbatim}\n${FILLER}\\end{verbatim}\ncost `;
    const target = mount(head, EditorSelection.single(head.length));
    type(target, "$");
    expect(target.state.sliceDoc(head.length)).toBe("$$");
  });

  it("row 8: stays plain when the adjacent run of dollars is odd", () => {
    expect(typed("$|", "$")).toBe("$$|");
  });

  it("row 9: stays plain immediately before a command", () => {
    expect(typed("|\\nu x", "$")).toBe("$|\\nu x");
  });

  it("row 9: pairs before a backslash that is not a command", () => {
    expect(typed("|\\\\", "$")).toBe("$|$\\\\");
  });

  it("row 10: stays plain next to a word character", () => {
    expect(typed("foo|", "$")).toBe("foo$|");
    expect(typed("|bar", "$")).toBe("$|bar");
  });

  it("row 11: upgrades empty inline math to display math on its own line", () => {
    expect(typed("$|$", "$")).toBe("$$\n|\n$$");
  });

  it("row 11: upgrades empty inline math in place when the line has text", () => {
    expect(typed("see $|$ here", "$")).toBe("see $$|$$ here");
  });

  it("skips exactly one closer when another region follows immediately", () => {
    expect(typed("$x|$$y$", "$")).toBe("$x$|$y$");
  });

  it("does not upgrade between two closed regions", () => {
    expect(typed("$x$|$y$", "$")).toBe("$x$$|$y$");
  });

  it("overtypes only the closer of the region the caret sits in", () => {
    expect(typed("$x$$y|$", "$")).toBe("$x$$y$|");
  });

  it("closes an open region instead of opening a second one", () => {
    expect(typed("$ x |", "$")).toBe("$ x $|");
  });

  it("stays plain inside display and environment math", () => {
    expect(typed("\\[ x | \\]", "$")).toBe("\\[ x $| \\]");
    expect(
      typed("\\begin{align}\n  x |\n\\end{align}", "$"),
    ).toBe("\\begin{align}\n  x $|\n\\end{align}");
  });

  it("row 15: declines multi-character input such as a paste", () => {
    const target = editor("Text |");
    const { from, to } = target.state.selection.main;
    const handled = target.state
      .facet(EditorView.inputHandler)
      .some((handler) =>
        handler(target, from, to, "$x$", () =>
          target.state.update({ changes: { from, to, insert: "$x$" } }),
        ),
      );
    expect(handled).toBe(false);
    target.dispatch({
      changes: { from, insert: "$x$" },
      userEvent: "input.paste",
    });
    expect(target.state.doc.toString()).toBe("Text $x$");
  });

  it("row 16: handles every cursor of a multi-cursor selection", () => {
    expect(typed("a | b |", "$")).toBe("a $|$ b $|$");
  });

  it("row 16: applies each cursor's own context", () => {
    expect(typed("% c |\nx |", "$")).toBe("% c $|\nx $|$");
  });

  it("pairs in a single transaction", () => {
    const target = editor("Text |");
    transactionCount = 0;
    type(target, "$");
    expect(transactionCount).toBe(1);
    expect(marked(target)).toBe("Text $|$");
  });

  it("leaves the dollar alone when math pairing is off", () => {
    expect(typed("Text |", "$", { math: false })).toBe("Text $|");
  });
});

describe("typing brackets after a backslash", () => {
  it("row 12: pairs an inline math delimiter", () => {
    expect(typed("x \\|", "(")).toBe("x \\(|\\)");
  });

  it("row 12: opens display math across three lines", () => {
    expect(typed("\\|", "[")).toBe("\\[\n  |\n\\]");
  });

  it("row 12: keeps the indentation of the current line", () => {
    expect(typed("  \\|", "[")).toBe("  \\[\n    |\n  \\]");
  });

  it("row 12: leaves an escaped brace unpaired", () => {
    expect(typed("\\|", "{")).toBe("\\{|");
  });

  it("row 12: pairs normally when the backslash is escaped", () => {
    expect(typed("\\\\|", "(")).toBe("\\\\(|)");
  });

  it("row 13: auto-closes brackets before a closing dollar", () => {
    expect(typed("$x|$", "(")).toBe("$x(|)$");
    expect(typed("$x|$", "{")).toBe("$x{|}$");
    expect(typed("$x|$", "[")).toBe("$x[|]$");
  });

  it("keeps the library quote pairs", () => {
    expect(typed("say |", "'")).toBe("say '|'");
    expect(typed("say |", '"')).toBe('say "|"');
  });

  it("leaves a backtick unpaired", () => {
    expect(typed("say |", "`")).toBe("say `|");
  });

  it("stays plain inside a comment", () => {
    expect(typed("% see \\|", "(")).toBe("% see \\(|)");
  });

  it("opens a delimiter at every cursor when they all follow a backslash", () => {
    expect(typed("x \\| and y \\|", "(")).toBe("x \\(|\\) and y \\(|\\)");
  });

  it("declines a mixed multi-cursor selection so closeBrackets owns every cursor", () => {
    expect(typed("x \\| and y |", "(")).toBe("x \\(|) and y (|)");
    expect(typed("x \\| and y |", "[")).toBe("x \\[|] and y [|]");
    expect(typed("x \\| and y |", "{")).toBe("x \\{|} and y {|}");
  });

  it("keeps closer tracking after a mixed multi-cursor pair", () => {
    const target = editor("x \\| and y |");
    type(target, "(");
    expect(target.state.doc.toString()).toBe("x \\() and y ()");
    target.dispatch({ selection: { anchor: target.state.doc.length - 1 } });
    type(target, ")");
    expect(target.state.doc.toString()).toBe("x \\() and y ()");
    expect(target.state.selection.main.head).toBe(target.state.doc.length);
  });

  it("falls back to plain bracket pairing when math is off", () => {
    expect(typed("\\|", "(", { math: false })).toBe("\\(|)");
  });

  it("opens a delimiter in a single transaction", () => {
    const target = editor("x \\| and y \\|");
    transactionCount = 0;
    type(target, "(");
    expect(transactionCount).toBe(1);
  });
});

describe("latexPairKeymap", () => {
  it.each([
    ["math", "x $|$"],
    ["inline delimiter", String.raw`x \(|\)`],
    ["display delimiter", String.raw`x \[|\]`],
  ])("row 14: deletes both halves of an empty %s pair", (_kind, source) => {
    const target = editor(source);
    expect(latexPairKeymap[0].run?.(target)).toBe(true);
    expect(marked(target)).toBe("x |");
  });

  it("hands the second Backspace to the default deletion", () => {
    const target = editor("xy $|$");
    expect(press(target, "Backspace")).toBe(true);
    expect(marked(target)).toBe("xy |");
    expect(press(target, "Backspace")).toBe(true);
    expect(marked(target)).toBe("xy|");
  });

  it("leaves the pair alone for vim outside insert mode", () => {
    const target = editor("x $|$");
    (target as unknown as { cm: unknown }).cm = {
      state: { vim: { insertMode: false } },
    };
    expect(latexPairKeymap[0].run?.(target)).toBe(false);
    expect(type(target, "$")).toBe(false);
    expect(target.state.doc.toString()).toBe("x $$$");
  });

  it("declines so the default deletion still runs", () => {
    const target = editor("x $y|$");
    expect(latexPairKeymap[0].run?.(target)).toBe(false);
    expect(target.state.doc.toString()).toBe("x $y$");
  });
});

describe("live reconfiguration", () => {
  it("stops pairing as soon as the preference compartment turns off", () => {
    const pairs = new Compartment();
    const parent = document.createElement("div");
    document.body.append(parent);
    const target = new EditorView({
      parent,
      state: EditorState.create({
        doc: "a ",
        selection: EditorSelection.single(2),
        extensions: [
          latexLanguage(),
          pairs.of([
            closeBrackets(),
            latexPairInputHandler({ math: true, brackets: true }),
          ]),
        ],
      }),
    });
    views.push(target);

    type(target, "$");
    expect(marked(target)).toBe("a $|$");

    target.dispatch({
      effects: pairs.reconfigure(
        latexPairInputHandler({ math: false, brackets: false }),
      ),
    });
    target.dispatch({ selection: { anchor: target.state.doc.length } });
    type(target, "$");
    expect(target.state.doc.toString()).toBe("a $$$");
    type(target, "(");
    expect(target.state.doc.toString()).toBe("a $$$(");
  });
});

const CARET = "\u2038";

function caretMarked(target: EditorView): string {
  const head = target.state.selection.main.head;
  return `${target.state.sliceDoc(0, head)}${CARET}${target.state.sliceDoc(head)}`;
}

function typedAt(
  doc: string,
  offset: number,
  text: string,
  options?: PairOptions,
): string {
  const target = mount(doc, EditorSelection.single(offset), options);
  type(target, text);
  return caretMarked(target);
}

function afterTyping(
  prefix: string,
  text: string,
  options?: PairOptions,
): string {
  return typedAt(prefix, prefix.length, text, options);
}

function keys(target: EditorView, text: string): void {
  for (const character of text) type(target, character);
}

function afterKeys(prefix: string, text: string, options?: PairOptions): string {
  const target = mount(prefix, EditorSelection.single(prefix.length), options);
  keys(target, text);
  return caretMarked(target);
}

function fakeCompletion(label: string): Completion {
  return { label };
}

function acceptSpec(
  target: EditorView,
  spec: LatexDelimiterCompletionSpec,
  from: number,
  to: number,
): void {
  latexDelimiterCompletionApply(spec)(target, fakeCompletion(spec.label), from, to);
}

const LEFT_LANGLE: LatexDelimiterCompletionSpec = {
  kind: "pair",
  label: String.raw`\left\langle`,
  detail: "",
  closer: { command: "right", glyph: String.raw`\rangle` },
};

const RIGHT_RANGLE: LatexDelimiterCompletionSpec = {
  kind: "closer",
  label: String.raw`\right\rangle`,
  detail: "",
  closer: { command: "right", glyph: String.raw`\rangle` },
};

const LANGLE: LatexDelimiterCompletionSpec = {
  kind: "pair",
  label: String.raw`\langle`,
  detail: "",
  closer: { command: "", glyph: String.raw`\rangle` },
};

const MIDDLE_BAR: LatexDelimiterCompletionSpec = {
  kind: "plain",
  label: String.raw`\middle|`,
  detail: "",
};

describe("auto-sized delimiter pairing", () => {
  it("closes every bare glyph typed after \\left", () => {
    expect(afterTyping("\\left", "(")).toBe(`\\left(${CARET}\\right)`);
    expect(afterTyping("\\left", "[")).toBe(`\\left[${CARET}\\right]`);
    expect(afterTyping("\\left", "<")).toBe(`\\left<${CARET}\\right>`);
    expect(afterTyping("\\left", "|")).toBe(`\\left|${CARET}\\right|`);
  });

  it("closes the escaped glyphs typed after \\left\\", () => {
    expect(afterTyping("\\left\\", "{")).toBe(`\\left\\{${CARET}\\right\\}`);
    expect(afterTyping("\\left\\", "|")).toBe(`\\left\\|${CARET}\\right\\|`);
  });

  it("closes a glyph separated from its size command by a space", () => {
    expect(afterTyping("\\left ", "(")).toBe(`\\left (${CARET}\\right)`);
    expect(afterTyping("\\bigl \\", "{")).toBe(`\\bigl \\{${CARET}\\bigr\\}`);
  });

  it("keeps the caret inside the new pair", () => {
    const target = mount(
      "\\left",
      EditorSelection.single("\\left".length),
    );
    type(target, "(");
    expect(target.state.selection.main.head).toBe("\\left(".length);
    expect(target.state.selection.main.empty).toBe(true);
  });
});

describe("fixed-size delimiter pairing", () => {
  it("matches each sized opener with its own closer", () => {
    expect(afterTyping("\\bigl", "(")).toBe(`\\bigl(${CARET}\\bigr)`);
    expect(afterTyping("\\Bigl", "[")).toBe(`\\Bigl[${CARET}\\Bigr]`);
    expect(afterTyping("\\biggl\\", "{")).toBe(
      `\\biggl\\{${CARET}\\biggr\\}`,
    );
    expect(afterTyping("\\Biggl", "(")).toBe(`\\Biggl(${CARET}\\Biggr)`);
    expect(afterTyping("\\bigl", "|")).toBe(`\\bigl|${CARET}\\bigr|`);
  });

  it("repeats the same command for the symmetric sizes", () => {
    expect(afterTyping("\\big", "(")).toBe(`\\big(${CARET}\\big)`);
    expect(afterTyping("\\Big", "[")).toBe(`\\Big[${CARET}\\Big]`);
    expect(afterTyping("\\bigg", "<")).toBe(`\\bigg<${CARET}\\bigg>`);
    expect(afterTyping("\\Bigg\\", "{")).toBe(`\\Bigg\\{${CARET}\\Bigg\\}`);
  });

  it("leaves a symmetric glyph alone after a symmetric size", () => {
    expect(afterTyping("\\big", "|")).toBe(`\\big|${CARET}`);
    expect(afterTyping("\\Bigg\\", "|")).toBe(`\\Bigg\\|${CARET}`);
    expect(afterKeys("$f(x)", "\\big|_0^1$")).toBe(`$f(x)\\big|_0^1$${CARET}`);
  });
});

describe("delimiters that take no partner", () => {
  it("leaves a separator unpaired", () => {
    expect(afterTyping("\\middle", "|")).toBe(`\\middle|${CARET}`);
    expect(afterTyping("\\bigm", "|")).toBe(`\\bigm|${CARET}`);
    expect(afterTyping("\\Biggm\\", "|")).toBe(`\\Biggm\\|${CARET}`);
  });

  it("keeps the generic bracket handler off a separator", () => {
    expect(afterTyping("\\middle", "(")).toBe(`\\middle(${CARET}`);
  });

  it("leaves a closing size command unpaired", () => {
    expect(afterTyping("\\right", "(")).toBe(`\\right(${CARET}`);
    expect(afterTyping("\\bigr", "[")).toBe(`\\bigr[${CARET}`);
  });

  it("does not invent a closer for a null delimiter", () => {
    expect(afterTyping("\\left", ".")).toBe(`\\left.${CARET}`);
  });
});

describe("semantic pairing boundaries", () => {
  it("ignores a size command whose backslash is escaped", () => {
    expect(afterTyping("\\\\left", "(")).toBe(`\\\\left(${CARET})`);
  });

  it("ignores a word that merely starts with a size command", () => {
    expect(afterTyping("\\lefty", "(")).toBe(`\\lefty(${CARET})`);
  });

  it("leaves comments and verbatim blocks alone", () => {
    expect(afterTyping("% \\left", "(")).toBe(`% \\left(${CARET})`);
    const verbatim = "\\begin{verbatim}\n\\left";
    expect(afterTyping(verbatim, "(")).toBe(`${verbatim}(${CARET})`);
  });

  it("still pairs \\( and \\[ the way it always did", () => {
    expect(afterTyping("\\", "(")).toBe(`\\(${CARET}\\)`);
    expect(afterTyping("\\", "{")).toBe(`\\{${CARET}`);
  });

  it("does nothing when math auto-close is off", () => {
    expect(afterTyping("\\left", "(", { math: false })).toBe(
      `\\left(${CARET})`,
    );
  });
});

describe("the character after the caret", () => {
  it("refuses to pair when the glyph would sit against a word", () => {
    expect(typedAt("\\leftx^2", 5, "(")).toBe(`\\left(${CARET}x^2`);
    expect(typedAt("\\left\\frac{a}{b}", 5, "(")).toBe(
      `\\left(${CARET}\\frac{a}{b}`,
    );
    expect(typedAt("\\left\\x", 6, "{")).toBe(`\\left\\{${CARET}x`);
  });

  it("pairs before whitespace, punctuation and a math closer", () => {
    expect(typedAt("\\left x", 5, "(")).toBe(`\\left(${CARET}\\right) x`);
    expect(typedAt("\\left)", 5, "(")).toBe(`\\left(${CARET}\\right))`);
    expect(typedAt("$\\left$", 6, "(")).toBe(`$\\left(${CARET}\\right)$`);
    expect(typedAt("\\[\\left\\]", 7, "(")).toBe(
      `\\[\\left(${CARET}\\right)\\]`,
    );
    expect(typedAt("\\left\\\\", 5, "(")).toBe(`\\left(${CARET}\\right)\\\\`);
  });

  it("pairs before a closing delimiter so nesting keeps working", () => {
    expect(typedAt("\\left\\right)", 5, "(")).toBe(
      `\\left(${CARET}\\right)\\right)`,
    );
    expect(typedAt("\\bigl\\rangle", 5, "(")).toBe(
      `\\bigl(${CARET}\\bigr)\\rangle`,
    );
  });
});

describe("nested and multiline delimiters", () => {
  it("pairs an inner delimiter inside an outer one", () => {
    expect(afterKeys("", "\\left(\\left[")).toBe(
      `\\left(\\left[${CARET}\\right]\\right)`,
    );
  });

  it("pairs a sized delimiter typed inside another family", () => {
    expect(afterKeys("", "\\left(\\bigl(")).toBe(
      `\\left(\\bigl(${CARET}\\bigr)\\right)`,
    );
  });

  it("pairs across a multiline body", () => {
    const doc = "\\left(\n  \\bigl\n\\right)";
    expect(typedAt(doc, doc.indexOf("\\bigl") + 5, "<")).toBe(
      `\\left(\n  \\bigl<${CARET}\\bigr>\n\\right)`,
    );
  });

  it("keeps an inner paren pair inside a sized pair", () => {
    expect(afterKeys("", "\\left((a+b)")).toBe(`\\left((a+b)${CARET}\\right)`);
    expect(afterKeys("", "\\left(f(x)")).toBe(`\\left(f(x)${CARET}\\right)`);
    expect(afterKeys("", "\\left((a+b)(c+d))")).toBe(
      `\\left((a+b)(c+d)\\right)${CARET}`,
    );
  });

  it("closes an inner sized pair before the outer one", () => {
    expect(afterKeys("", "\\left(\\bigl[x]y)")).toBe(
      `\\left(\\bigl[x\\bigr]y\\right)${CARET}`,
    );
  });
});

describe("overtyping a closer the editor inserted", () => {
  it("steps over the closer instead of writing a second one", () => {
    expect(afterKeys("", "\\left(x)")).toBe(`\\left(x\\right)${CARET}`);
    expect(afterKeys("", "\\left[x]")).toBe(`\\left[x\\right]${CARET}`);
    expect(afterKeys("", "\\left<x>")).toBe(`\\left<x\\right>${CARET}`);
    expect(afterKeys("", "\\left|x|")).toBe(`\\left|x\\right|${CARET}`);
    expect(afterKeys("", "\\bigl(x)")).toBe(`\\bigl(x\\bigr)${CARET}`);
    expect(afterKeys("", "\\big(x)")).toBe(`\\big(x\\big)${CARET}`);
  });

  it("steps over an escaped closer typed as its glyph", () => {
    expect(afterKeys("", "\\left\\{x\\}")).toBe(`\\left\\{x\\right\\}${CARET}`);
    expect(afterKeys("", "\\left\\|x\\|")).toBe(`\\left\\|x\\right\\|${CARET}`);
    expect(afterKeys("", "\\left\\{x}")).toBe(`\\left\\{x\\right\\}${CARET}`);
  });

  it("consumes a closer the user spells out in full", () => {
    expect(afterKeys("", "\\left(x\\right)")).toBe(`\\left(x\\right)${CARET}`);
    expect(afterKeys("", "\\left\\{x\\right\\}")).toBe(
      `\\left\\{x\\right\\}${CARET}`,
    );
    expect(afterKeys("", "\\bigl(x\\bigr)")).toBe(`\\bigl(x\\bigr)${CARET}`);
    expect(afterKeys("", "\\big(x\\big)")).toBe(`\\big(x\\big)${CARET}`);
    expect(afterKeys("", "\\left(x\\right )")).toBe(`\\left(x\\right)${CARET}`);
  });

  it("spells the closer out across lines too", () => {
    const target = mount("", EditorSelection.single(0));
    keys(target, "\\left(");
    press(target, "Enter");
    keys(target, "x");
    press(target, "Enter");
    keys(target, "\\right)");
    expect(target.state.doc.toString()).toBe("\\left(\nx\n\\right)");
  });

  it("writes the glyph when the user spells a different closer", () => {
    expect(afterKeys("", "\\left(x\\bigr)")).toBe(
      `\\left(x\\bigr)${CARET}\\right)`,
    );
    expect(afterKeys("", "\\left(x\\)")).toBe(`\\left(x\\)${CARET}\\right)`);
    expect(afterKeys("", "\\left\\{x\\right}")).toBe(
      `\\left\\{x\\right}${CARET}\\right\\}`,
    );
  });

  it("does not step over a closer the editor did not insert", () => {
    expect(typedAt("\\left(\\right)", 6, ")")).toBe(`\\left()${CARET}\\right)`);
    expect(typedAt("\\left(x\\bigr)", 7, ")")).toBe(
      `\\left(x)${CARET}\\bigr)`,
    );
  });

  it("forgets a closer once the caret leaves its line", () => {
    const target = mount("\n", EditorSelection.single(0));
    keys(target, "\\left(");
    target.dispatch({ selection: EditorSelection.cursor(target.state.doc.length) });
    target.dispatch({ selection: EditorSelection.cursor("\\left(".length) });
    type(target, ")");
    expect(caretMarked(target)).toBe(`\\left()${CARET}\\right)\n`);
  });

  it("forgets a closer the user edited", () => {
    const target = mount("", EditorSelection.single(0));
    keys(target, "\\left(");
    const closer = target.state.doc.toString().indexOf("\\right)");
    target.dispatch({
      changes: { from: closer + 6, to: closer + 7, insert: "]" },
    });
    type(target, ")");
    expect(caretMarked(target)).toBe(`\\left()${CARET}\\right]`);
  });

  it("makes stepping over a closer undoable", () => {
    const target = mount("", EditorSelection.single(0));
    keys(target, "\\left(x");
    const spec = latexPairChange(target.state, ")", {
      math: true,
      brackets: true,
    });
    target.dispatch({ ...spec, annotations: isolateHistory.of("before") });
    expect(caretMarked(target)).toBe(`\\left(x\\right)${CARET}`);
    expect(undo(target)).toBe(true);
    expect(caretMarked(target)).toBe(`\\left(x${CARET}\\right)`);
  });
});

describe("closers inserted by completion", () => {
  it("tracks the closer of an accepted pair", () => {
    const target = mount("\\left\\lan", EditorSelection.single(9));
    acceptSpec(target, LEFT_LANGLE, 0, 9);
    expect(caretMarked(target)).toBe(`\\left\\langle${CARET}\\right\\rangle`);
    keys(target, " x\\right\\rangle");
    expect(caretMarked(target)).toBe(`\\left\\langle x\\right\\rangle${CARET}`);
  });

  it("consumes a pending closer when its glyph is spelled alone", () => {
    const target = mount("", EditorSelection.single(0));
    acceptSpec(target, LEFT_LANGLE, 0, 0);
    keys(target, " x\\rangle");
    expect(caretMarked(target)).toBe(`\\left\\langle x\\right\\rangle${CARET}`);
  });

  it("consumes a pending closer when the closer is accepted from the list", () => {
    const target = mount("", EditorSelection.single(0));
    acceptSpec(target, LEFT_LANGLE, 0, 0);
    keys(target, " x\\right\\ra");
    const from = target.state.doc.toString().indexOf("\\right\\ra");
    acceptSpec(target, RIGHT_RANGLE, from, from + "\\right\\ra".length);
    expect(caretMarked(target)).toBe(`\\left\\langle x\\right\\rangle${CARET}`);
  });

  it("inserts an accepted closer plainly when nothing is pending", () => {
    const target = mount("x\\right\\ra", EditorSelection.single(10));
    acceptSpec(target, RIGHT_RANGLE, 1, 10);
    expect(caretMarked(target)).toBe(`x\\right\\rangle${CARET}`);
  });

  it("tracks a standalone pair and inserts a plain entry verbatim", () => {
    const target = mount("\\lan", EditorSelection.single(4));
    acceptSpec(target, LANGLE, 0, 4);
    keys(target, " x\\rangle");
    expect(caretMarked(target)).toBe(`\\langle x\\rangle${CARET}`);
    const plain = mount("\\mid", EditorSelection.single(4));
    acceptSpec(plain, MIDDLE_BAR, 0, 4);
    expect(caretMarked(plain)).toBe(`\\middle|${CARET}`);
  });
});

describe("backspacing an empty semantic pair", () => {
  function backspaceAt(doc: string, offset: number): string {
    const target = mount(doc, EditorSelection.single(offset));
    press(target, "Backspace");
    return caretMarked(target);
  }

  it("removes both halves of a sized pair", () => {
    expect(backspaceAt("\\left(\\right)", 6)).toBe(CARET);
    expect(backspaceAt("\\bigl[\\bigr]", 6)).toBe(CARET);
    expect(backspaceAt("\\Biggl\\{\\Biggr\\}", 8)).toBe(CARET);
    expect(backspaceAt("\\big(\\big)", 5)).toBe(CARET);
    expect(backspaceAt("\\left (\\right)", 7)).toBe(CARET);
  });

  it("removes both halves of a named and a null pair", () => {
    expect(backspaceAt("\\left\\langle\\right\\rangle", 12)).toBe(CARET);
    expect(backspaceAt("\\langle\\rangle", 7)).toBe(CARET);
    expect(backspaceAt("\\left.\\right.", 6)).toBe(CARET);
  });

  it("keeps surrounding text", () => {
    expect(backspaceAt("a\\left(\\right)b", 7)).toBe(`a${CARET}b`);
  });

  it("leaves a pair with a body alone", () => {
    expect(backspaceAt("\\left(x\\right)", 7)).toBe(`\\left(${CARET}\\right)`);
  });

  it("leaves a mismatched pair alone", () => {
    expect(backspaceAt("\\left(\\bigr)", 6)).toBe(`\\left${CARET}\\bigr)`);
    expect(backspaceAt("\\big|\\big|", 5)).toBe(`\\big${CARET}\\big|`);
  });

  it("leaves an escaped opener alone", () => {
    expect(backspaceAt("\\\\left(\\right)", 7)).toBe(`\\\\left${CARET}\\right)`);
  });
});

describe("wrapping a selection in a semantic delimiter", () => {
  function wrapped(doc: string, from: number, to: number, text: string) {
    const target = mount(doc, EditorSelection.single(from, to));
    type(target, text);
    return target.state.doc.toString();
  }

  it("wraps the selection rather than replacing it", () => {
    expect(
      wrapped("\\left x + y", "\\left".length, "\\left x + y".length, "("),
    ).toBe("\\left( x + y\\right)");
  });

  it("wraps a selection that follows a spaced size command", () => {
    expect(
      wrapped("\\left x + y", "\\left ".length, "\\left x + y".length, "("),
    ).toBe("\\left (x + y\\right)");
  });

  it("leaves a word that only starts with a size command to the generic handler", () => {
    expect(
      wrapped("\\lefty x", "\\lefty ".length, "\\lefty x".length, "("),
    ).toBe("\\lefty (x)");
  });

  it("wraps with an escaped glyph too", () => {
    expect(wrapped("\\left\\ab", "\\left\\".length, "\\left\\ab".length, "{")).toBe(
      "\\left\\{ab\\right\\}",
    );
  });

  it("keeps the selection over the wrapped text", () => {
    const doc = "\\left\\ab";
    const target = mount(doc, EditorSelection.single(6, doc.length));
    type(target, "{");
    const main = target.state.selection.main;
    expect(target.state.sliceDoc(main.from, main.to)).toBe("ab");
  });

  it("tracks the closer written around a selection", () => {
    const doc = "\\left x";
    const target = mount(doc, EditorSelection.single(5, doc.length));
    type(target, "(");
    target.dispatch({ selection: EditorSelection.cursor(target.state.selection.main.to) });
    type(target, ")");
    expect(caretMarked(target)).toBe(`\\left( x\\right)${CARET}`);
  });
});

describe("multiple cursors in semantic delimiters", () => {
  function cursors(doc: string, offsets: number[]): EditorView {
    return mount(
      doc,
      EditorSelection.create(offsets.map((at) => EditorSelection.cursor(at))),
    );
  }

  it("pairs at every cursor at once", () => {
    const doc = "\\left\n\\bigl";
    const target = cursors(doc, ["\\left".length, doc.length]);
    type(target, "(");
    expect(target.state.doc.toString()).toBe(
      "\\left(\\right)\n\\bigl(\\bigr)",
    );
  });

  it("declines when only some cursors follow a size command", () => {
    const doc = "\\left\nplain";
    const target = cursors(doc, ["\\left".length, doc.length]);
    type(target, "(");
    expect(target.state.doc.toString()).toBe("\\left()\nplain()");
  });

  it("steps over the closer at every cursor at once", () => {
    const target = cursors("\\left\n\\bigl", ["\\left".length, "\\left\n\\bigl".length]);
    type(target, "(");
    type(target, ")");
    expect(target.state.doc.toString()).toBe("\\left(\\right)\n\\bigl(\\bigr)");
    expect(target.state.selection.ranges.map((range) => range.head)).toEqual([
      "\\left(\\right)".length,
      "\\left(\\right)\n\\bigl(\\bigr)".length,
    ]);
  });
});

describe("math environments the delimiter families are written in", () => {
  function inMath(name: string): boolean {
    const doc = `\\begin{${name}}\nx + \n\\end{${name}}`;
    return mathContextAt(
      EditorState.create({ doc }),
      doc.indexOf("x + ") + 4,
    ).inMath;
  }

  it("recognises the alignment environments", () => {
    for (const name of [
      "align",
      "align*",
      "alignat",
      "alignat*",
      "aligned",
      "alignedat",
      "alignedat*",
      "flalign",
      "flalign*",
      "xalignat",
      "xalignat*",
      "xxalignat",
    ]) {
      expect(inMath(name), name).toBe(true);
    }
  });

  it("recognises the gathered, split and multiline environments", () => {
    for (const name of [
      "gather",
      "gather*",
      "gathered",
      "split",
      "multline",
      "multline*",
      "multlined",
      "IEEEeqnarray",
      "IEEEeqnarray*",
    ]) {
      expect(inMath(name), name).toBe(true);
    }
  });

  it("recognises the matrix and case environments", () => {
    for (const name of [
      "matrix",
      "matrix*",
      "pmatrix",
      "pmatrix*",
      "bmatrix",
      "Bmatrix*",
      "vmatrix",
      "Vmatrix*",
      "smallmatrix",
      "smallmatrix*",
      "subarray",
      "cases",
      "cases*",
      "dcases",
      "rcases",
      "drcases",
      "numcases",
      "subnumcases",
    ]) {
      expect(inMath(name), name).toBe(true);
    }
  });

  it("leaves a wrapper that only holds equations out of math", () => {
    expect(inMath("subequations")).toBe(false);
    expect(inMath("figure")).toBe(false);
    expect(inMath("itemize")).toBe(false);
  });

  it("pairs a semantic delimiter typed inside a math environment", () => {
    const doc = "\\begin{alignat}{2}\n  \\bigl\n\\end{alignat}";
    expect(typedAt(doc, doc.indexOf("\\bigl") + 5, "(")).toBe(
      `\\begin{alignat}{2}\n  \\bigl(${CARET}\\bigr)\n\\end{alignat}`,
    );
  });
});

describe("input that never reaches semantic pairing", () => {
  it("declines a multi-character insertion such as a paste", () => {
    const state = EditorState.create({
      doc: "\\left",
      selection: EditorSelection.single("\\left".length),
    });
    expect(
      latexPairChange(state, "\\left(", { math: true, brackets: true }),
    ).toBeNull();
    expect(
      latexPairChange(state, "((", { math: true, brackets: true }),
    ).toBeNull();
  });

  it("declines in a read-only document", () => {
    const state = EditorState.create({
      doc: "\\left",
      selection: EditorSelection.single("\\left".length),
      extensions: [EditorState.readOnly.of(true)],
    });
    expect(
      latexPairChange(state, "(", { math: true, brackets: true }),
    ).toBeNull();
  });

  it("leaves the pair alone for vim outside insert mode", () => {
    const target = mount("\\left", EditorSelection.single("\\left".length));
    (target as unknown as { cm: unknown }).cm = {
      state: { vim: { insertMode: false } },
    };
    type(target, "(");
    expect(target.state.doc.toString()).toBe("\\left()");
    expect(target.state.doc.toString()).not.toContain("\\right");
  });

  it("pairs again once vim is back in insert mode", () => {
    const target = mount("\\left", EditorSelection.single("\\left".length));
    (target as unknown as { cm: unknown }).cm = {
      state: { vim: { insertMode: true } },
    };
    type(target, "(");
    expect(target.state.doc.toString()).toBe("\\left(\\right)");
  });

  it("survives a size command sitting at the very start of the document", () => {
    expect(afterTyping("\\bigl", "(")).toBe(`\\bigl(${CARET}\\bigr)`);
  });

  it("survives an unfinished command and a stray backslash", () => {
    expect(afterTyping("\\", "|")).toBe(`\\|${CARET}`);
    expect(afterTyping("\\lef\\", "{")).toBe(`\\lef\\{${CARET}`);
    expect(afterTyping("\\\\", "(")).toBe(`\\\\(${CARET})`);
  });

  it("ignores ordinary characters while a closer is pending", () => {
    expect(afterKeys("", "\\left(a+b")).toBe(`\\left(a+b${CARET}\\right)`);
  });
});

describe("overloaded glyphs and deliberate mixed forms", () => {
  it("never pairs a bare bar outside a size command", () => {
    expect(afterTyping("$a ", "|")).toBe(`$a |${CARET}`);
    expect(afterTyping("$a \\", "|")).toBe(`$a \\|${CARET}`);
    expect(afterTyping("text ", "<")).toBe(`text <${CARET}`);
  });

  it("lets the user close a pair with a different glyph", () => {
    const doc = "\\left(x\\right";
    expect(typedAt(doc, doc.length, "]")).toBe(
      `\\left(x\\right]${CARET}`,
    );
  });

  it("lets the user close a pair with a null delimiter", () => {
    const doc = "\\left(x\\right";
    expect(typedAt(doc, doc.length, ".")).toBe(
      `\\left(x\\right.${CARET}`,
    );
  });

  it("leaves a deliberately mixed pair in place on backspace", () => {
    const target = mount("\\left(\\right.", EditorSelection.single(6));
    press(target, "Backspace");
    expect(target.state.doc.toString()).toBe("\\left\\right.");
  });
});
