import {
  insertTemplate,
  wrapSelectionOrPlaceholder,
} from "@/components/editor/cm/controller";

export interface TypstHeadingLevel {
  label: string;
  hLabel: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  placeholder: string;
  className: string;
}

export const TYPST_HEADING_LEVELS: TypstHeadingLevel[] = [
  { label: "Title", hLabel: "H1", level: 1, placeholder: "Title", className: "text-base font-bold" },
  { label: "Section", hLabel: "H2", level: 2, placeholder: "Section", className: "text-base font-bold" },
  { label: "Subsection", hLabel: "H3", level: 3, placeholder: "Subsection", className: "text-sm font-bold" },
  { label: "Subsubsection", hLabel: "H4", level: 4, placeholder: "Subsubsection", className: "text-sm font-semibold" },
  { label: "Minor heading", hLabel: "H5", level: 5, placeholder: "Minor heading", className: "text-xs font-semibold" },
  { label: "Paragraph heading", hLabel: "H6", level: 6, placeholder: "Paragraph heading", className: "text-xs font-medium" },
];

export function insertTypstHeading(level: TypstHeadingLevel) {
  wrapSelectionOrPlaceholder(`${"=".repeat(level.level)} `, "\n", level.placeholder);
}

export function insertTypstBold() {
  wrapSelectionOrPlaceholder("*", "*", "text");
}

export function insertTypstItalic() {
  wrapSelectionOrPlaceholder("_", "_", "text");
}

export function insertTypstUnderline() {
  wrapSelectionOrPlaceholder("#underline[", "]", "text");
}

export function insertTypstStrikethrough() {
  wrapSelectionOrPlaceholder("#strike[", "]", "text");
}

export function insertTypstRawInline() {
  wrapSelectionOrPlaceholder("`", "`", "code");
}

export function insertTypstMath() {
  wrapSelectionOrPlaceholder("$", "$", "x");
}

export function insertTypstBulletList() {
  wrapSelectionOrPlaceholder("- ", "\n", "Item");
}

export function insertTypstNumberedList() {
  wrapSelectionOrPlaceholder("+ ", "\n", "Item");
}

export function insertTypstReference() {
  wrapSelectionOrPlaceholder("@", "", "label");
}

export function insertTypstLink() {
  const template = '#link("url")[text]';
  const start = template.indexOf("url");
  insertTemplate(template, start, start + "url".length);
}

export function insertTypstImage() {
  const template = '#image("image-filename")';
  const start = template.indexOf("image-filename");
  insertTemplate(template, start, start + "image-filename".length);
}

export function insertTypstCodeBlock() {
  wrapSelectionOrPlaceholder("```\n", "\n```\n", "code");
}
