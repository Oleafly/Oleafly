import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { latexTreeSupport } from "@oleafly/editor/latex-tree";
import { loadTypstParser, typstLanguage } from "@oleafly/editor/typst";
import { parsedState } from "../../../packages/editor/src/visual/test-document";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ancestorsAtLine,
  readableTitle,
  scanSectionHeadings,
  sectionCrumbsForState,
  typstOutlineChanged,
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

  it("reads the enclosing sections from the visual-mode syntax tree", () => {
    const state = parsedState(
      EditorState.create({
        doc: DOC,
        selection: { anchor: offsetOf(DOC, "Body.") },
        extensions: latexTreeSupport(),
      }),
    );
    const crumbs = sectionCrumbsForState(state, true);
    expect(crumbs.map((crumb) => crumb.title)).toEqual([
      "Widgets",
      "Rendering",
      "Inline and display math",
    ]);
    expect(crumbs[1].pos).toBe(offsetOf(DOC, "Rendering"));
  });

  it("falls back to the text scan when the visual tree has no section around the cursor", () => {
    const state = parsedState(
      EditorState.create({ doc: DOC, selection: { anchor: 2 }, extensions: latexTreeSupport() }),
    );
    expect(sectionCrumbsForState(state, true)).toEqual([]);
  });
});

describe("unusual headings", () => {
  it("keeps the rest of the line as the title of an unclosed heading", () => {
    const [heading] = scanSectionHeadings(Text.of([String.raw`\section{Open \textbf{title`]));
    expect(heading.title).toBe("Open title");
  });

  it("gives up on documents too long to scan", () => {
    const lines = Array.from({ length: 50_001 }, () => String.raw`\section{A}`);
    expect(scanSectionHeadings(Text.of(lines))).toEqual([]);
  });
});

describe("readableTitle", () => {
  it("drops commands and braces but keeps the words", () => {
    expect(readableTitle(String.raw`A \textbf{bold}   title`)).toBe("A bold title");
    expect(readableTitle("")).toBe("");
  });

  it("decodes accent macros and keeps escaped characters", () => {
    expect(readableTitle(String.raw`Úvod do \v{C}eštiny`)).toBe("Úvod do Češtiny");
    expect(readableTitle(String.raw`Dvo\v{r}\'ak a Stra\ss e`)).toBe("Dvořák a Straße");
    expect(readableTitle(String.raw`\"Uber die L\"osung`)).toBe("Über die Lösung");
    expect(readableTitle(String.raw`Costs \& Benefits: 50\% off\,now`)).toBe("Costs & Benefits: 50% off now");
    expect(readableTitle("\\vy\u0301sledek je")).toBe("je");
  });
});

describe("Typst breadcrumbs", () => {
  const TYPST = [
    '#set text(lang: "en")',
    "= Intro *bold* <intro>",
    "Text.",
    "== Methods",
    "=== Inner _part_ with $x^2$",
    "Body.",
    "```",
    "= not a heading",
    "```",
    "= Results \\#1",
    "Tail.",
  ].join("\n");

  beforeAll(async () => {
    await loadTypstParser();
  });

  function typstState(head: number): EditorState {
    const state = EditorState.create({
      doc: TYPST,
      selection: { anchor: head },
      extensions: [typstLanguage()],
    });
    ensureSyntaxTree(state, state.doc.length, 5_000);
    return state.update({}).state;
  }

  it("lists the enclosing headings with their markup rendered away", () => {
    const crumbs = sectionCrumbsForState(typstState(offsetOf(TYPST, "Body.")), false);
    expect(crumbs.map((crumb) => crumb.title)).toEqual(["Intro bold", "Methods", "Inner part with x^2"]);
    expect(crumbs.map((crumb) => crumb.level)).toEqual([1, 2, 3]);
  });

  it("points each crumb at the first character of its title", () => {
    const [intro] = sectionCrumbsForState(typstState(offsetOf(TYPST, "Text.")), false);
    expect(intro.pos).toBe(offsetOf(TYPST, "Intro"));
    expect(intro.line).toBe(2);
  });

  it("skips heading markers inside raw blocks", () => {
    const crumbs = sectionCrumbsForState(typstState(offsetOf(TYPST, "Tail.")), false);
    expect(crumbs.map((crumb) => crumb.title)).toEqual(["Results #1"]);
  });

  it("reports nothing before the first heading", () => {
    expect(sectionCrumbsForState(typstState(3), true)).toEqual([]);
  });
});

describe("typstOutlineChanged", () => {
  beforeAll(async () => {
    await loadTypstParser();
  });

  const update = (startState: EditorState, state: EditorState, docChanged: boolean) =>
    ({ startState, state, docChanged }) as unknown as ViewUpdate;

  function starved(doc: string): EditorState {
    const realNow = Date.now;
    let calls = 0;
    Date.now = () => realNow() + calls++ * 1_000;
    try {
      return EditorState.create({ doc, extensions: [typstLanguage()] });
    } finally {
      Date.now = realNow;
    }
  }

  it("asks for a refresh when a Typst parse finishes without an edit", () => {
    const doc = Array.from({ length: 400 }, (_, index) => `= Section ${index}\ntext`).join("\n");
    const partial = starved(doc);
    ensureSyntaxTree(partial, partial.doc.length, 5_000);
    const finished = partial.update({}).state;
    expect(typstOutlineChanged(update(partial, finished, false))).toBe(true);
    expect(typstOutlineChanged(update(finished, finished, false))).toBe(false);
  });

  it("asks for a refresh when an edit lands on a Typst heading line", () => {
    const state = EditorState.create({
      doc: "= Title\nbody",
      selection: { anchor: 3 },
      extensions: [typstLanguage()],
    });
    expect(typstOutlineChanged(update(state, state, true))).toBe(true);
    const body = state.update({ selection: { anchor: 10 } }).state;
    expect(typstOutlineChanged(update(body, body, true))).toBe(false);
  });

  it("leaves other languages to the line-based signal", () => {
    const state = stateFor(DOC, 3);
    expect(typstOutlineChanged(update(state, state.update({}).state, false))).toBe(false);
  });
});
