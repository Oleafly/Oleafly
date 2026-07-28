// language/completions, theme, folding, linters, spelling/grammar, search.
// The host app injects a document/settings port (EditorHost), the spelling
// stack (setSpellHost), citation keys (setBibKeysProvider), and feature
// extensions (extraExtensions/extraKeymap). No store, Tauri, or app imports.

export { CodeMirrorEditor, isLatexSourcePath, type EditorHost } from "./CodeMirrorEditor";
export * from "./controller";
export { editorTheme } from "./theme";
export { languageForPath } from "./languages";
export {
  latexLanguage,
  latexMathLanguage,
  latexCompletions,
  latexCommandCompletions,
  slashCompletions,
  setBibKeysProvider,
  bibKeysFromSources,
} from "./latex";
export { bibtexLanguage } from "./bibtex";
export {
  maskTypstToProse,
  typstSpellcheckRanges,
  typstToProse,
  type TypstWordRange,
} from "./typst-mask";
export { latexFolding } from "./latex-folding";
export { createLatexLinter, lintLatexText } from "./latex-linter";
export * from "./latex-mask";
export {
  liveMathPreview,
  mathHover,
  mountMathPreview,
  renderMathExpression,
  scanMathExpressions,
  type MathDelimiter,
  type MathExpression,
  type MathExpressionStatus,
  type MathScanOptions,
  type MathRenderResult,
  type MathSourceFormat,
  type MountedMathPreview,
  type MountMathPreviewOptions,
} from "./math-preview";
export { preserveCase } from "./preserve-case";
export {
  PROOFREADING_LIMITS,
  PROOFREADING_PROTOCOL_VERSION,
  isProofreadingWorkerResponse,
  sameProofreadingIdentity,
  type ProofreadingDiagnostic,
  type ProofreadingDialect,
  type ProofreadingError,
  type ProofreadingFormat,
  type ProofreadingIdentity,
  type ProofreadingInput,
  type ProofreadingMode,
  type ProofreadingRequest,
  type ProofreadingResult,
  type ProofreadingResultStatus,
  type ProofreadingSuggestion,
  type ProofreadingSurface,
  type ProofreadingWorkerRequest,
  type ProofreadingWorkerResponse,
} from "./proofreading";
export { vscodeSearch } from "./search-panel";
export {
  spellLintExtensions,
  refreshEditorLints,
  cancelSourceProofreading,
  createSpellLinter,
  createHarperLinter,
  setSpellHost,
  type SpellHost,
  type GrammarDiag,
  type GrammarSuggestion,
} from "./spellcheck";
