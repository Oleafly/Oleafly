import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Decoration, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { visualAtomicField } from "./atomic-decorations";
import { visualMode } from "./index";
import { parsedState, positionOf, SAMPLE_DOCUMENT, TITLE_DOCUMENT } from "./test-document";
import { BeginTheoremWidget } from "./widgets/begin-theorem";
import { BraceWidget } from "./widgets/brace";
import { EndWidget } from "./widgets/end";
import { EndDocumentWidget } from "./widgets/end-document";
import { EnvironmentLineWidget } from "./widgets/environment-line";
import { FootnoteWidget } from "./widgets/footnote";
import { IconBraceWidget } from "./widgets/icon-brace";
import { MakeTitleWidget } from "./widgets/maketitle";
import { MathWidget } from "./widgets/math";
import { PreambleWidget } from "./widgets/preamble";

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
