import { insertEnvironment, insertTemplate, wrapSelectionOrPlaceholder } from "@/components/editor/cm/controller";
import { i18n } from "@/i18n";
import { getWysiwygEditor, isWysiwygActive } from "@/components/editor/wysiwyg/controller";

const NATIVE_HEADING_LEVEL: Record<string, 1 | 2 | 3> = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
};

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
];

export function insertHeading(level: HeadingLevel) {
  const nativeLevel = NATIVE_HEADING_LEVEL[level.cmd];
  if (nativeLevel && isWysiwygActive()) {
    const editor = getWysiwygEditor();
    if (editor) {
      editor.chain().focus().toggleHeading({ level: nativeLevel }).run();
      return;
    }
  }
  wrapSelectionOrPlaceholder(`\\${level.cmd}{`, "}\n", level.placeholder);
}

export function insertBold() {
  if (isWysiwygActive()) {
    const editor = getWysiwygEditor();
    if (editor) {
      editor.chain().focus().toggleBold().run();
      return;
    }
  }
  wrapSelectionOrPlaceholder(String.raw`\textbf{`, "}", "text");
}
export function insertItalic() {
  if (isWysiwygActive()) {
    const editor = getWysiwygEditor();
    if (editor) {
      editor.chain().focus().toggleItalic().run();
      return;
    }
  }
  wrapSelectionOrPlaceholder(String.raw`\textit{`, "}", "text");
}
export function insertUnderline() {
  wrapSelectionOrPlaceholder(String.raw`\underline{`, "}", "text");
}
export function insertCode() {
  if (isWysiwygActive()) {
    const editor = getWysiwygEditor();
    if (editor) {
      editor.chain().focus().toggleCode().run();
      return;
    }
  }
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
  if (isWysiwygActive()) {
    const editor = getWysiwygEditor();
    if (editor) {
      editor.chain().focus().toggleBlockquote().run();
      return;
    }
  }
  insertEnvironment("quote");
}
function insertFirstItem(template: string): void {
  const cursor = template.indexOf(String.raw`\item `) + String.raw`\item `.length;
  insertTemplate(template, cursor, cursor);
}
export function insertItemize() {
  if (isWysiwygActive()) {
    const editor = getWysiwygEditor();
    if (editor) {
      editor.chain().focus().toggleBulletList().run();
      return;
    }
  }
  insertFirstItem("\\begin{itemize}\n  \\item \n\\end{itemize}\n");
}
export function insertEnumerate() {
  if (isWysiwygActive()) {
    const editor = getWysiwygEditor();
    if (editor) {
      editor.chain().focus().toggleOrderedList().run();
      return;
    }
  }
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
