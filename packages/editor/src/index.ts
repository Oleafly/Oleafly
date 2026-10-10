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
