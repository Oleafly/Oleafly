export type {
  DocumentParagraph,
  RankedLiteraturePaper,
} from "./types";
export {
  cleanLatex,
  extractKeywords,
  splitIntoParagraphs,
  type SplitParagraphOptions,
} from "./latex-paragraphs";
export {
  detectScanFormat,
  extractTypstKeywords,
  hayagrivaIdentityText,
  splitTypstParagraphs,
  type ScanFormat,
} from "./typst-paragraphs";
export {
  filterNewLiteratureRecords,
  isRecordInBibliography,
  normalizeTitleKey,
  parseBibliographyIdentities,
  type BibliographyIdentities,
} from "./bibliography-filter";
export {
  heuristicScore,
} from "./debate-ranker";
export {
  DEFAULT_DOCUMENT_CITATION_SETTINGS,
  loadDocumentCitationSettings,
  saveDocumentCitationSettings,
  type DocumentCitationSettings,
} from "./settings";
export {
  scanDocumentForCitations,
  type DocumentScanProgress,
  type DocumentScanResult,
  type ParagraphCitationResult,
} from "./document-scan";
export {
  clearDocumentScanCache,
  documentScanCacheKey,
  loadDocumentScanCache,
  saveDocumentScanCache,
} from "./scan-cache";
