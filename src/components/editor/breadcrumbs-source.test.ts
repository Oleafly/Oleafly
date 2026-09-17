import { EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  ancestorsAtLine,
  readableTitle,
  scanSectionHeadings,
  sectionCrumbsForState,
} from "./breadcrumbs-source";

const DOC = [
  String.raw`\documentclass{article}`,
  String.raw`\begin{document}`,
  String.raw`\section{Widgets}`,
  "Intro.",
  String.raw`\subsection{Rendering}`,
  String.raw`\subsubsection{Inline and display math}`,
  "Body.",
  String.raw`% \section{Commented out}`,
  String.raw`\section*{Appendix}`,
  "Tail.",
  String.raw`\end{document}`,
].join("\n");

function stateFor(doc: string, head: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: head } });
}

function offsetOf(doc: string, needle: string): number {
  const index = doc.indexOf(needle);
  if (index < 0) throw new Error(`not in the fixture: ${needle}`);
  return index;
}

describe("scanSectionHeadings", () => {
  it("reads every sectioning command with its title and skips commented lines", () => {
    const headings = scanSectionHeadings(Text.of(DOC.split("\n")));
    expect(headings.map((heading) => heading.title)).toEqual([
      "Widgets",
      "Rendering",
      "Inline and display math",
      "Appendix",
    ]);
    expect(headings.map((heading) => heading.level)).toEqual([2, 3, 4, 2]);
    expect(headings[0].line).toBe(3);
  });

  it("points each crumb at the first character of its title", () => {
    const headings = scanSectionHeadings(Text.of(DOC.split("\n")));
    expect(headings[0].pos).toBe(offsetOf(DOC, "Widgets"));
    expect(headings[3].pos).toBe(offsetOf(DOC, "Appendix"));
  });

  it("reads a title that carries braces and an optional short title", () => {
    const doc = String.raw`\chapter[Short]{A \emph{bold} title}`;
    const [heading] = scanSectionHeadings(Text.of([doc]));
    expect(heading.title).toBe("A bold title");
    expect(heading.level).toBe(1);
  });
});

describe("ancestorsAtLine", () => {
  it("keeps one crumb per depth down to the cursor", () => {
    const headings = scanSectionHeadings(Text.of(DOC.split("\n")));
    expect(ancestorsAtLine(headings, 7).map((heading) => heading.title)).toEqual([
      "Widgets",
      "Rendering",
      "Inline and display math",
    ]);
    expect(ancestorsAtLine(headings, 10).map((heading) => heading.title)).toEqual(["Appendix"]);
    expect(ancestorsAtLine(headings, 1)).toEqual([]);
  });

  it("includes the heading the cursor sits on", () => {
    const headings = scanSectionHeadings(Text.of(DOC.split("\n")));
    expect(ancestorsAtLine(headings, 5).map((heading) => heading.title)).toEqual([
      "Widgets",
      "Rendering",
    ]);
  });
});

describe("sectionCrumbsForState", () => {
  it("falls back to the text scan when no tree language is loaded", () => {
    const state = stateFor(DOC, offsetOf(DOC, "Body."));
    expect(sectionCrumbsForState(state, false).map((crumb) => crumb.title)).toEqual([
      "Widgets",
      "Rendering",
      "Inline and display math",
    ]);
    expect(sectionCrumbsForState(state, true).map((crumb) => crumb.title)).toEqual([
      "Widgets",
      "Rendering",
      "Inline and display math",
    ]);
  });

  it("reports nothing in the preamble", () => {
    expect(sectionCrumbsForState(stateFor(DOC, 2), false)).toEqual([]);
  });
});

describe("readableTitle", () => {
  it("drops commands and braces but keeps the words", () => {
    expect(readableTitle(String.raw`A \textbf{bold}   title`)).toBe("A bold title");
    expect(readableTitle("")).toBe("");
  });
});
