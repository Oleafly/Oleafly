// language/completions, theme, folding, linters, spelling/grammar, search.
// The host app injects a document/settings port (EditorHost), the spelling
// stack (setSpellHost), citation keys (setBibKeysProvider), and feature
// extensions (extraExtensions/extraKeymap). No store, Tauri, or app imports.

// CodeMirrorEditor is deliberately NOT exported here: it wires up the live
// math preview, whose KaTeX dependency must not ride with consumers that only
// need the index (controller, commands). Import it via the
// "@oleafly/editor/CodeMirrorEditor" subpath instead.
export * from "./controller";
export * from "./messages";
export { editorTheme } from "./theme";
export { languageForPath } from "./languages";
export {
  createCompletionRequestGuard,
  completionRequestIsCurrent,
  type CompletionRequestGuard,
} from "./completion-request";
export {
  latexLanguage,
  latexMathLanguage,
  latexCompletions,
  latexCommandCompletions,
  latexReferenceCitationCompletions,
  slashCompletions,
  setBibKeysProvider,
  setLatexCorpusProvider,
  type LatexCorpusProvider,
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
export {
  closeEnvironmentOnEnter,
  environmentSnippet,
  openEnvironmentCompletion,
} from "./latex-environments";
export {
  inLatexIgnoredRegion,
  latexIgnoredRangesField,
  mathContextAt,
} from "./latex-lexical";
export {
  latexPairChange,
  latexPairInputHandler,
  latexPairKeymap,
  type LatexPairOptions,
} from "./latex-pairs";
export {
  continueListOnEnter,
  closeEnvironmentAtCursor,
  surroundSelectionWithEnvironment,
  latexListKeymap,
  latexStructureKeymap,
} from "./latex-structure-commands";
export { createLatexLinter, lintLatexText } from "./latex-linter";
export * from "./latex-mask";
// math-preview / math-render are deliberately NOT exported here: they import
// KaTeX (plus its CSS), which would ride in every chunk that touches this
// index. Import them via the "@oleafly/editor/math-preview" or
// "@oleafly/editor/math-render" subpaths instead. The math scanner below is
// KaTeX-free and safe to keep on the index.
export {
  scanMathExpressions,
  type MathDelimiter,
  type MathExpression,
  type MathExpressionStatus,
  type MathScanOptions,
  type MathSourceFormat,
} from "./math-source";
export { preserveCase } from "./preserve-case";
export { stickyScroll } from "./sticky-scroll";
export {
  STICKY_MAX_LINES,
  scopesAtLine,
  stickyScopes,
  type StickyScope,
} from "./sticky-structure";
export {
  PROOFREADING_LIMITS,
  PROOFREADING_PROTOCOL_VERSION,
  PROOFREADING_RENDER_LIMITS,
  createGrammarSuppressionKeyer,
  grammarSuppressionKey,
  guardProofreadingDiagnostics,
  isProofreadingWorkerResponse,
  isSpellingDiagnosticKind,
  proofreadingContextSentence,
  proofreadingSuppressionDigest,
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
  type GrammarSuppressionKeyer,
} from "./proofreading";
export { diagnosticCardSource } from "./diagnostic-card";
export { vscodeSearch } from "./search-panel";
export {
  diagnosticPresentationExtensions,
  spellLintExtensions,
  refreshEditorLints,
  refreshEditorProofreadingPresentation,
  clearEditorProofreadingDiagnostics,
  cancelSourceProofreading,
  createSpellLinter,
  createHarperLinter,
  setSpellHost,
  setProofreadingActionHost,
  type GrammarDiag,
  type GrammarSuggestion,
  type ProofreadingActionHost,
} from "./spellcheck";
export { isStandardLatexEnvironment } from "./latex";
