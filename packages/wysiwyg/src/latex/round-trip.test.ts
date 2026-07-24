import { describe, expect, it } from "vitest";
import { parseLatexBody } from "./parse";
import { serializeLatexBody } from "./serialize";

const FIXTURES = [
  "\\section{Intro}\nSome \\textbf{bold} and \\textit{italic} text.\n",
  "\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}\n",
  "\\begin{quote}\na quote\n\\end{quote}\n",
  "\\section{Intro}\n\\subsection{Details}\nSome text with a \\href{https://example.com}{link}.\n",
];

describe("LaTeX parse/serialize round-trip", () => {
  it.each(FIXTURES)("is stable from the second round-trip onward: %s", (source) => {
    const firstPass = serializeLatexBody(parseLatexBody(source));
    const secondPass = serializeLatexBody(parseLatexBody(firstPass));
    expect(secondPass).toBe(firstPass);
  });
});
