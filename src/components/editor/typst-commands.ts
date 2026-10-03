import { toggleComment } from "@codemirror/commands";
import { typstContextAt } from "@oleafly/editor";
import {
  getEditorView,
  insertTemplate,
  wrapSelectionOrPlaceholder,
} from "@/components/editor/cm/controller";
import { i18n } from "@/i18n";
import { currentInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import type { LanguageServiceFeature } from "@/lib/language-service";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { useFilesStore } from "@/store/files";

export interface TypstHeadingLevel {
  label: () => string;
  hLabel: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  placeholder: string;
  className: string;
}

export const TYPST_HEADING_LEVELS: TypstHeadingLevel[] = [
  { label: () => i18n.t(($) => $.editor.headings.title), hLabel: "H1", level: 1, placeholder: "Title", className: "text-base font-bold" },
  { label: () => i18n.t(($) => $.editor.headings.section), hLabel: "H2", level: 2, placeholder: "Section", className: "text-base font-bold" },
  { label: () => i18n.t(($) => $.editor.headings.subsection), hLabel: "H3", level: 3, placeholder: "Subsection", className: "text-sm font-bold" },
  { label: () => i18n.t(($) => $.editor.headings.subsubsection), hLabel: "H4", level: 4, placeholder: "Subsubsection", className: "text-sm font-semibold" },
  { label: () => i18n.t(($) => $.editor.headings.minor), hLabel: "H5", level: 5, placeholder: "Minor heading", className: "text-xs font-semibold" },
  { label: () => i18n.t(($) => $.editor.headings.paragraphHeading), hLabel: "H6", level: 6, placeholder: "Paragraph heading", className: "text-xs font-medium" },
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

export function insertTypstFootnote() {
  wrapSelectionOrPlaceholder("#footnote[", "]", "note text");
}

export function insertTypstQuote() {
  wrapSelectionOrPlaceholder("#quote(block: true)[", "]", "quote");
}

export function insertTypstDisplayMath() {
  wrapSelectionOrPlaceholder("$ ", " $", "x");
}

export function insertTypstAlignedMath() {
  wrapSelectionOrPlaceholder("$ ", " $", String.raw`a &= b \ c &= d`);
}

export function insertTypstFraction() {
  const view = getEditorView();
  if (!view) return;
  const selection = view.state.selection.main;
  const numerator = selection.empty ? "a" : view.state.sliceDoc(selection.from, selection.to);
  const inMath = typstContextAt(view.state, selection.from) === "math";
  const before = view.state.sliceDoc(Math.max(0, selection.from - 1), selection.from);
  const lead = inMath && /\p{ID_Continue}$/u.test(before) ? " " : "";
  const call = `frac(${numerator}, b)`;
  const template = inMath ? `${lead}${call}` : `$${call}$`;
  const callStart = template.indexOf(call);
  const start = callStart + (selection.empty ? "frac(".length : `frac(${numerator}, `.length);
  insertTemplate(template, start, start + 1);
}

export function toggleTypstComment() {
  const view = getEditorView();
  if (!view) return;
  toggleComment(view);
  view.focus();
}

const typstInsertions = () => import("@/components/editor/typst-insertions");
const typstFigures = () => import("@/components/editor/typst-figure");

export async function insertTypstNumberedEquation(): Promise<void> {
  (await typstInsertions()).insertTypstNumberedEquation();
}

export async function addTypstLabel(): Promise<void> {
  (await typstInsertions()).addTypstLabel();
}

export async function insertTypstTable(rows: number, cols: number): Promise<void> {
  (await typstInsertions()).insertTypstTableAt(rows, cols);
}

export async function insertTypstReferenceTo(label: string): Promise<void> {
  (await typstInsertions()).insertTypstReferenceTo(label);
}

export async function insertTypstCitation(key: string, bibliography: string | null): Promise<void> {
  await (await typstInsertions()).insertTypstCitation(key, bibliography);
}

export async function insertTypstSymbol(latex: string, glyph: string): Promise<void> {
  (await typstInsertions()).insertTypstSymbolFor(latex, glyph);
}

export async function insertTypstFigure(): Promise<void> {
  const view = getEditorView();
  if (view) {
    const { typstFigureAt } = await typstFigures();
    const match = typstFigureAt(view.state.doc.toString(), view.state.selection.main.head);
    if (match?.fields) {
      useFigureDialogStore.getState().openForEdit({
        from: match.from,
        to: match.to,
        path: match.fields.path,
        width: match.fields.width,
        typst: match.fields,
      });
      return;
    }
  }
  useFigureDialogStore.getState().setOpen(true);
}

export function typstLanguageServiceOffers(feature: LanguageServiceFeature): boolean {
  const files = useFilesStore.getState();
  const path = files.activePath;
  const session = currentInteractiveLanguageService();
  return Boolean(
    path &&
      /\.typ$/iu.test(path) &&
      session &&
      session.projectId === files.projectId &&
      session.client.supports(feature) &&
      session.documentForPath(path),
  );
}
