export * from "./controller";
export * from "./messages";
export { setEditorErrorReporter, type EditorErrorReporter } from "./error-report";
export { editorTheme } from "./theme";
export { EDITOR_CURSOR_BLINKING, type EditorCursorBlinking } from "./cursor-blink";
export { EDITOR_CURSOR_HEIGHTS, type EditorCursorHeight } from "./cursor-height";
export {
  EDITOR_COLOR_IDS,
  SURFACE_COLORS,
  SYNTAX_ROLES,
  editorColor,
  editorColorVariable,
  resolvedEditorColor,
  themeColorValue,
  type EditorColorId,
  type SurfaceColor,
  type SyntaxRole,
} from "./color-roles";
export { syntaxTags } from "./syntax-colors";
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
  guardCompletionForSource,
} from "./latex";
export { bibtexLanguage } from "./bibtex";
export * from "./prose";
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
export { latexSnippetLiteral } from "./latex-delimiters";
export {
  latexPairChange,
  latexPairInputHandler,
  latexPairKeymap,
  type LatexPairOptions,
} from "./latex-pairs";
export {
  gateCompletionSource,
  shouldRunCompletionSource,
  type CompletionSyntax,
} from "./completion-trigger";
export {
  typstContextAt,
  typstContextInText,
  typstEditing,
  typstInputChange,
  type TypstContext,
  type TypstEditingOptions,
} from "./typst-editing";
export {
  TYPST_SNIPPETS,
  typstSlashCompletions,
  type TypstSnippet,
} from "./typst-snippets";
export {
  continueListOnEnter,
  closeEnvironmentAtCursor,
  surroundSelectionWithEnvironment,
  latexListKeymap,
  latexStructureKeymap,
} from "./latex-structure-commands";
export { createLatexLinter, lintLatexText } from "./latex-linter";
export { createBibtexLinter, lintBibtexText } from "./bibtex-linter";
export {
  bibtexCompletions,
  bibtexEntryCompletions,
  bibtexFieldCompletions,
} from "./bibtex-completions";
export {
  BIBLIOGRAPHY_STYLES,
  bibliographyStyles,
  setBibStyleProvider,
  setTypstCslStyleProvider,
  setTypstStyleVersionProvider,
  typstBibliographyStyles,
  typstStyleArgumentAt,
  type BibliographyStyle,
  type BibliographyStyleFamily,
  type TypstBibliographyStyle,
  type TypstStyleUsage,
} from "./bibliography-styles";
export { typstBibliographyStyleCompletions } from "./typst-bibliography-style-completions";
export {
  typstBibliographyParameterCompletions,
  typstSupportsMultipleBibliographies,
} from "./typst-bibliography-parameters";
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
export {
  EDITOR_COMMANDS,
  EDITOR_COMMAND_IDS,
  deleteLineCommand,
  duplicateSelection,
  editorCommandKeymap,
  lowercaseSelection,
  titleCaseSelection,
  uppercaseSelection,
  type EditorCommandId,
} from "./editor-commands";
