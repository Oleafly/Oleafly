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
