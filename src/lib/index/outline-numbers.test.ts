import { describe, expect, it } from "vitest";
import { createLatexWrapperSectionCollector, renderLatexOutlineTitle } from "@oleafly/latex";
import type { AuxToc, AuxTocEntry } from "@/lib/aux-numbers";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import { legacyIndexFromProjectIntelligence } from "@/lib/project-intelligence/legacy-index";
import type { LatexUnitScope } from "@/lib/project-intelligence/latex-units";
import { outlineFromIndex, type ExtraOutlineSection } from "./outline";
import { headingKey, latexOutlineNumbers, outlineNumbers } from "./outline-numbers";
import { parseFile } from "./parse-file";
import type { ProjectIndex } from "./types";

const heading = (level: number, title: string) => ({ level, keys: [headingKey(title)] });
const entry = (level: number, title: string, number: string | null) => ({
  level,
  key: headingKey(title),
  number,
});

describe("outlineNumbers", () => {
  it("numbers headings that match an entry by level and title, in order", () => {
    expect(
      outlineNumbers(
        [heading(2, "Intro"), heading(3, "Proof"), heading(2, "Method"), heading(3, "Proof")],
        [entry(2, "Intro", "1"), entry(3, "Proof", "1.1"), entry(2, "Method", "2"), entry(3, "Proof", "2.1")],
      ),
    ).toEqual(["1", "1.1", "2", "2.1"]);
  });

  it("compares titles without spacing, case or punctuation", () => {
    expect(outlineNumbers([heading(2, "Encoder--decoder  models")], [entry(2, "encoder-decoder models", "6")])).toEqual([
      "6",
    ]);
  });

  it("gives a heading in the place of a renamed or deleted one the number there", () => {
    expect(
      outlineNumbers(
        [heading(2, "Intro"), heading(2, "Renamed"), heading(2, "End")],
        [entry(2, "Intro", "1"), entry(2, "Old name", "2"), entry(2, "End", "3")],
      ),
    ).toEqual(["1", "2", "3"]);
  });

  it("leaves a heading added since the compile unnumbered", () => {
    expect(
      outlineNumbers(
        [heading(2, "Intro"), heading(2, "New"), heading(2, "End")],
        [entry(2, "Intro", "1"), entry(2, "End", "2")],
      ),
    ).toEqual(["1", null, "2"]);
  });

  it("leaves a title unnumbered when it repeats a different number of times", () => {
    expect(
      outlineNumbers([heading(2, "Same"), heading(2, "Same"), heading(2, "End")], [entry(2, "Same", "1"), entry(2, "End", "2")]),
    ).toEqual([null, null, "2"]);
  });

  it("pairs a repeated title within each stretch between unique titles", () => {
    expect(
      outlineNumbers(
        [heading(1, "Basics"), heading(2, "Exercises"), heading(1, "Flows"), heading(2, "Exercises"), heading(2, "Exercises")],
        [entry(1, "Basics", "1"), entry(2, "Exercises", "1.1"), entry(1, "Flows", "2"), entry(2, "Exercises", "2.1")],
      ),
    ).toEqual(["1", "1.1", "2", null, null]);
  });

  it("does not guess across runs whose levels differ", () => {
    expect(
      outlineNumbers(
        [heading(2, "Intro"), heading(3, "Renamed"), heading(2, "End")],
        [entry(2, "Intro", "1"), entry(2, "Old", "2"), entry(2, "End", "3")],
      ),
    ).toEqual(["1", null, "3"]);
  });

  it("does not guess a number for a level the document never numbers", () => {
    expect(
      outlineNumbers(
        [heading(2, "Intro"), heading(5, "Renamed paragraph"), heading(2, "End")],
        [entry(2, "Intro", "1"), entry(5, "Old paragraph", null), entry(2, "End", "2")],
      ),
    ).toEqual(["1", null, "2"]);
  });

  it("numbers repeated titles in order when nothing else tells them apart", () => {
    expect(outlineNumbers([heading(2, "Same"), heading(2, "Same")], [entry(2, "Same", "1"), entry(2, "Same", "2")])).toEqual([
      "1",
      "2",
    ]);
  });

  it("keeps unnumbered entries in a fully title-aligned gap", () => {
    expect(
      outlineNumbers(
        [heading(1, "Introduction"), heading(1, "Introduction")],
        [entry(1, "Introduction", null), entry(1, "Introduction", "1")],
      ),
    ).toEqual([null, "1"]);
  });

  it("does not position headings against an unrelated unnumbered entry", () => {
    expect(
      outlineNumbers(
        [heading(2, "Same"), heading(2, "Same")],
        [entry(2, "Manual", null), entry(2, "Same", "1")],
      ),
    ).toEqual([null, null]);
  });

  it("does not treat empty title keys as an alignment with unnumbered entries", () => {
    expect(
      outlineNumbers(
        [heading(2, "+"), heading(2, "-")],
        [entry(2, "!", null), entry(2, "?", "1")],
      ),
    ).toEqual([null, null]);
  });

  it("numbers nothing when no title matches and the headings do not line up", () => {
    expect(
      outlineNumbers([heading(2, "A"), heading(2, "B"), heading(2, "C")], [entry(2, "X", "1"), entry(2, "Y", "2")]),
    ).toEqual([null, null, null]);
  });

  it("skips headings that take no part", () => {
    expect(outlineNumbers([heading(2, "Intro"), null, heading(2, "End")], [entry(2, "Intro", "1"), entry(2, "End", "2")]))
      .toEqual(["1", null, "2"]);
  });
});

const render = (tex: string) => renderLatexOutlineTitle(tex);

function tocOf(entries: readonly AuxTocEntry[], mainDocument = "main.tex"): AuxToc {
  return { projectId: "p1", mainDocument, entries };
}

function numbersIn(
  index: ProjectIndex,
  texts: Record<string, string>,
  toc: AuxToc,
  viewer = "main.tex",
  extraSections?: (file: string) => readonly ExtraOutlineSection[],
) {
  const items = outlineFromIndex(index, viewer, extraSections);
  const numbers = latexOutlineNumbers({ items, viewer, toc, index, texts, extraSections, render });
  return items.map((item, at) => [render(item.title), numbers[at]]);
}

function numbersFor(
  texts: Record<string, string>,
  toc: AuxToc,
  viewer = "main.tex",
  unitScope?: LatexUnitScope,
  extraSections?: (file: string) => readonly ExtraOutlineSection[],
) {
  const symbols = Object.entries(texts).map(([file, text]) => parseFile(file, text));
  const index = {
    defs: symbols.flatMap((file) => file.defs),
    uses: symbols.flatMap((file) => file.uses).filter((use) => use.kind === "inputedge"),
    ...(unitScope ? { unitScope } : {}),
  } as ProjectIndex;
  return numbersIn(index, texts, toc, viewer, extraSections);
}

const article = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;

function analyzedIndex(texts: Record<string, string>): ProjectIndex {
  return legacyIndexFromProjectIntelligence(assembleProjectIntelligence({
    identity: { projectId: "p1", projectRevision: 1, requestGeneration: 1 },
    files: Object.fromEntries(
      Object.entries(texts).map(([file, text]) => [file, analyzeProjectFile(file, text, 1)]),
    ),
    knownFiles: Object.keys(texts),
    mainDocument: "main.tex",
    stats: { fileCount: 0, characterCount: 0, parsedFileCount: 0, reusedFileCount: 0, durationMs: 0 },
  }));
}

describe("latexOutlineNumbers", () => {
  it("matches a short title, which the table of contents shows", () => {
    const tex = [
      "\\section{Intro}",
      "\\section{Added after the compile}",
      "\\section[Related work]{Related work and prior approaches}",
      "\\section{End}",
    ].join("\n");
    const toc = tocOf([
      { level: 2, number: "1", title: "Intro" },
      { level: 2, number: "2", title: "Related work" },
      { level: 2, number: "3", title: "End" },
    ]);
    expect(numbersFor({ "main.tex": tex }, toc)).toEqual([
      ["Intro", "1"],
      ["Added after the compile", null],
      ["Related work and prior approaches", "2"],
      ["End", "3"],
    ]);
  });

  it("never numbers a starred heading", () => {
    const tex = "\\section{Intro}\n\\section*{Notation}\n\\section{End}";
    const toc = tocOf([
      { level: 2, number: "1", title: "Intro" },
      { level: 2, number: "2", title: "Notation" },
      { level: 2, number: "3", title: "End" },
    ]);
    expect(numbersFor({ "main.tex": tex }, toc)).toEqual([
      ["Intro", "1"],
      ["Notation", null],
      ["End", "3"],
    ]);
  });

  it("reads heading stars and short titles through comments", () => {
    const tex = [
      String.raw`\section*% explanation`,
      "{Intro}",
      String.raw`\section[Short% explanation`,
      "]{Method}",
    ].join("\n");
    const toc = tocOf([
      { level: 2, number: "1", title: "Intro" },
      { level: 2, number: "2", title: "Short" },
    ]);
    expect(numbersFor({ "main.tex": tex }, toc)).toEqual([
      ["Intro", null],
      ["Method", "2"],
    ]);
  });

  it.each(["unit", "sectionunit"])("does not interpret a star on the %s wrapper as a sectioning star", (name) => {
    const texts = {
      "main.tex": `\\NewDocumentCommand{\\${name}}{s o m}{\\chapter{#3}}\n\\${name}*[Short]{Long}`,
    };
    const toc = tocOf([{ level: 1, number: "1", title: "Long" }]);
    const wrappers = createLatexWrapperSectionCollector()(texts);
    expect(numbersFor(texts, toc, "main.tex", undefined, (file) => wrappers.get(file) ?? []))
      .toEqual([["Long", "1"]]);
  });

  it("does not use an unrelated wrapper optional argument as a TOC title", () => {
    const texts = {
      "main.tex": [
        String.raw`\NewDocumentCommand{\unit}{o m}{\section{#2}}`,
        String.raw`\unit[End]{Added after the compile}`,
        String.raw`\section{End}`,
      ].join("\n"),
    };
    const toc = tocOf([{ level: 2, number: "1", title: "End" }]);
    const wrappers = createLatexWrapperSectionCollector()(texts);
    expect(numbersFor(texts, toc, "main.tex", undefined, (file) => wrappers.get(file) ?? []))
      .toEqual([["Added after the compile", null], ["End", "1"]]);
  });

  it("reads titles the way TeX writes them", () => {
    const tex = "\\section{The \\texorpdfstring{$L^2$}{L2} loss}\n\\section{A~B}";
    const toc = tocOf([
      { level: 2, number: "1", title: "The $L^2$ loss" },
      { level: 2, number: "2", title: "A\\nobreakspace {}B" },
    ]);
    expect(numbersFor({ "main.tex": tex }, toc).map(([, number]) => number)).toEqual(["1", "2"]);
  });

  it("matches a title with a label, which the table of contents drops", () => {
    const tex = "\\section{Intro\\label{sec:intro}}\n\\section{Added after the compile}";
    const toc = tocOf([{ level: 2, number: "1", title: "Intro" }]);
    expect(numbersFor({ "main.tex": tex }, toc).map(([, number]) => number)).toEqual(["1", null]);
  });

  it("numbers an included chapter's headings from the whole document's contents", () => {
    const texts = {
      "main.tex": "\\section{Intro}\n\\input{chapter}",
      "chapter.tex": "\\section{Body}\n\\subsection{Detail}",
    };
    const toc = tocOf([
      { level: 2, number: "1", title: "Intro" },
      { level: 2, number: "2", title: "Body" },
      { level: 3, number: "2.1", title: "Detail" },
    ]);
    const scope = { sharesScope: () => true } as unknown as LatexUnitScope;
    expect(numbersFor(texts, toc, "chapter.tex", scope)).toEqual([
      ["Body", "2"],
      ["Detail", "2.1"],
    ]);
  });

  it("keeps repeated wrapper heading numbers in included-file views", () => {
    const texts = {
      "main.tex": "\\newcommand{\\topic}[1]{\\section{#1}}\n\\input{one}\n\\input{two}",
      "one.tex": "\\chapter{Basics}\n\\topic{Exercises}",
      "two.tex": "\\chapter{Flows}\n\\topic{Exercises}",
    };
    const toc = tocOf([
      { level: 1, number: "1", title: "Basics" },
      { level: 2, number: "1.1", title: "Exercises" },
      { level: 1, number: "2", title: "Flows" },
      { level: 2, number: "2.1", title: "Exercises" },
    ]);
    const wrapperSections = createLatexWrapperSectionCollector()(texts);
    const extraSections = (file: string) => wrapperSections.get(file) ?? [];
    expect(numbersFor(texts, toc, "main.tex", undefined, extraSections)).toEqual([
      ["Basics", "1"],
      ["Exercises", "1.1"],
      ["Flows", "2"],
      ["Exercises", "2.1"],
    ]);
    expect(numbersFor(texts, toc, "one.tex", undefined, extraSections)).toEqual([
      ["Basics", "1"],
      ["Exercises", "1.1"],
    ]);
    expect(numbersFor(texts, toc, "two.tex", undefined, extraSections)).toEqual([
      ["Flows", "2"],
      ["Exercises", "2.1"],
    ]);
  });

  it("numbers a bare-input child recognized by the production compilation-unit scanner", () => {
    const texts = {
      "main.tex": article("\\section{Intro}\n\\input chapter.tex\n\\section{End}"),
      "chapter.tex": String.raw`\section{Body}`,
      "other.tex": article(String.raw`\section{Body}`),
    };
    const index = analyzedIndex(texts);
    const toc = tocOf([
      { level: 2, number: "1", title: "Intro" },
      { level: 2, number: "2", title: "Body" },
      { level: 2, number: "3", title: "End" },
    ]);
    expect(index.unitScope?.sharesScope("main.tex", "chapter.tex")).toBe(true);
    expect(outlineFromIndex(index, "main.tex").map((item) => item.title)).toEqual(["Intro", "End"]);
    expect(numbersIn(index, texts, toc, "chapter.tex")).toEqual([["Body", "2"]]);
    expect(numbersIn(index, texts, toc)).toEqual([["Intro", "1"], ["End", "3"]]);
    expect(numbersIn(index, texts, toc, "other.tex")).toEqual([["Body", null]]);
  });

  it("numbers a visible heading beyond the root outline's depth limit", () => {
    const texts: Record<string, string> = {
      "main.tex": article(String.raw`\input{level-1}`),
      "other.tex": article(""),
    };
    for (let level = 1; level <= 9; level++) {
      texts[`level-${level}.tex`] = level === 9 ? String.raw`\section{Deep}` : `\\input{level-${level + 1}}`;
    }
    const index = analyzedIndex(texts);
    const toc = tocOf([{ level: 2, number: "1", title: "Deep" }]);
    expect(index.unitScope?.sharesScope("main.tex", "level-9.tex")).toBe(true);
    expect(outlineFromIndex(index, "main.tex").some((item) => item.kind === "section")).toBe(false);
    expect(numbersIn(index, texts, toc, "level-9.tex")).toEqual([["Deep", "1"]]);
  });

  it("does not guess positions for headings omitted by the root walk", () => {
    const texts = {
      "main.tex": article("\\input chapter.tex\n"),
      "chapter.tex": String.raw`\section{Renamed}`,
      "other.tex": article(""),
    };
    const index = analyzedIndex(texts);
    const toc = tocOf([{ level: 2, number: "1", title: "Old title" }]);
    expect(numbersIn(index, texts, toc, "chapter.tex")).toEqual([["Renamed", null]]);
  });

  it("does not choose between repeated TOC titles for an omitted heading", () => {
    const texts = {
      "main.tex": article("\\input one.tex\n\\input two.tex\n"),
      "one.tex": String.raw`\section{Same}`,
      "two.tex": String.raw`\section{Same}`,
      "other.tex": article(""),
    };
    const index = analyzedIndex(texts);
    const toc = tocOf([
      { level: 2, number: "1", title: "Same" },
      { level: 2, number: "2", title: "Same" },
    ]);
    expect(numbersIn(index, texts, toc, "one.tex")).toEqual([["Same", null]]);
    expect(numbersIn(index, texts, toc, "two.tex")).toEqual([["Same", null]]);
  });

  it("reserves an omitted heading's exact match before root positional fallback in every view", () => {
    const texts = {
      "main.tex": article("\\section{Renamed}\n\\input chapter.tex\n"),
      "chapter.tex": String.raw`\section{Original}`,
      "other.tex": article(""),
    };
    const index = analyzedIndex(texts);
    const toc = tocOf([{ level: 2, number: "1", title: "Original" }]);
    expect(numbersIn(index, texts, toc)).toEqual([["Renamed", null]]);
    expect(numbersIn(index, texts, toc, "chapter.tex")).toEqual([["Original", "1"]]);
    expect(numbersIn(index, texts, toc)).toEqual([["Renamed", null]]);
  });

  it("retains positional fallback for root entries left after reservations", () => {
    const texts = {
      "main.tex": article("\\section{Renamed}\n\\input chapter.tex\n"),
      "chapter.tex": String.raw`\section{Original}`,
      "other.tex": article(""),
    };
    const index = analyzedIndex(texts);
    const toc = tocOf([
      { level: 2, number: "1", title: "Old root title" },
      { level: 2, number: "2", title: "Original" },
    ]);
    expect(numbersIn(index, texts, toc)).toEqual([["Renamed", "1"]]);
    expect(numbersIn(index, texts, toc, "chapter.tex")).toEqual([["Original", "2"]]);
  });

  it("reserves omitted wrapper headings even when only the root outline is visible", () => {
    const texts = {
      "main.tex": article([
        String.raw`\NewDocumentCommand{\unit}{s o m}{\section{#3}}`,
        String.raw`\section{Added}`,
        String.raw`\input chapter.tex`,
      ].join("\n")),
      "chapter.tex": String.raw`\unit*[Short]{Original}`,
      "other.tex": article(""),
    };
    const index = analyzedIndex(texts);
    const toc = tocOf([{ level: 2, number: "1", title: "Original" }]);
    const wrappers = createLatexWrapperSectionCollector()(texts);
    const extraSections = (file: string) => wrappers.get(file) ?? [];
    expect(numbersIn(index, texts, toc, "main.tex", extraSections)).toEqual([["Added", null]]);
    expect(numbersIn(index, texts, toc, "chapter.tex", extraSections)).toEqual([["Original", "1"]]);
  });

  it("checks omitted-title uniqueness across files rather than only the active outline", () => {
    const texts = {
      "main.tex": article("\\input one.tex\n\\input two.tex\n"),
      "one.tex": String.raw`\section{Same}`,
      "two.tex": String.raw`\section{Same}`,
      "other.tex": article(""),
    };
    const index = analyzedIndex(texts);
    const toc = tocOf([{ level: 2, number: "1", title: "Same" }]);
    expect(numbersIn(index, texts, toc, "one.tex")).toEqual([["Same", null]]);
    expect(numbersIn(index, texts, toc, "two.tex")).toEqual([["Same", null]]);
  });

  it("never assigns one TOC entry to both root and omitted headings with the same title", () => {
    const texts = {
      "main.tex": article("\\section{Same}\n\\input chapter.tex\n"),
      "chapter.tex": String.raw`\section{Same}`,
      "other.tex": article(""),
    };
    const index = analyzedIndex(texts);
    const toc = tocOf([{ level: 2, number: "1", title: "Same" }]);
    const numbered = [
      ...numbersIn(index, texts, toc),
      ...numbersIn(index, texts, toc, "chapter.tex"),
    ].filter(([, number]) => number !== null);
    expect(numbered.length).toBeLessThanOrEqual(1);
  });

  it("numbers an included file of a one-document project, which has no units", () => {
    const texts = {
      "main.tex": "\\section{Intro}\n\\include{chapters/body}",
      "chapters/body.tex": "\\section{Body}",
      "notes.tex": "\\section{Body}",
    };
    const toc = tocOf([
      { level: 2, number: "1", title: "Intro" },
      { level: 2, number: "2", title: "Body" },
    ]);
    expect(numbersFor(texts, toc, "main.tex")).toEqual([
      ["Intro", "1"],
      ["Body", "2"],
    ]);
    expect(numbersFor(texts, toc, "chapters/body.tex")).toEqual([["Body", "2"]]);
    expect(numbersFor(texts, toc, "notes.tex")).toEqual([["Body", null]]);
  });

  it("numbers no document but the compiled one", () => {
    const texts = { "main.tex": "\\section{Intro}", "draft.tex": "\\section{Intro}" };
    const toc = tocOf([{ level: 2, number: "1", title: "Intro" }]);
    const scope = {
      sharesScope: (left: string, right: string) => left === right,
    } as unknown as LatexUnitScope;
    expect(numbersFor(texts, toc, "draft.tex", scope)).toEqual([["Intro", null]]);
    expect(numbersFor(texts, toc, "draft.tex")).toEqual([["Intro", null]]);
    expect(numbersFor(texts, toc, "main.tex", scope)).toEqual([["Intro", "1"]]);
  });
});
