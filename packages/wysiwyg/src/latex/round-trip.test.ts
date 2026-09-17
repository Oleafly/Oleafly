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
  "\\part{P}\n\\chapter*{C}\n\\section[Short]{Long}\n\\paragraph{Q}\n\\subparagraph{R}\n",
  "Text\\footnote{A note with \\emph{nested {braces}} and $x^2$} more.\n",
  "\\textcolor{red}{warm} and \\textcolor[HTML]{FF0000}{hex} \\colorbox{yellow}{box}\n",
  "\\begin{theorem}[Euler's identity]\nBody $e^{i\\pi}$ here.\n\nSecond paragraph.\n\\end{theorem}\n",
  "\\begin{figure}[htbp]\n    \\centering % keep\n    \\includegraphics[height=3cm,width=0.5\\linewidth]{fig/a.png}\n    \\caption{A \\textbf{caption}}\n    \\label{fig:a}\n\\end{figure}\n",
  "\\begin{table}[h]\n  \\centering\n  \\begin{tabular}{|l|c r|p{3cm}|}\n    \\hline\n    A & B & \\multicolumn{2}{c}{C} \\\\\n    \\hline\n    1 & 2 & 3 & 4 \\\\ \\hline\n  \\end{tabular}\n  \\caption{T}\n  \\label{tab:t}\n\\end{table}\n",
  "\\begin{tabular}{cc}\n\\toprule\na & \\textbf{b} \\\\\n\\midrule\n1 & 2 \\\\\n\\bottomrule\n\\end{tabular}\n",
  "\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}\n\\begin{equation}\nx^2\n\\end{equation}\n",
  "Inline $a$ and \\(b\\) then display \\[c\\] and $$d$$ end.\n",
  "\\begin{itemize}\n  \\item one\n  \\begin{enumerate}\n    \\item nested\n  \\end{enumerate}\n  \\item two\n\\end{itemize}\n",
  "\\begin{itemize}\n\\item $$x$$ only\n\\end{itemize}\n",
  "\\begin{figure}\n\\includegraphics{a}\n\\caption[short]{long}\n\\end{figure}\n",
  "\\begin{tabular}{ll}\na & b \\\\ \\cline{1-2}\nc & d\n\\end{tabular}\n",
];

const EXACT = [
  "\\section*[Short]{Long \\textbf{title}}\n",
  "Text\\footnote{A note with \\emph{nested {braces}} and $x^2$} more.\n",
  "\\textcolor{red}{warm} and \\textcolor[HTML]{FF0000}{hex} \\colorbox{yellow}{box}\n",
  "\\begin{theorem}[Euler's identity]\nBody $e^{i\\pi}$ here.\n\nSecond paragraph.\n\\end{theorem}\n",
  "\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}\n",
  "\\begin{itemize}\n  \\item one\n  \\begin{enumerate}\n    \\item nested\n  \\end{enumerate}\n  \\item two\n\\end{itemize}\n",
  "\\begin{figure}[htbp]\n    \\centering\n    \\includegraphics[width=0.5\\linewidth]{fig/a.png}\n    \\caption{A \\textbf{caption}}\n    \\label{fig:a}\n\\end{figure}\n",
  "\\begin{table}[h]\n    \\centering\n    \\begin{tabular}{|l|cr|p{3cm}|}\n        \\hline\n        A & B & \\multicolumn{2}{c}{C} \\\\\n        \\hline\n        1 & 2 & 3 & 4 \\\\\n        \\hline\n    \\end{tabular}\n    \\caption{T}\n    \\label{tab:t}\n\\end{table}\n",
  "\\begin{tabular}{cc}\n    \\toprule\n    a & \\textbf{b} \\\\\n    \\midrule\n    1 & 2 \\\\\n    \\bottomrule\n\\end{tabular}\n",
];

describe("LaTeX parse/serialize round-trip", () => {
  it.each(FIXTURES)("is stable from the second round-trip onward: %s", (source) => {
    const firstPass = serializeLatexBody(parseLatexBody(source));
    const secondPass = serializeLatexBody(parseLatexBody(firstPass));
    expect(secondPass).toBe(firstPass);
  });

  it.each(EXACT)("reproduces canonical source byte for byte: %s", (source) => {
    expect(serializeLatexBody(parseLatexBody(source))).toBe(source);
  });
});
