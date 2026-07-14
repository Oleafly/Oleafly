// @openleaf/editor — the CodeMirror LaTeX editing core: component, controller,
// language/completions, theme, folding, linters, spelling/grammar, search.
// The host app injects a document/settings port (EditorHost), the spelling
// stack (setSpellHost), citation keys (setBibKeysProvider), and feature
// extensions (extraExtensions/extraKeymap). No store, Tauri, or app imports.
export { CodeMirrorEditor, type EditorHost } from "./CodeMirrorEditor";
export * from "./controller";
export { editorTheme } from "./theme";
export { languageForPath } from "./languages";
export {
  latexLanguage,
  latexCompletions,
  slashCompletions,
  setBibKeysProvider,
  bibKeysFromSources,
} from "./latex";
export { latexFolding } from "./latex-folding";
export { createLatexLinter } from "./latex-linter";
export * from "./latex-mask";
export { mathHover } from "./math-preview";
export { preserveCase } from "./preserve-case";
export { vscodeSearch } from "./search-panel";
export {
  spellLintExtensions,
  refreshEditorLints,
  createSpellLinter,
  createHarperLinter,
  setSpellHost,
  type SpellHost,
  type GrammarDiag,
  type GrammarSuggestion,
} from "./spellcheck";
