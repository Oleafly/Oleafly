import { insertEnvironment, insertTemplate, wrapSelectionOrPlaceholder } from "@/components/editor/cm/controller";

export interface HeadingLevel {
  label: string;
  hLabel: string;
  cmd: string;
  placeholder: string;
  className: string;
}

export const HEADING_LEVELS: HeadingLevel[] = [
  { label: "Part", hLabel: "H1", cmd: "part", placeholder: "Part Title", className: "text-base font-bold" },
  { label: "Chapter", hLabel: "H2", cmd: "chapter", placeholder: "Chapter Title", className: "text-base font-bold" },
  { label: "Section", hLabel: "H3", cmd: "section", placeholder: "Section Title", className: "text-sm font-bold" },
  {
    label: "Subsection",
    hLabel: "H4",
    cmd: "subsection",
    placeholder: "Subsection Title",
    className: "text-sm font-semibold",
  },
  {
    label: "Subsubsection",
    hLabel: "H5",
    cmd: "subsubsection",
    placeholder: "Subsubsection Title",
    className: "text-xs font-semibold",
  },
  {
    label: "Paragraph",
    hLabel: "H6",
    cmd: "paragraph",
    placeholder: "Paragraph Title",
    className: "text-xs font-medium",
  },
];

export function insertHeading(level: HeadingLevel) {
  wrapSelectionOrPlaceholder(`\\${level.cmd}{`, "}\n", level.placeholder);
}

export function insertBold() {
  wrapSelectionOrPlaceholder("\\textbf{", "}", "text");
}
export function insertItalic() {
  wrapSelectionOrPlaceholder("\\textit{", "}", "text");
}
export function insertUnderline() {
  wrapSelectionOrPlaceholder("\\underline{", "}", "text");
}
export function insertCode() {
  wrapSelectionOrPlaceholder("\\texttt{", "}", "text");
}
export function insertFootnote() {
  wrapSelectionOrPlaceholder("\\footnote{", "}", "note text");
}
export function insertRef() {
  wrapSelectionOrPlaceholder("\\ref{", "}", "label");
}
export function insertLabel() {
  wrapSelectionOrPlaceholder("\\label{", "}", "label");
}

export function insertLink() {
  const template = "\\href{url}{link text}";
  const start = "\\href{".length;
  insertTemplate(template, start, start + "url".length);
}

export function insertFraction() {
  const template = "\\frac{numerator}{denominator}";
  const start = "\\frac{".length;
  insertTemplate(template, start, start + "numerator".length);
}

export function insertFigure() {
  const filename = "image-filename";
  const template = `\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{${filename}}\n  \\caption{Caption text}\n  \\label{fig:label}\n\\end{figure}\n`;
  const start = template.indexOf(filename);
  insertTemplate(template, start, start + filename.length);
}

export function insertAlign() {
  insertEnvironment("align");
}
export function insertEquation() {
  insertEnvironment("equation");
}
export function insertBlockquote() {
  insertEnvironment("quote");
}
function insertFirstItem(template: string): void {
  const cursor = template.indexOf("\\item ") + "\\item ".length;
  insertTemplate(template, cursor, cursor);
}
export function insertItemize() {
  insertFirstItem("\\begin{itemize}\n  \\item \n\\end{itemize}\n");
}
export function insertEnumerate() {
  insertFirstItem("\\begin{enumerate}\n  \\item \n\\end{enumerate}\n");
}

export function insertTable(rows: number, cols: number) {
  const cells = Array.from({ length: Math.max(1, cols) }, () => " ").join(" & ");
  const body = Array.from({ length: Math.max(1, rows) }, () => `    ${cells} \\\\`).join("\n");
  const colsSpec = Array.from({ length: Math.max(1, cols) }, () => "l").join("");
  const template = `\\begin{table}[htbp]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{${colsSpec}}\n${body}\n  \\end{tabular}\n\\end{table}\n`;
  const cursor = template.indexOf("\\caption{}") + "\\caption{".length;
  insertTemplate(template, cursor, cursor);
}
