// @vitest-environment jsdom

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { stubRangeGeometry } from "../test-geometry";
import { installEnglishEditorMessages } from "../test-messages";
import { loadTypstParser, typstLanguage } from "../typst";
import { visualMode } from "./index";
import { buildParagraphDecorations, latexParagraphRules, type ParagraphRules } from "./paragraphs";
import { parsedView } from "./test-document";
import { typstVisualMode } from "./typst";
import { typstParagraphRules } from "./typst/paragraphs";
import { NO_PORTS } from "./typst/test-support";

stubRangeGeometry();

let view: EditorView | null = null;

beforeAll(async () => {
  installEnglishEditorMessages();
  await loadTypstParser();
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function mount(doc: string, extensions: Extension[]): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = parsedView(
    new EditorView({
      state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions }),
      parent,
    }),
  );
  view.dispatch({});
  return view;
}

function linesWith(editor: EditorView, rules: ParagraphRules, className: string): number[] {
  const lines: number[] = [];
  buildParagraphDecorations(editor, rules).between(0, editor.state.doc.length, (from, _to, decoration) => {
    if (decoration.spec.class === className) lines.push(editor.state.doc.lineAt(from).number);
  });
  return lines;
}

const LATEX = String.raw`\documentclass{article}
\newtheorem{lemma}{Lemma}
\begin{document}
\section{Intro}
\label{sec:intro}
% a note to self

First paragraph after the heading and its label.
It goes on here.

Second paragraph with \emph{emphasis}.

\textbf{Bold} starts the third paragraph.

\LaTeX{} starts the fourth.

\noindent The fifth is not indented.

\begin{itemize}
  \item One

  \item Two
\end{itemize}

\begin{verbatim}
code

more
\end{verbatim}

Sixth paragraph with $x$ inline.
\subsection{Next}

Right after a heading and a blank line.
\end{document}`;

const ENVIRONMENTS = String.raw`\documentclass{article}
\newtheorem{lemma}{Lemma}
\begin{document}
\begin{lemma}
Lemma text.

Second lemma paragraph.
\end{lemma}
\begin{abstract}
Abstract text.

More abstract.
\end{abstract}

$$x = y$$
\end{document}`;

describe("LaTeX paragraph lines", () => {
  const rules = latexParagraphRules;
  const extensions = [latexTreeSupport(), visualMode(NO_PORTS)];

  it("marks the first line of each paragraph, but not one after a heading, its label or a comment", () => {
    const editor = mount(LATEX, extensions);
    expect(linesWith(editor, rules, "ofl-visual-paragraph-start")).toEqual([11, 13, 15, 31]);
  });

  it("marks blank lines in the text, but not in lists, verbatim or the preamble", () => {
    const editor = mount(LATEX, extensions);
    expect(linesWith(editor, rules, "ofl-visual-blank-line")).toEqual([7, 10, 12, 14, 16, 18, 24, 30, 33]);
  });

  it("treats theorems and the abstract as running text, and display math as a block", () => {
    const editor = mount(ENVIRONMENTS, extensions);
    expect(linesWith(editor, rules, "ofl-visual-paragraph-start")).toEqual([7, 12]);
    expect(linesWith(editor, rules, "ofl-visual-blank-line")).toEqual([6, 11, 14]);
  });

  it("indents a paragraph that starts a file with no preamble", () => {
    const editor = mount("Opening paragraph.\n\nSecond one.\n", extensions);
    expect(linesWith(editor, rules, "ofl-visual-paragraph-start")).toEqual([1, 3]);
  });
});

const TYPST = [
  "#set text(size: 11pt)",
  "",
  "= Introduction",
  "First paragraph after the heading.",
  "",
  "Second paragraph with *bold*.",
  "",
  "#emph[Emphasis] starts the third.",
  "",
  "- item one",
  "",
  "- item two",
  "",
  "```py",
  "a = 1",
  "",
  "b = 2",
  "```",
  "",
  "$ x = y $",
  "",
  "#figure(",
  "  [A boxed body],",
  "",
  "  caption: [Hi],",
  ")",
  "",
  "Fourth paragraph with $x$ inline.",
  "",
  "= Next",
  "",
  "After a heading and a blank line.",
  "",
].join("\n");

describe("Typst paragraph lines", () => {
  const rules = typstParagraphRules;
  const extensions = [typstLanguage(), typstVisualMode(NO_PORTS)];

  it("marks a paragraph only when it follows another paragraph, as Typst indents", () => {
    const editor = mount(TYPST, extensions);
    expect(linesWith(editor, rules, "ofl-visual-paragraph-start")).toEqual([6, 8]);
  });

  it("looks past a comment to the paragraph before it", () => {
    const editor = mount("Para one.\n\n// a comment\nPara two.\n", extensions);
    expect(linesWith(editor, rules, "ofl-visual-paragraph-start")).toEqual([4]);
  });

  it("marks top-level blank lines, not those inside raw blocks or call arguments", () => {
    const editor = mount(TYPST, extensions);
    expect(linesWith(editor, rules, "ofl-visual-blank-line")).toEqual([2, 5, 7, 9, 11, 13, 19, 21, 27, 29, 31, 33]);
  });
});
