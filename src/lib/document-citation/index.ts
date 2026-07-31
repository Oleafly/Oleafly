export type { DocumentParagraph } from "./types";
export {
  cleanLatex,
  extractKeywords,
  splitIntoParagraphs,
  type SplitParagraphOptions,
} from "./latex-paragraphs";
export {
  filterNewLiteratureRecords,
  isRecordInBibliography,
  normalizeTitleKey,
  parseBibliographyIdentities,
  type BibliographyIdentities,
} from "./bibliography-filter";
