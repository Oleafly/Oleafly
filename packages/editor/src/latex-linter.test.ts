import { describe, it, expect } from "vitest";
import { lintLatexText } from "./latex-linter";

describe("lintLatexText: environments", () => {
  it("passes correctly nested environments", () => {
    const d = lintLatexText("\\begin{a}\\begin{b}x\\end{b}\\end{a}");
    expect(d).toHaveLength(0);
  });

  it("flags a mismatched \\end (and the now-unclosed \\begin)", () => {
    const d = lintLatexText("\\begin{itemize}x\\end{enumerate}");
    // The mismatch is reported, and since \begin{itemize} never closes it is
    // also reported as unclosed.
    expect(d).toHaveLength(2);
    expect(d[0].severity).toBe("error");
    expect(d[0].message).toContain("Unclosed environment \\begin{itemize}");
    expect(d[1].message).toContain("\\end{enumerate} has no matching \\begin{enumerate}");
  });

  it("flags an unclosed environment", () => {
    const d = lintLatexText("\\begin{document}hello");
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("Unclosed environment \\begin{document}");
  });

  it("flags an \\end with no matching \\begin", () => {
    const d = lintLatexText("hello\\end{document}");
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("has no matching \\begin{document}");
  });
});

describe("lintLatexText: labels", () => {
  it("warns on a duplicate label, once", () => {
    const d = lintLatexText("\\label{eq:1} ... \\label{eq:1}");
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe("warning");
    expect(d[0].message).toContain("Duplicate label");
    expect(d[0].message).toContain("eq:1");
  });

  it("allows distinct labels", () => {
    expect(lintLatexText("\\label{a}\\label{b}")).toHaveLength(0);
  });
});

describe("lintLatexText: inline math", () => {
  it("warns on an odd number of $ on a line", () => {
    const d = lintLatexText("the cost is $x per item");
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("Unclosed math delimiter $");
  });

  it("accepts balanced $ ... $", () => {
    expect(lintLatexText("the cost is $x$ per item")).toHaveLength(0);
  });

  it("ignores escaped \\$ and display $$", () => {
    expect(lintLatexText("price \\$5 and $$E=mc^2$$")).toHaveLength(0);
  });
});

describe("lintLatexText: malformed command forms", () => {
  it("accepts supported command and environment definition forms", () => {
    const source = String.raw`
\newcommand{\widget}[2]{#1 + #2}
\renewcommand\widget[1]{#1}
\NewDocumentCommand{\modern}{m O{default}}{#1}
\def\legacy#1{#1}
\newenvironment{experiment}{\begin{quote}}{\end{quote}}
\NewDocumentEnvironment{modernenv}{m}{#1}{}
`;
    expect(lintLatexText(source)).toHaveLength(0);
  });

  it("reports a malformed command definition name and keeps scanning", () => {
    const diagnostics = lintLatexText(
      String.raw`\newcommand{widget}[1]{#1}
\begin{itemize}
\end{enumerate}`,
    );
    expect(
      diagnostics.some((item) =>
        item.message.includes("requires a single control-sequence name"),
      ),
    ).toBe(true);
    expect(
      diagnostics.some((item) =>
        item.message.includes("\\end{enumerate} has no matching"),
      ),
    ).toBe(true);
  });

  it.each([
    [String.raw`\newcommand{\classic}`, "replacement body"],
    [
      String.raw`\NewDocumentCommand{\modern}{m}`,
      "replacement body",
    ],
    [String.raw`\newenvironment{classicenv}{}`, "end body"],
    [
      String.raw`\NewDocumentEnvironment{modernenv}{m}{}`,
      "end body",
    ],
  ])(
    "reports incomplete definition %s",
    (source, expectedDescription) => {
      const diagnostics = lintLatexText(source);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(
        diagnostics.some((item) =>
          item.message.includes(expectedDescription),
        ),
      ).toBe(true);
      expect(
        diagnostics.every(
          (item) => item.from >= 0 && item.to <= source.length,
        ),
      ).toBe(true);
    },
  );

  it("skips valid listings and minted inline-verbatim bodies", () => {
    const source = String.raw`
\lstinline[language={[LaTeX]TeX}]!\begin{oops}{$ { #!
\mintinline{latex}|\end{oops}} $ { \broken|
\mintinline[breaklines]{latex}{\begin{oops} $ { still code }}
`;
    expect(lintLatexText(source)).toHaveLength(0);
  });

  it("accepts the supported xparse argument grammar", () => {
    const source = String.raw`
\NewDocumentCommand{\complete}{+m !o O{default} s t+ r() R<>{fallback} d[] D||{fallback} e{^_} E{^_}{{up}{down}}}{}
\NewDocumentEnvironment{completeenv}{>{\TrimSpaces}m +b}{}{}
`;
    expect(lintLatexText(source)).toHaveLength(0);
  });

  it("pinpoints unknown and incomplete xparse argument types", () => {
    const unknown = String.raw`\NewDocumentCommand{\bad}{m Z}{}`;
    const unknownDiagnostics = lintLatexText(unknown);
    const unknownType = unknownDiagnostics.find((item) =>
      item.message.includes("Unknown xparse argument type"),
    );
    expect(unknownType).toBeDefined();
    expect(
      unknown.slice(unknownType?.from, unknownType?.to),
    ).toBe("Z");

    const incomplete = String.raw`\NewDocumentCommand{\bad}{m r(}{}`;
    const incompleteDiagnostics = lintLatexText(incomplete);
    const incompleteType = incompleteDiagnostics.find((item) =>
      item.message.includes("requires two delimiter tokens"),
    );
    expect(incompleteType).toBeDefined();
    expect(
      incomplete.slice(
        incompleteType?.from,
        incompleteType?.to,
      ),
    ).toBe("r(");
  });

  it("reports missing, empty, and unclosed structural arguments", () => {
    const diagnostics = lintLatexText(
      String.raw`\documentclass article
\usepackage{}
\RequirePackage[feature
\section{Later source remains editable}`,
    );
    expect(
      diagnostics.some((item) =>
        item.message.includes("\\documentclass requires a braced argument"),
      ),
    ).toBe(true);
    expect(
      diagnostics.some((item) =>
        item.message.includes("\\usepackage argument cannot be empty"),
      ),
    ).toBe(true);
    expect(
      diagnostics.some((item) =>
        item.message.includes("Unclosed optional argument to \\RequirePackage"),
      ),
    ).toBe(true);
  });

  it("reports an incomplete trailing command without suppressing earlier diagnostics", () => {
    const diagnostics = lintLatexText(
      String.raw`\begin{document}
Text }` + "\n\\",
    );
    expect(
      diagnostics.some((item) =>
        item.message.includes("Closing brace has no matching"),
      ),
    ).toBe(true);
    expect(
      diagnostics.some((item) =>
        item.message.includes("Incomplete command at end of file"),
      ),
    ).toBe(true);
  });
});
