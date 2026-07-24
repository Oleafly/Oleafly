import { describe, expect, it } from "vitest";
import { parseLatexBody } from "./parse";
import { serializeLatexBody } from "./serialize";

const FIXTURES = [
  "\\section{Intro}\nSome \\textbf{bold} and \\textit{italic} text.\n",
  "\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}\n",
  "\\begin{quote}\na quote\n\\end{quote}\n",
  "\\section{Intro}\n\\subsection{Details}\nSome text with a \\href{https://example.com}{link}.\n",
  "\\newcommand{\\role}[4]{\\textbf{#1} \\hfill #2 \\\\\n\\textit{#3} \\hfill \\textit{#4}}\n\\role{Senior Engineer}{Google}{Mountain View}{2020 -- Present}\n",
  "\\begin{itemize}\n  \\item cut latency 38\\% and saved \\$14M/year\n\\end{itemize}\n",
  "\\textbf{Ratel} \\hfill \\href{https://x.com}{y} \\\\\n\\textit{Go} --- a rate limiter.\n",
];

describe("LaTeX parse/serialize round-trip", () => {
  it.each(FIXTURES)("is stable from the second round-trip onward: %s", (source) => {
    const firstPass = serializeLatexBody(parseLatexBody(source));
    const secondPass = serializeLatexBody(parseLatexBody(firstPass));
    expect(secondPass).toBe(firstPass);
  });
});
