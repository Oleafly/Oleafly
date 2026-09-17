import { insertEnvironment, insertTemplate, wrapSelectionOrPlaceholder } from "@/components/editor/cm/controller";
import { i18n } from "@/i18n";
import { latexGraphicsPath } from "@/components/editor/figure-import";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { useFilesStore } from "@/store/files";

const PLACEHOLDER_FIGURE_FILE = "image-filename";

export interface HeadingLevel {
  label: () => string;
  hLabel: string;
  cmd: string;
  placeholder: string;
  className: string;
}

export const HEADING_LEVELS: HeadingLevel[] = [
  { label: () => i18n.t(($) => $.editor.headings.part), hLabel: "H1", cmd: "part", placeholder: "Part Title", className: "text-base font-bold" },
  { label: () => i18n.t(($) => $.editor.headings.chapter), hLabel: "H2", cmd: "chapter", placeholder: "Chapter Title", className: "text-base font-bold" },
  { label: () => i18n.t(($) => $.editor.headings.section), hLabel: "H3", cmd: "section", placeholder: "Section Title", className: "text-sm font-bold" },
  {
    label: () => i18n.t(($) => $.editor.headings.subsection),
    hLabel: "H4",
    cmd: "subsection",
    placeholder: "Subsection Title",
    className: "text-sm font-semibold",
  },
  {
    label: () => i18n.t(($) => $.editor.headings.subsubsection),
    hLabel: "H5",
    cmd: "subsubsection",
    placeholder: "Subsubsection Title",
    className: "text-xs font-semibold",
  },
  {
    label: () => i18n.t(($) => $.editor.headings.paragraph),
    hLabel: "H6",
    cmd: "paragraph",
    placeholder: "Paragraph Title",
    className: "text-xs font-medium",
  },
  {
    label: () => i18n.t(($) => $.editor.headings.subparagraph),
    hLabel: "H7",
    cmd: "subparagraph",
    placeholder: "Subparagraph Title",
    className: "text-xs font-medium",
  },
];

export function insertHeading(level: HeadingLevel) {
  wrapSelectionOrPlaceholder(`\\${level.cmd}{`, "}\n", level.placeholder);
}

export function insertBold() {
  wrapSelectionOrPlaceholder(String.raw`\textbf{`, "}", "text");
}
export function insertItalic() {
  wrapSelectionOrPlaceholder(String.raw`\textit{`, "}", "text");
}
export function insertUnderline() {
  wrapSelectionOrPlaceholder(String.raw`\underline{`, "}", "text");
}
export function insertCode() {
  wrapSelectionOrPlaceholder(String.raw`\texttt{`, "}", "text");
}
export function insertFootnote() {
  wrapSelectionOrPlaceholder(String.raw`\footnote{`, "}", "note text");
}
export function insertRef() {
  wrapSelectionOrPlaceholder(String.raw`\ref{`, "}", "label");
}
export function insertLabel() {
  wrapSelectionOrPlaceholder(String.raw`\label{`, "}", "label");
}

export function insertLink() {
  const template = String.raw`\href{url}{link text}`;
  const start = String.raw`\href{`.length;
  insertTemplate(template, start, start + "url".length);
}

export function insertFraction() {
  const template = String.raw`\frac{numerator}{denominator}`;
  const start = String.raw`\frac{`.length;
  insertTemplate(template, start, start + "numerator".length);
}

export interface FigureSnippetOptions {
  path: string;
  width?: string | null;
  caption?: string | null;
  label?: string | null;
  placement?: string;
}

export interface FigureSnippet {
  template: string;
  selStart: number;
  selEnd: number;
}

export function figureSnippet(options: FigureSnippetOptions): FigureSnippet {
  const width = options.width ? `[width=${options.width}]` : "";
  const lines = [
    String.raw`\begin{figure}[${options.placement ?? "htbp"}]`,
    String.raw`  \centering`,
    String.raw`  \includegraphics${width}{${options.path}}`,
  ];
  if (typeof options.caption === "string") lines.push(String.raw`  \caption{${options.caption}}`);
  if (options.label) lines.push(String.raw`  \label{${options.label}}`);
  lines.push(String.raw`\end{figure}`, "");
  const template = lines.join("\n");
  const captionIndex = template.indexOf(String.raw`\caption{`);
  if (captionIndex < 0) return { template, selStart: template.length, selEnd: template.length };
  const selStart = captionIndex + String.raw`\caption{`.length;
  return { template, selStart, selEnd: selStart + (options.caption ?? "").length };
}

export function insertFigurePlaceholder() {
  const template = `\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{${PLACEHOLDER_FIGURE_FILE}}\n  \\caption{Caption text}\n  \\label{fig:label}\n\\end{figure}\n`;
  const start = template.indexOf(PLACEHOLDER_FIGURE_FILE);
  insertTemplate(template, start, start + PLACEHOLDER_FIGURE_FILE.length);
}

export function insertFigure() {
  useFigureDialogStore.getState().setOpen(true);
}

export interface FigureInsertOptions {
  path: string;
  width: string | null;
  caption: string | null;
  label: string | null;
}

export function insertFigureFromDialog(options: FigureInsertOptions) {
  const path = latexGraphicsPath(options.path, useFilesStore.getState().mainDoc);
  const snippet = figureSnippet({ path, width: options.width, caption: options.caption, label: options.label });
  insertTemplate(snippet.template, snippet.selStart, snippet.selEnd);
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
  const cursor = template.indexOf(String.raw`\item `) + String.raw`\item `.length;
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
  const cursor = template.indexOf(String.raw`\caption{}`) + String.raw`\caption{`.length;
  insertTemplate(template, cursor, cursor);
}
