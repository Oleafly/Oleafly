import { stex } from "@codemirror/legacy-modes/mode/stex";
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

function labelsInDocument(state: { doc: { toString: () => string } }): string[] {
  const text = state.doc.toString();
  const out: string[] = [];
  const re = /\\label\{([^}]+)\}/g;
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
  cmd("\\textbf", "bold text", "\\textbf{$1}"),
  cmd("\\textit", "italic text", "\\textit{$1}"),
  cmd("\\emph", "emphasize", "\\emph{$1}"),
  cmd("\\underline", "underline", "\\underline{$1}"),
  cmd("\\section", "section", "\\section{$1}"),
  cmd("\\subsection", "subsection", "\\subsection{$1}"),
  cmd("\\subsubsection", "subsubsection", "\\subsubsection{$1}"),
  cmd("\\paragraph", "paragraph heading", "\\paragraph{$1}"),
  cmd("\\item", "list item", "\\item $1"),
  cmd("\\label", "label", "\\label{$1}"),
  cmd("\\ref", "reference", "\\ref{$1}"),
  cmd("\\eqref", "equation ref", "\\eqref{$1}"),
  cmd("\\cite", "citation", "\\cite{$1}"),
  cmd("\\footnote", "footnote", "\\footnote{$1}"),
  cmd("\\usepackage", "use package", "\\usepackage{$1}"),
  cmd("\\title", "title", "\\title{$1}"),
  cmd("\\author", "author", "\\author{$1}"),
  cmd("\\date", "date", "\\date{$1}"),
  cmd("\\maketitle", "render title"),
  cmd("\\tableofcontents", "table of contents"),
  cmd("\\newpage", "page break"),
  cmd("\\input", "include file", "\\input{$1}"),
  cmd("\\includegraphics", "image", "\\includegraphics[width=$1\\textwidth]{$2}"),
  cmd("\\frac", "fraction", "\\frac{$1}{$2}"),
  cmd("\\sqrt", "square root", "\\sqrt{$1}"),
  cmd("\\sum", "summation"),
  cmd("\\int", "integral"),
  cmd("\\itemize", "bulleted list", "\\begin{itemize}\n  \\item $1\n\\end{itemize}"),
  cmd("\\enumerate", "numbered list", "\\begin{enumerate}\n  \\item $1\n\\end{enumerate}"),
  cmd("\\equation", "display math", "\\begin{equation}\n  $1\n\\end{equation}"),
  cmd("\\align", "aligned math", "\\begin{align}\n  $1\n\\end{align}"),
];

export function latexCompletions(
  context: CompletionContext
): CompletionResult | null {
  const refMatch = context.matchBefore(
    /\\(ref|eqref|pageref|autoref|cref|Cref)\{[^}]*$/
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
    /\\(cite|citep|citet|citeauthor|citeyear|parencite|textcite)\{[^}]*$/
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

  const cmdMatch = context.matchBefore(/\\[a-zA-Z@]*$/);
  if (!cmdMatch && !context.explicit) return null;
  return {
    from: cmdMatch ? cmdMatch.from : context.pos,
    options: LATEX_COMMANDS,
    validFor: /\\[a-zA-Z@]*$/,
  };
}

export function slashCompletions(
  context: CompletionContext
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = before.match(/\/([a-zA-Z]*)$/);
  if (!m) return null;
  const slash: Completion[] = [
    { label: "/section", type: "snippet", detail: "Section", apply: snippet("\\section{$1}") },
    { label: "/subsection", type: "snippet", detail: "Subsection", apply: snippet("\\subsection{$1}") },
    { label: "/itemize", type: "snippet", detail: "Bulleted list", apply: snippet("\\begin{itemize}\n  \\item $1\n\\end{itemize}") },
    { label: "/enumerate", type: "snippet", detail: "Numbered list", apply: snippet("\\begin{enumerate}\n  \\item $1\n\\end{enumerate}") },
    { label: "/equation", type: "snippet", detail: "Display equation", apply: snippet("\\begin{equation}\n  $1\n\\end{equation}") },
    { label: "/align", type: "snippet", detail: "Aligned equations", apply: snippet("\\begin{align}\n  $1\n\\end{align}") },
    { label: "/figure", type: "snippet", detail: "Figure float", apply: snippet("\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=$1\\textwidth]{$2}\n  \\caption{$3}\n\\end{figure}") },
    { label: "/table", type: "snippet", detail: "Table float", apply: snippet("\\begin{table}[htbp]\n  \\centering\n  \\caption{$1}\n  \\begin{tabular}{$2}\n  \\end{tabular}\n\\end{table}") },
    { label: "/item", type: "snippet", detail: "List item", apply: snippet("\\item $1") },
    { label: "/frac", type: "snippet", detail: "Fraction", apply: snippet("\\frac{$1}{$2}") },
    { label: "/bold", type: "snippet", detail: "Bold", apply: snippet("\\textbf{$1}") },
    { label: "/italic", type: "snippet", detail: "Italic", apply: snippet("\\textit{$1}") },
    { label: "/label", type: "snippet", detail: "Label", apply: snippet("\\label{$1}") },
    { label: "/usepackage", type: "snippet", detail: "Use package", apply: snippet("\\usepackage{$1}") },
  ];
  return {
    from: context.pos - m[0].length,
    options: slash,
    validFor: /\/[a-zA-Z]*/,
  };
}
