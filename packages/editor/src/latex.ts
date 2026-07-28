import { stex, stexMath } from "@codemirror/legacy-modes/mode/stex";
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";

let bibKeysProvider: () => string[] = () => [];
export function setBibKeysProvider(fn: () => string[]) {
  bibKeysProvider = fn;
}

export const latexLanguage = () =>
  new LanguageSupport(StreamLanguage.define(stex));

/** For content that's bare math (no surrounding $...$ or \[...\]), e.g. the equation preview tool. */
export const latexMathLanguage = () =>
  new LanguageSupport(StreamLanguage.define(stexMath));

function labelsInDocument(state: { doc: { toString: () => string } }): string[] {
  const text = state.doc.toString();
  const out: string[] = [];
  const re = /\\label\s*\{([^}]{1,500})\}/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

export function bibKeysFromSources(sources: Iterable<string>): string[] {
  const out: string[] = [];
  for (const content of sources) {
    const re = /@\w+\s*\{\s*([^,\s}]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) out.push(m[1]);
  }
  return out;
}

function cmd(label: string, detail: string, template?: string): Completion {
  return {
    label,
    type: "function",
    detail,
    apply: template ? snippet(template) : undefined,
  };
}

const LATEX_COMMANDS: Completion[] = [
  cmd("\\documentclass", "document class", "\\documentclass{${1}}"),
  cmd("\\begin", "begin environment", "\\begin{${1}}\n  ${2}\n\\end{${1}}"),
  cmd("\\end", "end environment", "\\end{${1}}"),
  cmd("\\textbf", "bold text", "\\textbf{${1}}"),
  cmd("\\textit", "italic text", "\\textit{${1}}"),
  cmd("\\emph", "emphasize", "\\emph{${1}}"),
  cmd("\\underline", "underline", "\\underline{${1}}"),
  cmd("\\texttt", "monospace text", "\\texttt{${1}}"),
  cmd("\\textsc", "small caps", "\\textsc{${1}}"),
  cmd("\\textsf", "sans-serif text", "\\textsf{${1}}"),
  cmd("\\textrm", "roman text", "\\textrm{${1}}"),
  cmd("\\textcolor", "colored text", "\\textcolor{${1}}{${2}}"),
  cmd("\\part", "part heading", "\\part{${1}}"),
  cmd("\\chapter", "chapter heading", "\\chapter{${1}}"),
  cmd("\\section", "section", "\\section{${1}}"),
  cmd("\\subsection", "subsection", "\\subsection{${1}}"),
  cmd("\\subsubsection", "subsubsection", "\\subsubsection{${1}}"),
  cmd("\\paragraph", "paragraph heading", "\\paragraph{${1}}"),
  cmd("\\subparagraph", "subparagraph heading", "\\subparagraph{${1}}"),
  cmd("\\item", "list item", "\\item ${1}"),
  cmd("\\label", "label", "\\label{${1}}"),
  cmd("\\ref", "reference", "\\ref{${1}}"),
  cmd("\\eqref", "equation ref", "\\eqref{${1}}"),
  cmd("\\pageref", "page reference", "\\pageref{${1}}"),
  cmd("\\autoref", "automatic reference", "\\autoref{${1}}"),
  cmd("\\cref", "clever reference", "\\cref{${1}}"),
  cmd("\\cite", "citation", "\\cite{${1}}"),
  cmd("\\parencite", "parenthetical citation", "\\parencite{${1}}"),
  cmd("\\textcite", "textual citation", "\\textcite{${1}}"),
  cmd("\\footnote", "footnote", "\\footnote{${1}}"),
  cmd("\\usepackage", "use package", "\\usepackage{${1}}"),
  cmd("\\title", "title", "\\title{${1}}"),
  cmd("\\author", "author", "\\author{${1}}"),
  cmd("\\date", "date", "\\date{${1}}"),
  cmd("\\thanks", "author acknowledgement", "\\thanks{${1}}"),
  cmd("\\maketitle", "render title"),
  cmd("\\tableofcontents", "table of contents"),
  cmd("\\newpage", "page break"),
  cmd("\\clearpage", "flush floats and start page"),
  cmd("\\pagebreak", "request page break"),
  cmd("\\linebreak", "request line break"),
  cmd("\\hspace", "horizontal space", "\\hspace{${1}}"),
  cmd("\\vspace", "vertical space", "\\vspace{${1}}"),
  cmd("\\input", "include file", "\\input{${1}}"),
  cmd("\\include", "include file", "\\include{${1}}"),
  cmd("\\includegraphics", "image", "\\includegraphics[width=${1}\\textwidth]{${2}}"),
  cmd("\\caption", "float caption", "\\caption{${1}}"),
  cmd("\\centering", "center following content"),
  cmd("\\url", "URL", "\\url{${1}}"),
  cmd("\\href", "hyperlink", "\\href{${1}}{${2}}"),
  cmd("\\addbibresource", "bibliography resource", "\\addbibresource{${1}}"),
  cmd("\\bibliography", "bibliography database", "\\bibliography{${1}}"),
  cmd("\\printbibliography", "render bibliography"),
  cmd("\\frac", "fraction", "\\frac{${1}}{${2}}"),
  cmd("\\sqrt", "square root", "\\sqrt{${1}}"),
  cmd("\\overline", "overline", "\\overline{${1}}"),
  cmd("\\vec", "vector accent", "\\vec{${1}}"),
  cmd("\\hat", "hat accent", "\\hat{${1}}"),
  cmd("\\mathrm", "roman math text", "\\mathrm{${1}}"),
  cmd("\\mathbf", "bold math text", "\\mathbf{${1}}"),
  cmd("\\mathcal", "calligraphic math text", "\\mathcal{${1}}"),
  cmd("\\mathbb", "blackboard-bold math text", "\\mathbb{${1}}"),
  cmd("\\operatorname", "math operator name", "\\operatorname{${1}}"),
  cmd("\\sum", "summation"),
  cmd("\\prod", "product"),
  cmd("\\int", "integral"),
  cmd("\\lim", "limit"),
  cmd("\\itemize", "bulleted list", "\\begin{itemize}\n  \\item ${1}\n\\end{itemize}"),
  cmd("\\enumerate", "numbered list", "\\begin{enumerate}\n  \\item ${1}\n\\end{enumerate}"),
  cmd("\\equation", "display math", "\\begin{equation}\n  ${1}\n\\end{equation}"),
  cmd("\\align", "aligned math", "\\begin{align}\n  ${1}\n\\end{align}"),
];

// Package-aware additions keep completion useful even before an LSP is
// installed. The project language service can still contribute richer symbols
// when TexLab is available.
const PACKAGE_COMMANDS: Record<string, Completion[]> = {
  amsmath: [cmd("\\dfrac", "display fraction", "\\dfrac{${1}}{${2}}"), cmd("\\DeclareMathOperator", "math operator", "\\DeclareMathOperator{${1}}{${2}}")],
  amssymb: [cmd("\\mathbb", "blackboard-bold symbol")],
  graphicx: [cmd("\\rotatebox", "rotate graphic", "\\rotatebox{${1}}{${2}}")],
  hyperref: [cmd("\\hypersetup", "hyperlink setup", "\\hypersetup{${1}}")],
  booktabs: [cmd("\\toprule", "table top rule"), cmd("\\midrule", "table mid rule"), cmd("\\bottomrule", "table bottom rule")],
  siunitx: [cmd("\\SI", "quantity", "\\SI{${1}}{${2}}"), cmd("\\num", "number", "\\num{${1}}")],
};

function packageCompletions(state: { doc: { toString: () => string } }): Completion[] {
  const packages = new Set<string>();
  for (const match of state.doc.toString().matchAll(/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]+)\}/gu)) {
    for (const name of (match[1] ?? "").split(",")) packages.add(name.trim().toLowerCase());
  }
  return [...packages].flatMap((name) => PACKAGE_COMMANDS[name] ?? []);
}

export function latexCompletions(
  context: CompletionContext
): CompletionResult | null {
  const refMatch = context.matchBefore(
    /\\(?:ref|eqref|pageref|autoref|cref|Cref|cpageref|vref|Vref|labelcref|nameref|namecref|fref|sref|labelref)\*?\s*\{[^}]{0,500}$/u
  );
  if (refMatch) {
    const labels = labelsInDocument(context.state);
    return {
      from: refMatch.to,
      options: labels.map((l) => ({ label: l, type: "variable", detail: "label" })),
      validFor: /^[^}]*$/,
    };
  }

  const citeMatch = context.matchBefore(
    /\\(?:cite|citep|citet|citeauthor|citeyear|citealt|parencite|textcite|autocite|nocite)\*?\s*(?:\[[^\]]*\])?\s*\{[^}]{0,500}$/u
  );
  if (citeMatch) {
    return {
      from: citeMatch.to,
      options: bibKeysProvider().map((k) => ({
        label: k,
        type: "constant",
        detail: "citation",
      })),
      validFor: /^[^}]*$/,
    };
  }

  return commandCompletions(context, true);
}

function commandCompletions(
  context: CompletionContext,
  explicitFallback: boolean,
): CompletionResult | null {
  const cmdMatch = context.matchBefore(/\\[a-zA-Z@]*$/);
  if (!cmdMatch && !(explicitFallback && context.explicit)) return null;
  return {
    from: cmdMatch ? cmdMatch.from : context.pos,
    options: [...LATEX_COMMANDS, ...packageCompletions(context.state)],
    validFor: /\\[a-zA-Z@]*$/,
  };
}

export function latexCommandCompletions(
  context: CompletionContext,
): CompletionResult | null {
  return commandCompletions(context, false);
}

export function slashCompletions(
  context: CompletionContext
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = before.match(/\/([a-zA-Z]*)$/);
  if (!m) return null;
  const slash: Completion[] = [
    { label: "/section", type: "snippet", detail: "Section", apply: snippet("\\section{${1}}") },
    { label: "/subsection", type: "snippet", detail: "Subsection", apply: snippet("\\subsection{${1}}") },
    { label: "/itemize", type: "snippet", detail: "Bulleted list", apply: snippet("\\begin{itemize}\n  \\item ${1}\n\\end{itemize}") },
    { label: "/enumerate", type: "snippet", detail: "Numbered list", apply: snippet("\\begin{enumerate}\n  \\item ${1}\n\\end{enumerate}") },
    { label: "/equation", type: "snippet", detail: "Display equation", apply: snippet("\\begin{equation}\n  ${1}\n\\end{equation}") },
    { label: "/align", type: "snippet", detail: "Aligned equations", apply: snippet("\\begin{align}\n  ${1}\n\\end{align}") },
    { label: "/figure", type: "snippet", detail: "Figure float", apply: snippet("\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=${1}\\textwidth]{${2}}\n  \\caption{${3}}\n\\end{figure}") },
    { label: "/table", type: "snippet", detail: "Table float", apply: snippet("\\begin{table}[htbp]\n  \\centering\n  \\caption{${1}}\n  \\begin{tabular}{${2}}\n  \\end{tabular}\n\\end{table}") },
    { label: "/item", type: "snippet", detail: "List item", apply: snippet("\\item ${1}") },
    { label: "/frac", type: "snippet", detail: "Fraction", apply: snippet("\\frac{${1}}{${2}}") },
    { label: "/bold", type: "snippet", detail: "Bold", apply: snippet("\\textbf{${1}}") },
    { label: "/italic", type: "snippet", detail: "Italic", apply: snippet("\\textit{${1}}") },
    { label: "/label", type: "snippet", detail: "Label", apply: snippet("\\label{${1}}") },
    { label: "/usepackage", type: "snippet", detail: "Use package", apply: snippet("\\usepackage{${1}}") },
  ];
  return {
    from: context.pos - m[0].length,
    options: slash,
    validFor: /\/[a-zA-Z]*/,
  };
}
