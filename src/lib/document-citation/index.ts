export type {
  CompleteChatFn,
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
  filterNewLiteratureRecords,
  isRecordInBibliography,
  normalizeTitleKey,
  parseBibliographyIdentities,
  type BibliographyIdentities,
} from "./bibliography-filter";
export {
  heuristicScore,
  parseDebateResponse,
  rankLiteraturePapers,
} from "./debate-ranker";
export {
  DEFAULT_DOCUMENT_CITATION_SETTINGS,
  loadDocumentCitationSettings,
  saveDocumentCitationSettings,
  type DocumentCitationSettings,
} from "./settings";
export { completeChatWithActiveModel } from "./llm-complete";
export {
  scanDocumentForCitations,
  type DocumentScanProgress,
  type DocumentScanRankMode,
  type DocumentScanResult,
  type ParagraphCitationResult,
} from "./document-scan";
export {
  systemPromptForReview,
  userPromptForReview,
  type PaperReviewMode,
} from "./review-prompts";
export { runPaperReview } from "./review-paper";
