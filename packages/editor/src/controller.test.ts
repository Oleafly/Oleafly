// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { history } from "@codemirror/commands";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { type BlockInfo, EditorView } from "@codemirror/view";
import { CodeMirror, getCM, vim } from "@replit/codemirror-vim";
import {
  centerWithinEditor,
  editorRedo,
  editorUndo,
  editorVimRedo,
  editorVimUndo,
  gotoLine,
  insertListEnvironment,
  insertTemplate,
  revealEditorRange,
  selectWordNearLine,
  setEditorView,
} from "./controller";

let view: EditorView | null = null;

afterEach(() => {
  setEditorView(null);
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("editor controller lists", () => {
  function mount(doc: string, from: number, to: number): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [history()] }),
    });
    setEditorView(view);
    return view;
  }

  it("turns each selected line into an item and leaves the caret after the last one", () => {
    const editor = mount("intro\nfirst\n\nsecond\noutro", 6, 19);
    insertListEnvironment("itemize");
    expect(editor.state.doc.toString()).toBe(
      "intro\n\\begin{itemize}\n  \\item first\n  \\item second\n\\end{itemize}\n\noutro",
    );
    expect(editor.state.doc.sliceString(0, editor.state.selection.main.head)).toMatch(/\\item second$/u);
  });

  it("inserts an empty item with the caret ready for typing when nothing is selected", () => {
    const editor = mount("intro\n", 6, 6);
    insertListEnvironment("enumerate");
    expect(editor.state.doc.toString()).toBe("intro\n\\begin{enumerate}\n  \\item \n\\end{enumerate}\n");
    expect(editor.state.doc.sliceString(0, editor.state.selection.main.head)).toMatch(/\\item $/u);
  });
});

describe("editor controller history", () => {
  it("keeps consecutive toolbar insertions as separate undo steps", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({ extensions: [history()] }),
    });
    setEditorView(view);

    insertTemplate("FIRST", 5, 5);
    insertTemplate("SECOND", 6, 6);
    expect(view.state.doc.toString()).toBe("FIRSTSECOND");

    editorUndo();
    expect(view.state.doc.toString()).toBe("FIRST");

    editorRedo();
    expect(view.state.doc.toString()).toBe("FIRSTSECOND");
  });

  it("routes native history requests through Vim's adapter when enabled", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "before",
        extensions: [history(), vim()],
      }),
    });
    setEditorView(view);
    const cm = getCM(view);
    expect(cm).not.toBeNull();
    cm!.operation(() => {
      view!.dispatch({
        changes: { from: 0, to: 6, insert: "after" },
        selection: { anchor: 5 },
      });
    });

    const undo = vi.spyOn(CodeMirror.commands, "undo");
    const redo = vi.spyOn(CodeMirror.commands, "redo");

    expect(editorVimUndo()).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe("before");
    expect(view.state.selection.main.head).toBe(0);
    expect(cm!.curOp).toBeNull();

    expect(editorVimRedo()).toBe(true);
    expect(redo).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe("after");
    expect(view.state.selection.main.head).toBe(0);
    expect(cm!.curOp).toBeNull();
  });
});

describe("editor controller navigation", () => {
  it("synchronizes the DOM selection when navigation returns focus from a toolbar", () => {
    const parent = document.createElement("div");
    const toolbar = document.createElement("button");
    document.body.append(parent, toolbar);
    view = new EditorView({
      parent,
      state: EditorState.create({ doc: "original reference\nselected definition" }),
    });
    view.focus();
    toolbar.focus();

    revealEditorRange(view, 19, 38);

    const selection = window.getSelection()!;
    expect(view.state.selection.main.from).toBe(19);
    expect(view.state.selection.main.to).toBe(38);
    expect(view.posAtDOM(selection.anchorNode!, selection.anchorOffset)).toBe(19);
    expect(view.posAtDOM(selection.focusNode!, selection.focusOffset)).toBe(38);
  });

  it("centers a distant source line without scrolling the application shell", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join(
          "\n",
        ),
      }),
    });
    setEditorView(view);

    document.documentElement.scrollTop = 47;
    document.body.scrollTop = 31;
    Object.defineProperty(view.scrollDOM, "clientHeight", {
      configurable: true,
      value: 160,
    });
    const focus = vi
      .spyOn(view.contentDOM, "focus")
      .mockImplementation(() => undefined);
    const originalRequestMeasure = view.requestMeasure.bind(view);
    vi.spyOn(view, "requestMeasure").mockImplementation((request) => {
      if (!request) {
        originalRequestMeasure();
        return;
      }
      const measured = request.read(view!);
      request.write?.(measured, view!);
    });

    gotoLine(96);

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(
      96,
    );
    expect(view.scrollDOM.scrollTop).toBeGreaterThan(0);
    expect(document.documentElement.scrollTop).toBe(47);
    expect(document.body.scrollTop).toBe(31);
    expect(focus).toHaveBeenCalled();
  });
});

describe("going to a line and column", () => {
  function mount(doc: string): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({ parent, state: EditorState.create({ doc }) });
    setEditorView(view);
    return view;
  }

  it("puts the cursor at a 1-based column on the line", () => {
    const editor = mount("one\ntwo\nthird line\nfour");
    gotoLine(3, 5);
    const head = editor.state.selection.main.head;
    const line = editor.state.doc.lineAt(head);
    expect(line.number).toBe(3);
    expect(head - line.from).toBe(4);
  });

  it("clamps a column past the end of the line to the line end", () => {
    const editor = mount("one\ntwo\nthird\nfour");
    gotoLine(3, 99);
    const head = editor.state.selection.main.head;
    expect(editor.state.doc.lineAt(head).number).toBe(3);
    expect(head).toBe(editor.state.doc.line(3).to);
  });

  it("starts at the beginning of the line without a column", () => {
    const editor = mount("one\ntwo\nthird");
    gotoLine(2);
    expect(editor.state.selection.main.head).toBe(editor.state.doc.line(2).from);
  });
});

describe("centering inside the source editor", () => {
  const LINES = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join("\n");

  function mountCentered(): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({ doc: LINES, extensions: [centerWithinEditor] }),
    });
    setEditorView(view);
    return view;
  }

  function scrollHandler(current: EditorView) {
    const [handler] = current.state.facet(EditorView.scrollHandler);
    return handler;
  }

  it("lets CodeMirror measure the target before it scrolls", () => {
    const current = mountCentered();
    const effects: StateEffect<unknown>[] = [];
    const listener = EditorView.updateListener.of((update) => {
      for (const transaction of update.transactions) effects.push(...transaction.effects);
    });
    current.dispatch({ effects: StateEffect.appendConfig.of(listener) });
    const measure = vi.spyOn(current, "requestMeasure");
    vi.spyOn(current.contentDOM, "focus").mockImplementation(() => undefined);

    gotoLine(96);

    const target = current.state.doc.line(96).from;
    expect(current.state.selection.main.head).toBe(target);
    const scroll = effects
      .map((effect) => effect.value as { range?: { head: number }; y?: string })
      .find((value) => value?.range?.head === target);
    expect(scroll?.y).toBe("center");
    expect(measure.mock.calls.some(([request]) => request !== undefined)).toBe(false);
  });

  it("moves only the editor's scroller to center a line", () => {
    const current = mountCentered();
    document.documentElement.scrollTop = 47;
    document.body.scrollTop = 31;
    Object.defineProperty(current.scrollDOM, "clientHeight", { configurable: true, value: 160 });
    Object.defineProperty(current, "documentTop", { configurable: true, get: () => 0 });
    Object.defineProperty(current, "scaleY", { configurable: true, get: () => 1 });
    vi.spyOn(current, "lineBlockAt").mockReturnValue({ top: 900, height: 20 } as BlockInfo);

    const handled = scrollHandler(current)(current, EditorSelection.cursor(5), {
      x: "nearest",
      y: "center",
      xMargin: 5,
      yMargin: 5,
    });

    expect(handled).toBe(true);
    expect(current.scrollDOM.scrollTop).toBe(830);
    expect(document.documentElement.scrollTop).toBe(47);
    expect(document.body.scrollTop).toBe(31);
  });

  it("leaves cursor-following scrolls to CodeMirror", () => {
    const current = mountCentered();
    const handled = scrollHandler(current)(current, EditorSelection.cursor(5), {
      x: "nearest",
      y: "nearest",
      xMargin: 5,
      yMargin: 5,
    });

    expect(handled).toBe(false);
    expect(current.scrollDOM.scrollTop).toBe(0);
  });
});

describe("selecting the word clicked in the PDF", () => {
  function mount(doc: string) {
    view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
    setEditorView(view);
    return view;
  }

  function wholeWordOffsets(text: string, word: string): number[] {
    return [...text.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}])${word}(?![\p{L}\p{N}])`, "gu"))].map((match) => match.index);
  }

  function contextOf(pdf: string, word: string, occurrence: number) {
    const start = wholeWordOffsets(pdf, word)[occurrence];
    return { before: pdf.slice(Math.max(0, start - 200), start), after: pdf.slice(start + word.length, start + word.length + 200) };
  }

  function selected(editor: EditorView) {
    const { from, to } = editor.state.selection.main;
    return [editor.state.sliceDoc(from, to), from - editor.state.doc.line(2).from];
  }

  it("selects the whole Devanagari word instead of a prefix of an earlier word", () => {
    const editor = mount("\\section{परिचय}\nनमस्कार और नमस्ते दुनिया\n");
    expect(selectWordNearLine(2, "नमस्ते")).toBe(true);
    expect(selected(editor)).toEqual(["नमस्ते", 11]);
  });

  it("prefers a standalone occurrence over one followed by a combining mark", () => {
    const editor = mount("x\nकिन्तु न हिन्दी\n");
    expect(selectWordNearLine(2, "न")).toBe(true);
    expect(selected(editor)).toEqual(["न", 7]);
  });

  it("finds an NFC word in NFD source text and selects the source characters", () => {
    const editor = mount("x\nun cafe\u0301 noir\n");
    expect(selectWordNearLine(2, "caf\u00e9")).toBe(true);
    expect(selected(editor)).toEqual(["cafe\u0301", 3]);
  });

  it("maps a match back into a long NFD line", () => {
    const filler = "e\u0301 ".repeat(20_000);
    const editor = mount(`x\n${filler}Zürich cafe\u0301\n`.replace("ü", "u\u0308"));
    expect(selectWordNearLine(2, "caf\u00e9")).toBe(true);
    expect(selected(editor)).toEqual(["cafe\u0301", filler.length + 8]);
  });

  it("selects the occurrence of a repeated word that was clicked, not the first one", () => {
    const editor = mount("x\nCats and dogs and birds and fish.\n");
    const pdf = "1 Introduction Cats and dogs and birds and fish. We find that";
    for (const [index, start] of [5, 14, 24].entries()) {
      expect(selectWordNearLine(2, "and", contextOf(pdf, "and", index))).toBe(true);
      expect(selected(editor)).toEqual(["and", start]);
    }
  });

  it("follows the clicked occurrence through LaTeX markup and PDF line breaks", () => {
    const paragraph = String.raw`Cats and dogs and birds and fish. We find that the \emph{field} of the study of the effect of the change is difficult to define, and the first figure in the field~\cite{knuth} shows the effect of the change in the field of the study, and the conclusion of the study is that the field changes the effect.`;
    const editor = mount(`\\section{Introduction}\n${paragraph}\n\nA second paragraph mentions the field once more and the effect too.\n`);
    const pdf =
      "1 Introduction Cats and dogs and birds and fish. We find that the field of the study of the effect of the change is difficult to define, and the first figure in the field [1] shows the effect of the change in the field of the study, and the conclusion of the study is that the field changes the effect. A second paragraph mentions the field once more and the effect too. References [1] D. Knuth. The TEXbook. 1";
    const source = paragraph;
    for (const word of ["and", "the", "of", "field", "effect", "study", "change"]) {
      const inSource = wholeWordOffsets(source, word);
      const inPdf = wholeWordOffsets(pdf, word).slice(0, inSource.length);
      expect(inPdf).toHaveLength(inSource.length);
      inSource.forEach((start, index) => {
        expect(selectWordNearLine(2, word, contextOf(pdf, word, index)), `${word} #${index + 1}`).toBe(true);
        expect(selected(editor), `${word} #${index + 1}`).toEqual([word, start]);
      });
    }
  });

  it("uses source lines on either side when each sentence has its own line", () => {
    const editor = mount("x\nWe compare and contrast the models and the data.\nResults and discussion follow.\n");
    const pdf = "We compare and contrast the models and the data. Results and discussion follow.";
    expect(selectWordNearLine(2, "and", contextOf(pdf, "and", 1))).toBe(true);
    expect(selected(editor)).toEqual(["and", 35]);
    expect(selectWordNearLine(2, "the", contextOf(pdf, "the", 1))).toBe(true);
    expect(selected(editor)).toEqual(["the", 39]);
  });

  it("keeps the first occurrence when the surrounding text matches none of them better", () => {
    const editor = mount("x\nand then and then and\n");
    expect(selectWordNearLine(2, "and", { before: "unrelated words ", after: " elsewhere" })).toBe(true);
    expect(selected(editor)).toEqual(["and", 0]);
    expect(selectWordNearLine(2, "and", { before: "", after: "" })).toBe(true);
    expect(selected(editor)).toEqual(["and", 0]);
  });

  it("picks the clicked occurrence in a decomposed line", () => {
    const editor = mount("x\ncafe\u0301 au lait, cafe\u0301 noir\n");
    expect(selectWordNearLine(2, "caf\u00e9", { before: "caf\u00e9 au lait, ", after: " noir" })).toBe(true);
    expect(selected(editor)).toEqual(["cafe\u0301", 15]);
  });

  it("treats a neighbouring astral letter as part of the word", () => {
    const editor = mount("x\n𠮷野家 野家\n");
    expect(selectWordNearLine(2, "野家")).toBe(true);
    expect(selected(editor)).toEqual(["野家", 5]);
  });

  it("selects the whole word when the click lands on half of a hyphenated word", () => {
    const editor = mount(String.raw`x` + "\n" + String.raw`as in Section~\ref{sec:3}, the section of the model shows the data.` + "\n");
    const pdf = "as in Section 3, the sec- tion of the model shows the data.";
    const first = pdf.indexOf("sec-");
    expect(selectWordNearLine(2, "sec", { before: pdf.slice(0, first), after: pdf.slice(first + 3) })).toBe(true);
    expect(selected(editor)).toEqual(["section", 31]);
    const second = pdf.indexOf("tion of");
    expect(selectWordNearLine(2, "tion", { before: pdf.slice(0, second), after: pdf.slice(second + 4) })).toBe(true);
    expect(selected(editor)).toEqual(["section", 31]);
  });

  it("reads accents typed as TeX macros", () => {
    const editor = mount("x\n" + String.raw`The caf\'e and the na\"ive r\'{e}sum\'{e} of the model.` + "\n");
    const pdf = "The café and the naïve résumé of the model.";
    expect(selectWordNearLine(2, "café", contextOf(pdf, "café", 0))).toBe(true);
    expect(selected(editor)).toEqual([String.raw`caf\'e`, 4]);
    expect(selectWordNearLine(2, "naïve", contextOf(pdf, "naïve", 0))).toBe(true);
    expect(selected(editor)).toEqual([String.raw`na\"ive`, 19]);
    expect(selectWordNearLine(2, "résumé", contextOf(pdf, "résumé", 0))).toBe(true);
    expect(selected(editor)).toEqual([String.raw`r\'{e}sum\'{e}`, 27]);
  });

  it("does not take a command name for the clicked word", () => {
    const editor = mount("x\n" + String.raw`\section{The section of the data}` + "\n");
    expect(selectWordNearLine(2, "section", { before: "1 The ", after: " of the data" })).toBe(true);
    expect(selected(editor)).toEqual(["section", 13]);
  });

  it("stays near SyncTeX's line when the clicked word only appears far away", () => {
    const lines = ["x", String.raw`\caption{The effect of the change.}`, ...Array.from({ length: 30 }, () => "filler text"), String.raw`As Figure~\ref{fig:a} shows, the model fits.`];
    const editor = mount(`${lines.join("\n")}\n`);
    editor.dispatch({ selection: { anchor: 0 } });
    // "Figure 1:" is typeset by \caption; the only "Figure" in the source is 31 lines away.
    expect(selectWordNearLine(2, "Figure", { before: "", after: " 1: The effect of the change." })).toBe(false);
    expect(editor.state.selection.main.from).toBe(0);
  });

  it("finds \\title text far above \\maketitle when the words around it agree", () => {
    const lines = ["x", String.raw`\title{A Robust Network for Signal Prediction in Noisy Fields}`, ...Array.from({ length: 20 }, (_, i) => String.raw`\newcommand{\macro` + String.fromCharCode(97 + i) + "}{x}"), String.raw`\begin{document}`, String.raw`\maketitle`];
    const editor = mount(`${lines.join("\n")}\n`);
    const pdf = "A Robust Network for Signal Prediction in Noisy Fields Ada Lovelace";
    expect(selectWordNearLine(24, "Network", contextOf(pdf, "Network", 0))).toBe(true);
    expect(selected(editor)).toEqual(["Network", 16]);
  });

  it("keeps a heading's word over the end of the paragraph above that says the same", () => {
    const editor = mount("x\nThe noise is the value of the study.\n\n" + String.raw`\section{The field of the study}` + "\nThe next paragraph starts here.\n");
    const pdf = "The noise is the value of the study. 3 The field of the study The next paragraph starts here.";
    const at = pdf.lastIndexOf("study");
    expect(selectWordNearLine(4, "study", { before: pdf.slice(0, at), after: pdf.slice(at + 5) })).toBe(true);
    const { from } = editor.state.selection.main;
    expect(editor.state.doc.lineAt(from).number).toBe(4);
  });
});
