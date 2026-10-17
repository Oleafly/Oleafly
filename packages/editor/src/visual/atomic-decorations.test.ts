import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Decoration, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { visualAtomicField } from "./atomic-decorations";
import { visualMode } from "./index";
import { mouseDownEffect } from "./selection";
import { parsedState, positionOf, SAMPLE_DOCUMENT, TITLE_DOCUMENT } from "./test-document";
import { BeginWidget } from "./widgets/begin";
import { BeginTheoremWidget } from "./widgets/begin-theorem";
import { BibItemWidget } from "./widgets/bibitem";
import { BraceWidget } from "./widgets/brace";
import { CharacterWidget } from "./widgets/character";
import { DescriptionItemWidget } from "./widgets/description-item";
import { DividerWidget } from "./widgets/divider";
import { EndWidget } from "./widgets/end";
import { EndDocumentWidget } from "./widgets/end-document";
import { EnvironmentLineWidget } from "./widgets/environment-line";
import { FootnoteWidget } from "./widgets/footnote";
import { FrameWidget } from "./widgets/frame";
import { GraphicsWidget } from "./widgets/graphics";
import { IconBraceWidget } from "./widgets/icon-brace";
import { IndicatorWidget } from "./widgets/indicator";
import { ItemWidget } from "./widgets/item";
import { LatexLogoWidget } from "./widgets/latex-logo";
import { MakeTitleWidget } from "./widgets/maketitle";
import { MathWidget } from "./widgets/math";
import { PreambleWidget } from "./widgets/preamble";
import { RuleWidget } from "./widgets/rule";
import { SpaceWidget } from "./widgets/space";
import { TexLogoWidget } from "./widgets/tex-logo";
import { TildeWidget } from "./widgets/tilde";

interface Found<T> {
  from: number;
  to: number;
  widget: T;
  block: boolean;
}

const ports = { resolveImage: async () => null };

function createState(doc: string, cursor?: number, readOnly = false): EditorState {
  const state = parsedState(
    EditorState.create({
      doc,
      selection: cursor === undefined ? undefined : { anchor: cursor },
      extensions: [latexTreeSupport(), visualMode(ports), EditorState.readOnly.of(readOnly)],
    }),
  );
  expect(syntaxTree(state)).toHaveLength(doc.length);
  return state;
}

function widgets<T extends WidgetType>(
  state: EditorState,
  kind: new (...args: never[]) => T,
): Found<T>[] {
  const found: Found<T>[] = [];
  const cursor = state.field(visualAtomicField).decorations.iter();
  while (cursor.value) {
    const spec = (cursor.value as Decoration).spec;
    if (spec.widget instanceof kind) {
      found.push({ from: cursor.from, to: cursor.to, widget: spec.widget, block: Boolean(spec.block) });
    }
    cursor.next();
  }
  return found;
}

function hiddenRanges(state: EditorState): Array<{ from: number; to: number }> {
  const found: Array<{ from: number; to: number }> = [];
  const cursor = state.field(visualAtomicField).decorations.iter();
  while (cursor.value) {
    const spec = (cursor.value as Decoration).spec;
    if (!spec.widget && cursor.to > cursor.from) found.push({ from: cursor.from, to: cursor.to });
    cursor.next();
  }
  return found;
}

const doc = SAMPLE_DOCUMENT;
const endOfDocument = doc.length;
const preambleEnd = positionOf(doc, "\\begin{document}") + "\\begin{document}".length;

describe("atomic decorations with the selection outside the constructs", () => {
  const state = createState(doc, endOfDocument);

  it("collapses the preamble up to the document environment", () => {
    const [preamble] = widgets(state, PreambleWidget);
    expect(preamble.widget.expanded).toBe(false);
    expect([preamble.from, preamble.to]).toEqual([0, preambleEnd]);
    expect(state.field(visualAtomicField).preamble.to).toBe(preambleEnd);
  });

  it("hides the sectioning commands and braces around every heading", () => {
    const braces = widgets(state, BraceWidget).filter((found) => found.widget.content === "");
    const headings = ["\\part{Widgets}", "\\chapter{Rendering}", "\\section{Inline and display math}"];
    for (const heading of headings) {
      const from = positionOf(doc, heading);
      const titleStart = from + heading.indexOf("{") + 1;
      expect(braces.some((brace) => brace.from === from && brace.to === titleStart), heading).toBe(true);
      expect(braces.some((brace) => brace.from === from + heading.length - 1 && brace.to === from + heading.length)).toBe(true);
    }
  });

  it("renders inline and display math", () => {
    const math = widgets(state, MathWidget);
    const inline = math.find((found) => !found.widget.display);
    expect(inline?.widget.source).toBe("E = mc^2");
    expect(inline?.block).toBe(false);
    expect(doc.slice(inline?.from, inline?.to)).toBe("$E = mc^2$");
    const display = math.find((found) => found.widget.display);
    expect(display?.block).toBe(true);
    expect(display?.widget.source.startsWith("\\begin{equation}")).toBe(true);
    expect(doc.slice(display?.from, display?.to).endsWith("\\end{equation}")).toBe(true);
  });

  it("collapses the footnote into a chip", () => {
    const [note] = widgets(state, FootnoteWidget);
    expect(doc.slice(note.from, note.to)).toBe("\\footnote{A short note.}");
  });

  it("renders the theorem begin and end lines", () => {
    const [begin] = widgets(state, BeginTheoremWidget);
    expect(begin.widget.name).toBe("Lemma");
    expect(begin.widget.titleText).toBe("Small");
    expect(doc.slice(begin.from, begin.to)).toBe("\\begin{lemma}[Small]");
    const ends = widgets(state, EndWidget);
    expect(ends.some((end) => doc.slice(end.from, end.to) === "\\end{lemma}")).toBe(true);
    expect(state.field(visualAtomicField).theorems.get("lemma")).toEqual({ label: "Lemma", style: "plain" });
  });

  it("hides the colour commands and keeps their arguments", () => {
    const braces = widgets(state, BraceWidget);
    for (const command of ["\\textcolor{red}{", "\\colorbox{yellow}{"]) {
      const from = positionOf(doc, command);
      expect(braces.some((brace) => brace.from === from && brace.to === from + command.length), command).toBe(true);
    }
  });

  it("replaces the table edges, hides centering and the caption command, and chips the label", () => {
    const edges = widgets(state, EnvironmentLineWidget);
    expect(edges.map((edge) => [edge.widget.environment, edge.widget.edge])).toEqual([
      ["table", "begin"],
      ["table", "end"],
    ]);
    expect(doc.slice(edges[0].from, edges[0].to)).toBe("\\begin{table}[h]");
    expect(doc.slice(edges[1].from, edges[1].to)).toBe("\\end{table}");
    const centeringLine = state.doc.lineAt(positionOf(doc, "\\centering"));
    expect(hiddenRanges(state)).toContainEqual({ from: centeringLine.from, to: centeringLine.to });
    const caption = positionOf(doc, "\\caption{");
    expect(
      widgets(state, BraceWidget).some((brace) => brace.from === caption && brace.to === caption + "\\caption{".length),
    ).toBe(true);
    const label = widgets(state, IconBraceWidget).find((found) => found.widget.icon === "tag");
    expect(doc.slice(label?.from, label?.to)).toBe("\\label{");
  });

  it("replaces the end of the document", () => {
    const [end] = widgets(state, EndDocumentWidget);
    expect(doc.slice(end.from, end.to)).toBe("\\end{document}");
    expect(end.block).toBe(true);
  });
});

describe("atomic decorations reveal the source under the selection", () => {
  it("shows inline math source when the cursor is inside it", () => {
    const state = createState(doc, positionOf(doc, "mc^2"));
    expect(widgets(state, MathWidget).some((found) => !found.widget.display)).toBe(false);
    expect(widgets(state, MathWidget).some((found) => found.widget.display)).toBe(true);
  });

  it("shows the equation source when the cursor touches any of its lines", () => {
    const state = createState(doc, positionOf(doc, "\\end{equation}") + 3);
    expect(widgets(state, MathWidget).some((found) => found.widget.display)).toBe(false);
  });

  it("expands the footnote when the cursor is inside it", () => {
    const state = createState(doc, positionOf(doc, "short note"));
    expect(widgets(state, FootnoteWidget)).toEqual([]);
  });

  it("shows dimmed braces around a heading when the selection touches the command", () => {
    const state = createState(doc, positionOf(doc, "\\section") + 2);
    const braces = widgets(state, BraceWidget).filter((brace) => brace.widget.content !== "");
    expect(braces.map((brace) => brace.widget.content)).toEqual(["{", "}"]);
    const from = positionOf(doc, "\\section{");
    expect(braces[0].from).toBe(from);
  });

  it("shows the theorem begin line as source while keeping the end line rendered", () => {
    const state = createState(doc, positionOf(doc, "[Small]") + 1);
    expect(widgets(state, BeginTheoremWidget)).toEqual([]);
    expect(widgets(state, EndWidget).some((end) => doc.slice(end.from, end.to) === "\\end{lemma}")).toBe(true);
  });

  it("reveals the colour command when the selection is inside its argument", () => {
    const state = createState(doc, positionOf(doc, "Red text") + 2);
    const from = positionOf(doc, "\\textcolor{red}{");
    expect(widgets(state, BraceWidget).some((brace) => brace.from === from)).toBe(false);
    const box = positionOf(doc, "\\colorbox{yellow}{");
    expect(widgets(state, BraceWidget).some((brace) => brace.from === box)).toBe(true);
  });

  it("shows the table environment lines when the selection is inside the environment", () => {
    const state = createState(doc, positionOf(doc, "A small table"));
    expect(widgets(state, EnvironmentLineWidget)).toEqual([]);
    const centeringLine = state.doc.lineAt(positionOf(doc, "\\centering"));
    expect(hiddenRanges(state)).not.toContainEqual({ from: centeringLine.from, to: centeringLine.to });
    const caption = positionOf(doc, "\\caption{");
    expect(widgets(state, BraceWidget).some((brace) => brace.from === caption)).toBe(false);
  });

  it("shows the end of the document as source when the cursor is on it", () => {
    const state = createState(doc, positionOf(doc, "\\end{document}") + 4);
    expect(widgets(state, EndDocumentWidget)).toEqual([]);
  });

  it("expands the preamble when the cursor is inside it", () => {
    const state = createState(doc, 0);
    const [preamble] = widgets(state, PreambleWidget);
    expect(preamble.widget.expanded).toBe(true);
    expect([preamble.from, preamble.to]).toEqual([0, 0]);
  });

  it("keeps everything rendered in a read-only document", () => {
    const state = createState(doc, positionOf(doc, "mc^2"), true);
    expect(widgets(state, MathWidget).some((found) => !found.widget.display)).toBe(true);
  });

  it("rebuilds when the selection moves", () => {
    const state = createState(doc, endOfDocument);
    const moved = state.update({ selection: { anchor: positionOf(doc, "mc^2") } }).state;
    expect(widgets(moved, MathWidget).some((found) => !found.widget.display)).toBe(false);
  });
});

describe("preamble detection", () => {
  it("extends the preamble to a \\maketitle that opens the document body", () => {
    const state = createState(TITLE_DOCUMENT, TITLE_DOCUMENT.length);
    const field = state.field(visualAtomicField);
    expect(field.preamble.to).toBe(positionOf(TITLE_DOCUMENT, "\\maketitle"));
    expect(field.preamble.title?.content).toBe("{A \\textbf{bold} title}");
    expect(field.preamble.authors.map((author) => author.content)).toEqual(["{Ann \\and Bob}"]);
    const [title] = widgets(state, MakeTitleWidget);
    expect(TITLE_DOCUMENT.slice(title.from, title.to)).toBe("\\maketitle");
    const [preamble] = widgets(state, PreambleWidget);
    expect(preamble.to).toBe(positionOf(TITLE_DOCUMENT, "\\maketitle"));
  });

  it("stops at \\begin{document} when \\maketitle is not the first thing in the body", () => {
    const text = TITLE_DOCUMENT.replace("\\maketitle\nBody text.", "Body text.\n\\maketitle");
    const state = createState(text, text.length);
    expect(state.field(visualAtomicField).preamble.to).toBe(
      positionOf(text, "\\begin{document}") + "\\begin{document}".length,
    );
  });

  it("has no preamble in a fragment without a document environment", () => {
    const text = "\\section{Only}\nText $x$.\n";
    const state = createState(text, text.length);
    expect(state.field(visualAtomicField).preamble.to).toBe(0);
    expect(widgets(state, PreambleWidget)).toEqual([]);
  });
});

const CONSTRUCTS = String.raw`\documentclass{article}
\begin{document}
Code \verb|abc| and \verb||.
\include{chap}
\input{sec} \input{}
\href{http://x.org}{Link} \href{http://x.org}{} \url{http://y.org}
a~b line\\ next\\[2pt] more
\includegraphics{fig.png}
Inline \includegraphics{a.svg} here.
\theoremstyle{definition}
\newtheorem{defn}{Definition}
\begin{defn}
Body
\end{defn}
Note\endnote{N}.
\LaTeX\ \TeX \ldots \quad \foo
\keywords{a, b}
\rule{1cm}{2pt} \hrule
\vspace*{2pt} \noindent
\centering text
\begin{center}
Mid
\end{center}
\begin{abstract}
Abs
\end{abstract}
\begin{frame}{Title}{Sub}
X
\end{frame}
\begin{frame}{Only}
Y
\end{frame}
\begin{frame}
Z
\end{frame}
\begin{enumerate}
  \item One
  \item Two
\end{enumerate}
\begin{itemize}
\end{itemize}
\begin{description}
  \item[Term] Meaning
  \item Bare
  \item
\end{description}
\begin{thebibliography}{9}
\bibitem{a} A.
\bibitem[Key]{b} B.
\end{thebibliography}
\end{document}
`;

function decorationsAt(state: EditorState, from: number): Array<{ from: number; to: number; widget?: WidgetType }> {
  const found: Array<{ from: number; to: number; widget?: WidgetType }> = [];
  const cursor = state.field(visualAtomicField).decorations.iter(from);
  while (cursor.value && cursor.from === from) {
    found.push({ from: cursor.from, to: cursor.to, widget: (cursor.value as Decoration).spec.widget });
    cursor.next();
  }
  return found;
}

function lineOf(text: string, needle: string): { from: number; to: number } {
  const from = text.lastIndexOf("\n", positionOf(text, needle)) + 1;
  const end = text.indexOf("\n", from);
  return { from, to: end === -1 ? text.length : end };
}

describe("atomic decorations for inline constructs", () => {
  const text = CONSTRUCTS;
  const state = createState(text, text.length);

  it("hides the delimiters of verbatim text but keeps empty verbatim as source", () => {
    const verb = positionOf(text, "\\verb|abc|");
    expect(hiddenRanges(state)).toContainEqual({ from: verb, to: verb + "\\verb|".length });
    expect(hiddenRanges(state)).toContainEqual({ from: verb + "\\verb|abc".length, to: verb + "\\verb|abc|".length });
    const empty = positionOf(text, "\\verb||");
    expect(decorationsAt(state, empty)).toEqual([]);
  });

  it("chips included files with a link icon and skips empty paths", () => {
    const icons = widgets(state, IconBraceWidget).filter((found) => found.widget.icon === "link");
    expect(icons.map((found) => text.slice(found.from, found.to))).toEqual(["\\include{", "\\input{"]);
    expect(icons[0].widget.title).toBe("visual.includedFile");
    expect(decorationsAt(state, positionOf(text, "\\input{}"))).toEqual([]);
  });

  it("hides link commands around their text and shows braces around an empty link", () => {
    const braces = widgets(state, BraceWidget);
    const link = positionOf(text, "\\href{http://x.org}{Link}");
    const linkOpen = braces.find((found) => found.from === link);
    expect(text.slice(linkOpen?.from, linkOpen?.to)).toBe("\\href{http://x.org}{");
    expect(linkOpen?.widget.content).toBe("");
    const empty = positionOf(text, "\\href{http://x.org}{}");
    expect(braces.filter((found) => found.from >= empty && found.to <= empty + 21).map((found) => found.widget.content)).toEqual([
      "{",
      "}",
    ]);
    const url = positionOf(text, "\\url{");
    const urlOpen = braces.find((found) => found.from === url);
    expect(text.slice(urlOpen?.from, urlOpen?.to)).toBe("\\url{");
  });

  it("renders ties, line breaks and logos", () => {
    const [tilde] = widgets(state, TildeWidget);
    expect(text.slice(tilde.from, tilde.to)).toBe("~");
    const breaks = widgets(state, IndicatorWidget);
    expect(breaks.map((found) => text.slice(found.from, found.to))).toEqual(["\\\\", "\\\\[2pt]"]);
    expect(breaks[0].widget.content).toBe("↩");
    expect(widgets(state, LatexLogoWidget)).toHaveLength(1);
    expect(widgets(state, TexLogoWidget)).toHaveLength(1);
  });

  it("substitutes characters and spaces and leaves unknown commands alone", () => {
    const characters = widgets(state, CharacterWidget).map((found) => found.widget.content);
    expect(characters).toContain("…");
    expect(characters).toContain(" ");
    const [space] = widgets(state, SpaceWidget);
    expect(text.slice(space.from, space.to)).toBe("\\quad ");
    expect(space.widget.width).toBe("1em");
    expect(decorationsAt(state, positionOf(text, "\\foo"))).toEqual([]);
  });

  it("labels keywords, draws rules and silences layout commands", () => {
    const keywords = widgets(state, BraceWidget).find((found) => found.widget.content === "visual.keywordsLabel");
    expect(text.slice(keywords?.from, keywords?.to)).toBe("\\keywords{");
    const rules = widgets(state, RuleWidget).map((found) => [found.widget.width, found.widget.height]);
    expect(rules).toEqual([
      ["1cm", "2pt"],
      ["100%", "0.4pt"],
    ]);
    const braces = widgets(state, BraceWidget).filter((found) => found.widget.content === "");
    const vspace = positionOf(text, "\\vspace*{2pt}");
    expect(braces.some((found) => found.from === vspace && found.to === vspace + "\\vspace*{2pt}".length)).toBe(true);
    const noindent = positionOf(text, "\\noindent");
    expect(braces.some((found) => found.from === noindent && found.to === noindent + "\\noindent".length)).toBe(true);
    const centering = positionOf(text, "\\centering text");
    expect(braces.some((found) => found.from === centering && found.to === centering + "\\centering".length)).toBe(true);
  });

  it("collapses the endnote into its own chip", () => {
    const notes = widgets(state, FootnoteWidget);
    expect(notes.map((found) => found.widget.kind)).toEqual(["endnote"]);
  });

  it("renders a graphic on its own line as a block and leaves inline SVG files as source", () => {
    const graphics = widgets(state, GraphicsWidget);
    expect(graphics).toHaveLength(1);
    expect(graphics[0].block).toBe(true);
    expect(graphics[0]).toMatchObject(lineOf(text, "\\includegraphics{fig.png}"));
    expect(decorationsAt(state, positionOf(text, "\\includegraphics{a.svg}"))).toEqual([]);
  });
});

describe("atomic decorations for environments", () => {
  const text = CONSTRUCTS;
  const state = createState(text, text.length);

  it("registers declared theorems with the current theorem style", () => {
    expect(state.field(visualAtomicField).theorems.get("defn")).toEqual({ label: "Definition", style: "definition" });
    const begin = widgets(state, BeginTheoremWidget).find((found) => found.widget.environment === "defn");
    expect(begin?.widget.name).toBe("Definition");
    expect(begin?.widget.titleText).toBe("");
    const ends = widgets(state, EndWidget).map((found) => text.slice(found.from, found.to));
    expect(ends).toContain("\\end{defn}");
  });

  it("renders the abstract heading and closing rule", () => {
    const [abstract] = widgets(state, BeginWidget).filter((found) => !(found.widget instanceof BeginTheoremWidget));
    expect(abstract.widget.environment).toBe("abstract");
    expect(abstract.widget.name).toBe("visual.abstract");
    expect(widgets(state, EndWidget).map((found) => text.slice(found.from, found.to))).toContain("\\end{abstract}");
  });

  it("hides alignment environment edges", () => {
    const hidden = hiddenRanges(state);
    expect(hidden).toContainEqual(lineOf(text, "\\begin{center}"));
    expect(hidden).toContainEqual(lineOf(text, "\\end{center}"));
  });

  it("renders beamer frame titles and subtitles and divides frames", () => {
    const frames = widgets(state, FrameWidget);
    expect(frames.map((found) => [found.widget.frame.title.content, found.widget.frame.subtitle?.content])).toEqual([
      ["Title", "Sub"],
      ["Only", undefined],
    ]);
    expect(frames[0]).toMatchObject(lineOf(text, "\\begin{frame}{Title}{Sub}"));
    expect(widgets(state, DividerWidget)).toHaveLength(3);
  });

  it("numbers ordered list items and hides the list edges", () => {
    const items = widgets(state, ItemWidget);
    expect(items.map((found) => [found.widget.environment, found.widget.ordinal, found.widget.depth])).toEqual([
      ["enumerate", 1, 1],
      ["enumerate", 2, 1],
    ]);
    expect(items[0].from).toBe(lineOf(text, "\\item One").from);
    const hidden = hiddenRanges(state);
    expect(hidden).toContainEqual(lineOf(text, "\\begin{enumerate}"));
    expect(hidden).not.toContainEqual(lineOf(text, "\\begin{itemize}"));
  });

  it("marks description terms and hides their brackets", () => {
    const items = widgets(state, DescriptionItemWidget);
    expect(items.map((found) => text.slice(found.from, found.to))).toEqual(["  \\item", "  \\item "]);
    const term = positionOf(text, "[Term]");
    const brackets = widgets(state, BraceWidget).filter((found) => found.from >= term && found.to <= term + 6);
    expect(brackets.map((found) => [text.slice(found.from, found.to), found.widget.content])).toEqual([
      ["[", ""],
      ["]", ""],
    ]);
  });

  it("numbers bibliography entries and keeps explicit labels", () => {
    const entries = widgets(state, BibItemWidget);
    expect(entries.map((found) => found.widget.label)).toEqual(["1", "Key"]);
    expect(text.slice(entries[1].from, entries[1].to)).toBe("\\bibitem[Key]{b}");
  });
});

describe("atomic decorations around a selection inside constructs", () => {
  const text = CONSTRUCTS;

  it("shows verbatim, file, link and tie source under the cursor", () => {
    for (const needle of ["abc|", "chap", "Link", "y.org", "~b"]) {
      const at = positionOf(text, needle);
      const state = createState(text, at);
      const command = text.lastIndexOf("\\", at);
      const touching = hiddenRanges(state).filter((range) => range.from <= at && range.to >= command);
      expect(touching, needle).toEqual([]);
    }
    const link = createState(text, positionOf(text, "Link"));
    const href = positionOf(text, "\\href{http://x.org}{Link}");
    expect(widgets(link, BraceWidget).find((found) => found.from === href)?.widget.content).toBe("{");
    const url = createState(text, positionOf(text, "y.org"));
    const urlStart = positionOf(text, "\\url{");
    expect(widgets(url, BraceWidget).find((found) => found.from === urlStart)?.widget.content).toBe("{");
    expect(widgets(createState(text, positionOf(text, "~b")), TildeWidget)).toEqual([]);
  });

  it("shows a line break's optional argument when the cursor is inside it", () => {
    const state = createState(text, positionOf(text, "2pt]"));
    expect(widgets(state, IndicatorWidget).map((found) => text.slice(found.from, found.to))).toEqual(["\\\\"]);
  });

  it("keeps graphics, logos and layout commands as source under the cursor", () => {
    expect(widgets(createState(text, positionOf(text, "fig.png")), GraphicsWidget)).toEqual([]);
    expect(widgets(createState(text, positionOf(text, "\\LaTeX") + 2), LatexLogoWidget)).toEqual([]);
    const centering = positionOf(text, "\\centering text");
    const state = createState(text, centering + 3);
    expect(widgets(state, BraceWidget).some((found) => found.from === centering)).toBe(false);
  });

  it("reveals description brackets when the cursor is inside the term", () => {
    const state = createState(text, positionOf(text, "Term]"));
    const term = positionOf(text, "[Term]");
    const brackets = widgets(state, BraceWidget).filter((found) => found.from >= term && found.to <= term + 6);
    expect(brackets.map((found) => found.widget.content)).toEqual(["[", "]"]);
  });

  it("shows bibliography entries and environment edges under the cursor", () => {
    const entry = createState(text, positionOf(text, "\\bibitem[Key]") + 3);
    expect(widgets(entry, BibItemWidget).map((found) => found.widget.label)).toEqual(["1"]);
    const center = createState(text, positionOf(text, "\\begin{center}") + 2);
    expect(hiddenRanges(center)).not.toContainEqual(lineOf(text, "\\begin{center}"));
  });

  it("shows the abstract and frame headings as source under the cursor", () => {
    const abstract = createState(text, positionOf(text, "\\begin{abstract}") + 2);
    expect(widgets(abstract, BeginWidget).some((found) => found.widget.environment === "abstract")).toBe(false);
    const frame = createState(text, positionOf(text, "{Sub}") + 1);
    expect(widgets(frame, FrameWidget).map((found) => found.widget.frame.title.content)).toEqual(["Only"]);
  });

  it("reveals the note braces in a read-only document when the selection is inside", () => {
    const at = positionOf(text, "{N}") + 1;
    const state = createState(text, at, true);
    expect(widgets(state, FootnoteWidget)).toEqual([]);
    const marks: Array<{ from: number; to: number }> = [];
    const cursor = state.field(visualAtomicField).decorations.iter();
    while (cursor.value) {
      if ((cursor.value as Decoration).spec.class === "ofl-visual-footnote ofl-visual-footnote-view") {
        marks.push({ from: cursor.from, to: cursor.to });
      }
      cursor.next();
    }
    expect(marks).toEqual([{ from: at - 1, to: at + 2 }]);
  });
});

describe("title block detection", () => {
  it("keeps the title block commands inside the document before \\maketitle in the preamble", () => {
    const text = String.raw`\documentclass{article}
\affil{Uni}
\begin{document}
\date{Today}
\affiliation{Lab}
\maketitle
Text
\end{document}
`;
    const state = createState(text, text.length);
    expect(state.field(visualAtomicField).preamble.to).toBe(positionOf(text, "\\maketitle"));
    expect(widgets(state, MakeTitleWidget)).toHaveLength(1);
  });

  it("stops the preamble at the document when another command precedes \\maketitle", () => {
    const text = String.raw`\documentclass{article}
\title{T}
\begin{document}
\section{Intro}
\maketitle
\end{document}
`;
    const state = createState(text, text.length);
    expect(state.field(visualAtomicField).preamble.to).toBe(
      positionOf(text, "\\begin{document}") + "\\begin{document}".length,
    );
  });

  it("extends the preamble over an affiliation that has an argument", () => {
    const text = "\\affil{Uni}\nBody\n";
    const state = createState(text, text.length);
    expect(state.field(visualAtomicField).preamble.to).toBe("\\affil{Uni}".length);
  });

  it("keeps \\maketitle as source when the cursor is on it", () => {
    const state = createState(TITLE_DOCUMENT, positionOf(TITLE_DOCUMENT, "\\maketitle") + 3);
    expect(widgets(state, MakeTitleWidget)).toEqual([]);
  });
});

describe("visual atomic field updates", () => {
  it("keeps decorations while the mouse is down and maps them through edits", () => {
    const state = createState(doc, endOfDocument);
    const pressed = state.update({ effects: mouseDownEffect.of(true) }).state;
    expect(pressed.field(visualAtomicField).mousedown).toBe(true);
    const before = widgets(pressed, FootnoteWidget)[0];
    const edited = pressed.update({ changes: { from: 0, insert: "% x\n" } }).state;
    expect(edited.field(visualAtomicField).mousedown).toBe(true);
    const after = widgets(edited, FootnoteWidget)[0];
    expect(after.from).toBe(before.from + 4);
    const released = edited.update({ effects: mouseDownEffect.of(false) }).state;
    expect(released.field(visualAtomicField).mousedown).toBe(false);
  });

  it("keeps the decoration set while the cursor moves through plain text", () => {
    const text = "Plain words here.\n\nSee \\cite{key} now.\n\nMore plain words.\n";
    const state = createState(text, 2);
    const decorations = state.field(visualAtomicField).decorations;
    const moved = state.update({ selection: { anchor: 8 } }).state;
    expect(moved.field(visualAtomicField).decorations).toBe(decorations);
    const farther = moved.update({ selection: { anchor: positionOf(text, "More") + 2 } }).state;
    expect(farther.field(visualAtomicField).decorations).toBe(decorations);
    const onCitation = farther.update({ selection: { anchor: positionOf(text, "\\cite") + 2 } }).state;
    expect(widgets(onCitation, IconBraceWidget)).toEqual([]);
    const back = onCitation.update({ selection: { anchor: 2 } }).state;
    expect(widgets(back, IconBraceWidget)).toHaveLength(1);
  });

  it("returns the same value when nothing relevant changes", () => {
    const state = createState(doc, endOfDocument);
    const pressed = state.update({ effects: mouseDownEffect.of(true) }).state;
    const again = pressed.update({});
    expect(again.state.field(visualAtomicField)).toBe(pressed.field(visualAtomicField));
  });
});

describe("atomic decorations on incomplete or misplaced constructs", () => {
  it("leaves list and bibliography items outside their environments as source", () => {
    const text = "\\item Loose \\bibitem{x} text\n";
    const state = createState(text, text.length);
    expect(widgets(state, ItemWidget)).toEqual([]);
    expect(widgets(state, BibItemWidget)).toEqual([]);
  });

  it("chips citations and references, including an empty reference", () => {
    const text = "See \\cite{key} and \\ref{} and \\ref{a}.\n";
    const state = createState(text, text.length);
    const icons = widgets(state, IconBraceWidget);
    expect(icons.map((found) => [found.widget.icon, found.widget.content, text.slice(found.from, found.to)])).toEqual([
      ["book", "", "\\cite{"],
      ["tag", "", "\\ref{"],
      ["tag", "", "\\ref{"],
    ]);
    expect(icons[0].widget.title).toBe("visual.citation");
    expect(icons[2].widget.title).toBe("visual.reference");
    const inside = createState(text, positionOf(text, "key"));
    expect(widgets(inside, IconBraceWidget).map((found) => found.widget.icon)).toEqual(["tag", "tag"]);
  });

  it("does not decorate empty headings or colour commands without content", () => {
    const text = "\\section{}\n\\section{ }\n\\textcolor{red} \\footnote\n";
    const state = createState(text, text.length);
    expect(widgets(state, BraceWidget)).toEqual([]);
    expect(widgets(state, FootnoteWidget)).toEqual([]);
  });

  it("shows braces around empty bold text and hides other formatting until the cursor enters it", () => {
    const text = "A \\textbf{} and \\emph{x}.\n";
    const outside = createState(text, text.length);
    const braces = widgets(outside, BraceWidget).map((found) => [text.slice(found.from, found.to), found.widget.content]);
    expect(braces).toEqual([
      ["\\textbf{", "{"],
      ["}", "}"],
      ["\\emph{", ""],
    ]);
    const emphClose = positionOf(text, "x}") + 1;
    expect(hiddenRanges(outside)).toContainEqual({ from: emphClose, to: emphClose + 1 });
    const inside = createState(text, positionOf(text, "x}"));
    expect(widgets(inside, BraceWidget).map((found) => text.slice(found.from, found.to))).toEqual(["\\textbf{", "}"]);
  });

  it("ignores incomplete theorem declarations and empty theorem styles", () => {
    const text = "\\newtheorem{x}\n\\theoremstyle{}\n\\newtheorem{claim}{Claim}\n";
    const theorems = createState(text, text.length).field(visualAtomicField).theorems;
    expect(theorems.has("x")).toBe(false);
    expect(theorems.get("claim")).toEqual({ label: "Claim", style: "plain" });
  });

  it("does not render empty equations or commutative diagrams", () => {
    const text = "\\begin{equation}\n\\end{equation}\n\\begin{tikzcd} A \\end{tikzcd}\n";
    expect(widgets(createState(text, text.length), MathWidget)).toEqual([]);
  });

  it("skips graphics without a path and renders SVG includes", () => {
    const text = "\\includegraphics{}\n\\includesvg{pic}\n";
    const graphics = widgets(createState(text, text.length), GraphicsWidget);
    expect(graphics.map((found) => text.slice(found.from, found.to))).toEqual(["\\includesvg{pic}"]);
  });

  it("keeps single-line environments and inline centering as source", () => {
    const text = "\\begin{center} Mid \\end{center}\n\\begin{figure}\nx \\centering\n\\end{figure}\n";
    const state = createState(text, text.length);
    expect(hiddenRanges(state)).toEqual([]);
    expect(widgets(state, EnvironmentLineWidget).map((found) => found.widget.edge)).toEqual(["begin", "end"]);
  });

  it("hides a centering line surrounded by blank lines inside a figure", () => {
    const text = "\\begin{figure}\n\n\\centering\n\n\\end{figure}\n";
    const state = createState(text, text.length);
    expect(hiddenRanges(state)).toContainEqual(lineOf(text, "\\centering"));
  });
});
