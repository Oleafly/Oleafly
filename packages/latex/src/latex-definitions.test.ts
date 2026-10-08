import { describe, expect, it } from "vitest";
import {
  insideLatexDefinition,
  latexWrapperSections,
  scanLatexDefinitions,
} from "./latex-definitions";

const STYLE = String.raw`\newcommand{\chaptertitle}[2][30]{{\color{white}\titlerule}{\setfontsize{#1}#2}}
\newenvironment{chapterpage}[1]{\noindent\begin{fullminipage}\chapter{#1}}{\end{fullminipage}}
\newcommand{\nsubsection}[1]{\subsection{\MakeUppercase{#1}}}
\let\oldsection\section
\renewcommand\section{\clearpageforsection\oldsection}
\def\topic#1{\section*{#1}}
\NewDocumentCommand{\unit}{s o m}{\IfBooleanTF{#1}{}{}\chapter[#2]{#3}}
\NewDocumentEnvironment{lesson}{O{x} m}{\section{#2}}{}
\renewcommand{\chapter}[1]{\section{#1}}`;

describe("scanLatexDefinitions", () => {
  it("finds the span of every definition and the sectioning wrappers among them", () => {
    const { spans, wrappers } = scanLatexDefinitions(STYLE);
    expect(spans.length).toBeGreaterThan(0);
    const offset = (needle: string) => STYLE.indexOf(needle);
    expect(insideLatexDefinition(spans, offset(String.raw`\chapter{#1}`))).toBe(true);
    expect(insideLatexDefinition(spans, offset(String.raw`\subsection{`))).toBe(true);
    expect(insideLatexDefinition(spans, offset(String.raw`\section{\clearpage`))).toBe(true);
    expect(insideLatexDefinition(spans, offset(String.raw`\let`))).toBe(false);
    expect(wrappers.map((wrapper) => [wrapper.kind, wrapper.name, wrapper.level, wrapper.argument])).toEqual([
      ["command", "nsubsection", 3, 1],
      ["command", "topic", 2, 1],
      ["environment", "chapterpage", 1, 1],
      ["command", "unit", 1, 3],
      ["environment", "lesson", 2, 2],
    ]);
  });

  it("ignores definitions it cannot read", () => {
    const { wrappers } = scanLatexDefinitions(
      String.raw`\def\odd#1.#2{\section{#1}}\NewDocumentCommand{\weird}{r()}{\section{#1}}\newcommand{\plain}{\section{Fixed}}`,
    );
    expect(wrappers).toEqual([]);
  });
});

describe("latexWrapperSections", () => {
  it("skips a wrapper environment with a blank name instead of scanning forever", () => {
    const source = String.raw`\newenvironment{ }[1]{\section{#1}}{}`;
    const { wrappers } = scanLatexDefinitions(source);
    expect(latexWrapperSections(String.raw`${source}
\begin{ }{Title}`, wrappers)).toEqual([]);
  });

  it("turns wrapper uses into headings with the right title and level", () => {
    const { wrappers } = scanLatexDefinitions(STYLE);
    const text = String.raw`\begin{chapterpage}{Introduction to data}
  \chaptertitle{Introduction to data}
  \label{ch_intro}
\end{chapterpage}
\nsubsection{Case study}
\topic{Plain topic}
\unit*[Short]{Long unit}
\begin{lesson}{Lesson one}
\end{lesson}
\nsubsection`;
    expect(latexWrapperSections(text, wrappers).map((section) => [section.level, section.title])).toEqual([
      [1, "Introduction to data"],
      [3, "Case study"],
      [2, "Plain topic"],
      [1, "Long unit"],
      [2, "Lesson one"],
    ]);
    const [first, second] = latexWrapperSections(text, wrappers);
    expect(text.slice(first.titleFrom, first.titleTo)).toBe("Introduction to data");
    expect([first.line, second.line]).toEqual([1, 5]);
  });

  it("reads absent stars and options and drops uses whose arguments cannot be read", () => {
    const { wrappers } = scanLatexDefinitions(STYLE);
    const text = [
      String.raw`\unit [Short] {Plain unit}`,
      String.raw`\unit{No options}`,
      String.raw`\unit*[Fine] missing`,
      String.raw`\unit{Unclosed`,
      String.raw`\unit*[Open forever`,
      String.raw`\begin{lesson}{Lesson two}`,
    ].join("\n");
    expect(latexWrapperSections(text, wrappers).map((section) => [section.line, section.title])).toEqual([
      [1, "Plain unit"],
      [2, "No options"],
      [6, "Lesson two"],
    ]);
  });

  it("matches environment wrappers on their own and command wrappers by their whole name", () => {
    const environments = scanLatexDefinitions(String.raw`\newenvironment{step*}[1]{\subsection{#1}}{}`).wrappers;
    expect(
      latexWrapperSections(String.raw`\begin{step*}{First}\begin{stepp}{Other}\begin {step*} {Second}`, environments).map(
        (section) => [section.level, section.title],
      ),
    ).toEqual([
      [3, "First"],
      [3, "Second"],
    ]);
    const commands = scanLatexDefinitions(String.raw`\newcommand{\head}[1]{\section{#1}}`).wrappers;
    expect(
      latexWrapperSections(String.raw`\head{A}\heading{B}\head@x{C}\headé{D}`, commands).map((section) => section.title),
    ).toEqual(["A"]);
  });

  it("skips wrapper uses inside other definitions", () => {
    const { wrappers } = scanLatexDefinitions(STYLE);
    expect(
      latexWrapperSections(String.raw`\newcommand{\both}[1]{\nsubsection{#1}}\newcommand{\fixed}{\nsubsection{Inner}}`, wrappers),
    ).toEqual([]);
  });
});
