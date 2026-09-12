// @vitest-environment jsdom

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
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
import { latexPairInputHandler, latexPairKeymap } from "./latex-pairs";

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
