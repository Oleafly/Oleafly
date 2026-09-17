export const WYSIWYG_MESSAGE_KEYS = [
  "block.abstract",
  "block.author",
  "block.bibliography",
  "block.bibliographyStyle",
  "block.date",
  "block.figure",
  "block.keywords",
  "block.documentTitle",
  "block.table",
  "block.title",
  "block.comment",
  "block.environment",
  "block.command",
  "block.latexSource",
  "block.maketitlePreview",
  "block.figurePreserved",
  "block.tablePreserved",
  "block.sourcePreserved",
  "block.editSource",
  "block.summaryLabel",
  "block.inputLabel",
  "inline.label",
  "inline.mathTitle",
  "inline.edit",
  "inline.editTitle",
  "inline.editLabel",
  "inline.inputLabel",
  "math.inlineLabel",
  "math.displayLabel",
  "math.inputLabel",
  "math.previewLabel",
  "math.renderFailed",
  "footnote.label",
  "footnote.marker",
  "footnote.inputLabel",
  "theorem.titleLabel",
  "theorem.titlePlaceholder",
  "theorem.editTitle",
  "theorem.name.theorem",
  "theorem.name.lemma",
  "theorem.name.corollary",
  "theorem.name.proposition",
  "theorem.name.definition",
  "theorem.name.remark",
  "theorem.name.example",
  "theorem.name.proof",
  "theorem.name.conjecture",
  "theorem.name.claim",
  "theorem.name.axiom",
  "theorem.name.notation",
  "figure.imageUnavailable",
  "figure.imageLoading",
  "figure.imageAlt",
  "figure.width",
  "figure.widthNatural",
  "figure.widthQuarter",
  "figure.widthHalf",
  "figure.widthThreeQuarters",
  "figure.widthFull",
  "figure.widthCustom",
  "figure.labelField",
  "figure.labelPlaceholder",
  "figure.addCaption",
  "figure.captionPlaceholder",
  "table.labelField",
  "table.labelPlaceholder",
  "table.addCaption",
  "table.captionPlaceholder",
] as const;

export type WysiwygMessageKey = (typeof WYSIWYG_MESSAGE_KEYS)[number];

export type WysiwygTranslator = (
  key: WysiwygMessageKey,
  params?: Record<string, string | number>,
) => string;

const echoKey: WysiwygTranslator = (key) => key;

let installed: WysiwygTranslator = echoKey;

export function setWysiwygTranslator(next: WysiwygTranslator | null): void {
  installed = next ?? echoKey;
}

export function wysiwygMessage(
  key: WysiwygMessageKey,
  params?: Record<string, string | number>,
): string {
  return installed(key, params);
}
