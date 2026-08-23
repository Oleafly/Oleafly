import { create } from "zustand";

const SETTINGS_SECTIONS = new Set([
  "general",
  "appearance",
  "dictionary",
  "data",
  "ai",
  "engine",
  "downloads",
  "integrations",
  "shortcuts",
  "mcp",
  "experimentation",
  "help",
]);

export type ViewMode = "split" | "editor" | "pdf";
export type LayoutPreset =
  | "editor-preview-ai"
  | "editor-preview"
  | "editor-ai"
  | "preview-ai"
  | "editor-only"
  | "preview-only"
  | "ai-only";

export function layoutPresetViewMode(preset: LayoutPreset): ViewMode {
  if (preset === "editor-preview-ai" || preset === "editor-preview") return "split";
  if (preset === "editor-ai" || preset === "editor-only" || preset === "ai-only") return "editor";
  return "pdf";
}

export function layoutPresetWantsAi(preset: LayoutPreset): boolean {
  return (
    preset === "editor-preview-ai" ||
    preset === "editor-ai" ||
    preset === "preview-ai" ||
    preset === "ai-only"
  );
}

export type RailTab =
  | "files"
  | "search"
  | "ai"
  | "source"
  | "review"
  | "chat"
  | "preflight"
  | "refs"
  | "mcp";

export type DockPlacement = "left" | "right" | "bottom";
export type BackgroundPattern = "dots" | "grid" | "none";
export type GrammarDialect =
  | "american"
  | "british"
  | "australian"
  | "canadian"
  | "indian";
export type DictionaryLocale = "en_US" | "en_GB" | "en_AU" | "de_DE" | "fr_FR";
export const DICTIONARY_LOCALES: { id: DictionaryLocale; name: string }[] = [
  { id: "en_US", name: "English (US)" },
  { id: "en_GB", name: "English (UK)" },
  { id: "en_AU", name: "English (Australia)" },
  { id: "de_DE", name: "Deutsch" },
  { id: "fr_FR", name: "Français" },
];
export type EditorThemeId =
  | "system"
  | "linear"
  | "github-dark"
  | "dracula"
  | "nord"
  | "tokyo-night"
  | "rose-pine"
  | "catppuccin"
  | "one-dark";

function ls(k: string, fb: string): string {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(k) ?? fb
      : fb;
  } catch {
    return fb;
  }
}

const LAYOUT_PRESETS: LayoutPreset[] = [
  "editor-preview-ai",
  "editor-preview",
  "editor-ai",
  "preview-ai",
  "editor-only",
  "preview-only",
];
const LEGACY_VIEW_MODE_TO_PRESET: Record<string, LayoutPreset> = {
  split: "editor-preview",
  editor: "editor-only",
  pdf: "preview-only",
};

function readDefaultView(raw: string): LayoutPreset {
  if ((LAYOUT_PRESETS as string[]).includes(raw)) return raw as LayoutPreset;
  return LEGACY_VIEW_MODE_TO_PRESET[raw] ?? "editor-preview";
}
function readEditorTheme(raw: string): EditorThemeId {
  return EDITOR_THEMES.some((t) => t.id === raw) ? (raw as EditorThemeId) : "system";
}
const GRAMMAR_DIALECT_IDS: GrammarDialect[] = [
  "american",
  "british",
  "australian",
  "canadian",
  "indian",
];
function readGrammarDialect(raw: string): GrammarDialect {
  return GRAMMAR_DIALECT_IDS.includes(raw as GrammarDialect)
    ? (raw as GrammarDialect)
    : "american";
}
function saveLs(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
function notifyProofreadingSettingsChanged(
  setting: string,
  settings: { spellcheck: boolean; harper: boolean },
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("oleafly:proofreading-settings-changed", {
      detail: {
        setting,
        spellcheck: settings.spellcheck,
        harper: settings.harper,
      },
    }),
  );
}

// Font choices offered in Appearance. "" means the app default stack. Names
// apply if installed, otherwise the browser falls back (like VS Code).
export const APP_FONTS: { name: string; value: string }[] = [
  { name: "System default", value: "" },
  { name: "Inter", value: '"Inter", system-ui, sans-serif' },
  { name: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { name: "Segoe UI", value: '"Segoe UI", system-ui, sans-serif' },
  { name: "Georgia (serif)", value: 'Georgia, "Times New Roman", serif' },
];
export const EDITOR_FONTS: { name: string; value: string }[] = [
  { name: "System default", value: "" },
  { name: "JetBrains Mono", value: '"JetBrains Mono", ui-monospace, monospace' },
  { name: "Fira Code", value: '"Fira Code", ui-monospace, monospace' },
  { name: "Cascadia Code", value: '"Cascadia Code", ui-monospace, monospace' },
  { name: "SF Mono", value: '"SF Mono", ui-monospace, monospace' },
  { name: "Menlo", value: "Menlo, Monaco, monospace" },
  { name: "Consolas", value: "Consolas, ui-monospace, monospace" },
];

// Syntax/surface colors for each id are defined in globals.css under
// `[data-editor-theme="..."]`; "system" applies no override and follows
// the app's own light/dark mode.
export const EDITOR_THEMES: { id: EditorThemeId; name: string }[] = [
  { id: "system", name: "Match app theme" },
  { id: "linear", name: "Linear" },
  { id: "github-dark", name: "GitHub Dark" },
  { id: "dracula", name: "Dracula" },
  { id: "nord", name: "Nord" },
  { id: "tokyo-night", name: "Tokyo Night" },
  { id: "rose-pine", name: "Rosé Pine" },
  { id: "catppuccin", name: "Catppuccin" },
  { id: "one-dark", name: "One Dark" },
];

export const ACCENTS: { id: string; name: string; color: string }[] = [
  { id: "blue", name: "Blue", color: "#2563eb" },
  { id: "green", name: "Green", color: "#0b8842" },
  { id: "purple", name: "Purple", color: "#7c3aed" },
  { id: "rose", name: "Rose", color: "#db2777" },
  { id: "orange", name: "Orange", color: "#ea580c" },
  { id: "teal", name: "Teal", color: "#0d9488" },
];

export const DEFAULT_HIDDEN_FILE_PATTERNS = [
  "*.aux",
  "*.log",
  "*.toc",
  "*.out",
  "*.fls",
  "*.fdb_latexmk",
  "*.synctex.gz",
  "*.gz",
  "*.dvi",
  "*.lof",
  "*.lot",
  "*.bit",
  "*.idx",
  "*.glo",
  "*.bbl",
  "*.blg",
  "*.ilg",
  "*.ind",
  "*.glg",
  "*.gls",
  "*.acr",
  "*.alg",
  "*.xdy",
  "*.xdv",
  "*.bak",
  "*.sav",
  "*.tmp",
  "*~",
  "*.swp",
  "*.swo",
  "*.snm",
  "*.nav",
  "*.vrb",
  "*.bcf",
  "*.run.xml",
  "*.spl",
  ".git",
  ".DS_Store",
  ".gitignore",
  "node_modules",
  ".next",
] as const;

function readHiddenFilePatterns(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_HIDDEN_FILE_PATTERNS];
    return [
      ...new Set(
        parsed
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [...DEFAULT_HIDDEN_FILE_PATTERNS];
  }
}

function filePatternRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/gu, ".*").replace(/\?/gu, ".")}$`, "u");
}

export function fileTreePathIsHidden(
  path: string,
  patterns: readonly string[],
): boolean {
  const normalized = path.replace(/\\/gu, "/").replace(/^\.\//u, "");
  const segments = normalized.split("/").filter(Boolean);
  return patterns.some((rawPattern) => {
    const pattern = rawPattern.trim().replace(/\\/gu, "/");
    if (!pattern) return false;
    const candidates = pattern.includes("/") ? [normalized] : segments;
    const expression = filePatternRegex(pattern);
    return candidates.some((candidate) => expression.test(candidate));
  });
}

export const GRAMMAR_DIALECTS: {
  id: GrammarDialect;
  name: string;
}[] = [
  { id: "american", name: "English (US)" },
  { id: "british", name: "English (UK)" },
  { id: "australian", name: "English (Australia)" },
  { id: "canadian", name: "English (Canada)" },
  { id: "indian", name: "English (India)" },
];

interface SettingsState {
  vim: boolean;
  toggleVim: () => void;
  /** Completion popups while typing (Ctrl+Space always works). */
  editorAutocomplete: boolean;
  setEditorAutocomplete: (v: boolean) => void;
  /** Auto-insert closing brackets, parentheses, and quotes. */
  editorAutoCloseBrackets: boolean;
  setEditorAutoCloseBrackets: (v: boolean) => void;
  /** Dim inline preview of the most likely completion, accepted with Tab. */
  editorGhostCompletion: boolean;
  setEditorGhostCompletion: (v: boolean) => void;
  /** Keep the cursor solid instead of blinking. */
  editorNonBlinkingCursor: boolean;
  setEditorNonBlinkingCursor: (v: boolean) => void;
  /** Pin the enclosing sections and environments to the top while scrolling. */
  editorStickyScroll: boolean;
  setEditorStickyScroll: (v: boolean) => void;
  spellcheck: boolean;
  toggleSpellcheck: () => void;
  harper: boolean;
  setHarper: (v: boolean) => void;
  grammarDialect: GrammarDialect;
  setGrammarDialect: (v: GrammarDialect) => void;
  dictionaryLocale: DictionaryLocale;
  setDictionaryLocale: (v: DictionaryLocale) => void;
  showRegionalism: boolean;
  setShowRegionalism: (v: boolean) => void;
  showWordChoice: boolean;
  setShowWordChoice: (v: boolean) => void;
  offline: boolean;
  setOffline: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  newProjectOpen: boolean;
  setNewProjectOpen: (v: boolean) => void;
  figureModeOpen: boolean;
  setFigureModeOpen: (v: boolean) => void;
  wordCountOpen: boolean;
  setWordCountOpen: (v: boolean) => void;
  historyOpen: boolean;
  setHistoryOpen: (v: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  settingsInitialSection: string;
  setSettingsInitialSection: (v: string) => void;
  // One-shot scroll target within a settings section (e.g. "templates" inside
  // Downloads); consumed and cleared by the section that renders it so it
  // never re-triggers on a later, unrelated open.
  settingsScrollTarget: string | null;
  setSettingsScrollTarget: (v: string | null) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  defaultView: LayoutPreset;
  setDefaultView: (v: LayoutPreset) => void;
  openInTree: boolean;
  setOpenInTree: (v: boolean) => void;
  hoverPreview: boolean;
  setHoverPreview: (v: boolean) => void;
  chatFloating: boolean;
  setChatFloating: (v: boolean) => void;
  editorFontSize: number;
  setEditorFontSize: (v: number) => void;
  appFontSize: number;
  setAppFontSize: (v: number) => void;
  appFontFamily: string;
  setAppFontFamily: (v: string) => void;
  editorFontFamily: string;
  setEditorFontFamily: (v: string) => void;
  editorTheme: EditorThemeId;
  setEditorTheme: (v: EditorThemeId) => void;
  pdfDarkMode: boolean;
  setPdfDarkMode: (v: boolean) => void;
  pdfZoomShortcuts: boolean;
  setPdfZoomShortcuts: (v: boolean) => void;
  hiddenFilePatterns: readonly string[];
  addHiddenFilePattern: (pattern: string) => void;
  removeHiddenFilePattern: (pattern: string) => void;
  accentColor: string;
  setAccentColor: (v: string) => void;
  showTree: boolean;
  toggleTree: () => void;
  hotkeysOpen: boolean;
  setHotkeysOpen: (v: boolean) => void;
  railTab: RailTab;
  setRailTab: (v: RailTab) => void;
  suppressAiAutoLayout: boolean;
  setSuppressAiAutoLayout: (v: boolean) => void;
  setLayoutPreset: (v: LayoutPreset) => void;
  hideEditorArea: boolean;
  setHideEditorArea: (v: boolean) => void;
  dockPlacement: DockPlacement;
  setDockPlacement: (v: DockPlacement) => void;
  bgPattern: BackgroundPattern;
  setBgPattern: (v: BackgroundPattern) => void;
  visualEditor: boolean;
  setVisualEditor: (v: boolean) => void;
  latexTools: boolean;
  setLatexTools: (v: boolean) => void;
  // Engine for NEW LaTeX projects: "tectonic" (bundled, zero-setup) or
  // "latexmk" (system TeX; full Overleaf tool parity). Existing projects keep
  // their own pin in project.json.
  defaultLatexEngine: DefaultLatexEngine;
  setDefaultLatexEngine: (v: DefaultLatexEngine) => void;
  resetToDefaults: () => void;
}

export type DefaultLatexEngine = "tectonic" | "latexmk";

function readDefaultLatexEngine(raw: string): DefaultLatexEngine {
  return raw === "latexmk" ? "latexmk" : "tectonic";
}

const PREF_DEFAULTS = {
  vim: false,
  editorAutocomplete: true,
  editorAutoCloseBrackets: true,
  editorGhostCompletion: true,
  editorNonBlinkingCursor: false,
  editorStickyScroll: true,
  spellcheck: true,
  harper: true,
  grammarDialect: "american" as GrammarDialect,
  dictionaryLocale: "en_US" as DictionaryLocale,
  showRegionalism: true,
  showWordChoice: true,
  offline: false,
  editorFontSize: 13,
  appFontSize: 16,
  appFontFamily: "",
  editorFontFamily: "",
  editorTheme: "system" as EditorThemeId,
  pdfDarkMode: false,
  pdfZoomShortcuts: true,
  hiddenFilePatterns: [...DEFAULT_HIDDEN_FILE_PATTERNS] as readonly string[],
  defaultView: "editor-preview" as LayoutPreset,
  openInTree: false,
  hoverPreview: true,
  accentColor: "#2563eb",
  dockPlacement: "left" as DockPlacement,
  bgPattern: "dots" as BackgroundPattern,
  visualEditor: false,
  latexTools: false,
  defaultLatexEngine: "tectonic" as DefaultLatexEngine,
} as const;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  vim: ls("oleafly.vim", "0") === "1",
  toggleVim: () =>
    set((s) => {
      saveLs("oleafly.vim", s.vim ? "0" : "1");
      return { vim: !s.vim };
    }),
  editorAutocomplete: ls("oleafly.editor.autocomplete", "1") !== "0",
  setEditorAutocomplete: (v) => {
    saveLs("oleafly.editor.autocomplete", v ? "1" : "0");
    set({ editorAutocomplete: v });
  },
  editorAutoCloseBrackets: ls("oleafly.editor.closeBrackets", "1") !== "0",
  setEditorAutoCloseBrackets: (v) => {
    saveLs("oleafly.editor.closeBrackets", v ? "1" : "0");
    set({ editorAutoCloseBrackets: v });
  },
  editorGhostCompletion: ls("oleafly.editor.ghostCompletion", "1") !== "0",
  setEditorGhostCompletion: (v) => {
    saveLs("oleafly.editor.ghostCompletion", v ? "1" : "0");
    set({ editorGhostCompletion: v });
  },
  editorStickyScroll: ls("oleafly.editor.stickyScroll", "1") !== "0",
  setEditorStickyScroll: (v) => {
    saveLs("oleafly.editor.stickyScroll", v ? "1" : "0");
    set({ editorStickyScroll: v });
  },
  editorNonBlinkingCursor: ls("oleafly.editor.solidCursor", "0") === "1",
  setEditorNonBlinkingCursor: (v) => {
    saveLs("oleafly.editor.solidCursor", v ? "1" : "0");
    set({ editorNonBlinkingCursor: v });
  },
  spellcheck: ls("oleafly.spellcheck", "1") !== "0",
  toggleSpellcheck: () => {
    const spellcheck = !get().spellcheck;
    saveLs("oleafly.spellcheck", spellcheck ? "1" : "0");
    set({ spellcheck });
    notifyProofreadingSettingsChanged("spellcheck", get());
  },
  harper: ls("oleafly.harper", "1") !== "0",
  setHarper: (v) => {
    saveLs("oleafly.harper", v ? "1" : "0");
    set({ harper: v });
    notifyProofreadingSettingsChanged("harper", get());
  },
  grammarDialect: readGrammarDialect(
    ls("oleafly.harper.dialect", "american"),
  ),
  setGrammarDialect: (v) => {
    const dialect = readGrammarDialect(v);
    saveLs("oleafly.harper.dialect", dialect);
    set({ grammarDialect: dialect });
    notifyProofreadingSettingsChanged("grammarDialect", get());
  },
  dictionaryLocale: (() => {
    const raw = ls("oleafly.dictionary.locale", "en_US") as DictionaryLocale;
    return DICTIONARY_LOCALES.some((locale) => locale.id === raw) ? raw : "en_US";
  })(),
  setDictionaryLocale: (v) => {
    const locale = DICTIONARY_LOCALES.some((item) => item.id === v) ? v : "en_US";
    saveLs("oleafly.dictionary.locale", locale);
    set({ dictionaryLocale: locale });
    notifyProofreadingSettingsChanged("dictionaryLocale", get());
  },
  showRegionalism: ls("oleafly.harper.regionalism", "1") !== "0",
  setShowRegionalism: (v) => {
    saveLs("oleafly.harper.regionalism", v ? "1" : "0");
    set({ showRegionalism: v });
    notifyProofreadingSettingsChanged("regionalism", get());
  },
  showWordChoice: ls("oleafly.harper.wordchoice", "1") !== "0",
  setShowWordChoice: (v) => {
    saveLs("oleafly.harper.wordchoice", v ? "1" : "0");
    set({ showWordChoice: v });
    notifyProofreadingSettingsChanged("wordChoice", get());
  },
  offline: false,
  setOffline: (v) => set({ offline: v }),
  paletteOpen: false,
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  newProjectOpen: false,
  setNewProjectOpen: (v) => set({ newProjectOpen: v }),
  figureModeOpen: false,
  setFigureModeOpen: (v) => set({ figureModeOpen: v }),
  wordCountOpen: false,
  setWordCountOpen: (v) => set({ wordCountOpen: v }),
  historyOpen: false,
  setHistoryOpen: (v) => set({ historyOpen: v }),
  searchOpen: false,
  setSearchOpen: (v) => set({ searchOpen: v }),
  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  settingsInitialSection: "general",
  setSettingsInitialSection: (v) =>
    set({ settingsInitialSection: SETTINGS_SECTIONS.has(v) ? v : "general" }),
  settingsScrollTarget: null,
  setSettingsScrollTarget: (v) => set({ settingsScrollTarget: v }),
  viewMode: "split",
  setViewMode: (v) => set({ viewMode: v }),
  defaultView: readDefaultView(ls("oleafly.defaultView", "editor-preview")),
  setDefaultView: (v) => {
    saveLs("oleafly.defaultView", v);
    set({ defaultView: v });
  },
  hoverPreview: ls("oleafly.hoverPreview", "1") === "1",
  setHoverPreview: (v) => {
    saveLs("oleafly.hoverPreview", v ? "1" : "0");
    set({ hoverPreview: v });
  },
  chatFloating: ls("oleafly.ai.floating", "0") === "1",
  setChatFloating: (v) => {
    saveLs("oleafly.ai.floating", v ? "1" : "0");
    set({ chatFloating: v });
  },
  openInTree: ls("oleafly.openInTree", "0") !== "0",
  setOpenInTree: (v) => {
    saveLs("oleafly.openInTree", v ? "1" : "0");
    set({ openInTree: v });
  },
  editorFontSize: Number(ls("oleafly.fontSize", "13")) || 13,
  setEditorFontSize: (v) => {
    saveLs("oleafly.fontSize", String(v));
    set({ editorFontSize: v });
  },
  appFontSize: Number(ls("oleafly.appFontSize", "16")) || 16,
  setAppFontSize: (v) => {
    saveLs("oleafly.appFontSize", String(v));
    set({ appFontSize: v });
  },
  appFontFamily: ls("oleafly.appFont", ""),
  setAppFontFamily: (v) => {
    saveLs("oleafly.appFont", v);
    set({ appFontFamily: v });
  },
  editorFontFamily: ls("oleafly.editorFont", ""),
  setEditorFontFamily: (v) => {
    saveLs("oleafly.editorFont", v);
    set({ editorFontFamily: v });
  },
  editorTheme: readEditorTheme(ls("oleafly.editorTheme", "system")),
  setEditorTheme: (v) => {
    saveLs("oleafly.editorTheme", v);
    set({ editorTheme: v });
  },
  pdfDarkMode: ls("oleafly.pdf.darkMode", "0") === "1",
  setPdfDarkMode: (v) => {
    saveLs("oleafly.pdf.darkMode", v ? "1" : "0");
    set({ pdfDarkMode: v });
  },
  pdfZoomShortcuts: ls("oleafly.pdf.zoomShortcuts", "1") !== "0",
  setPdfZoomShortcuts: (v) => {
    saveLs("oleafly.pdf.zoomShortcuts", v ? "1" : "0");
    set({ pdfZoomShortcuts: v });
  },
  hiddenFilePatterns: readHiddenFilePatterns(
    ls("oleafly.fileTree.hiddenPatterns", JSON.stringify(DEFAULT_HIDDEN_FILE_PATTERNS)),
  ),
  addHiddenFilePattern: (rawPattern) => {
    const pattern = rawPattern.trim();
    if (!pattern) return;
    set((state) => {
      if (state.hiddenFilePatterns.includes(pattern)) return state;
      const hiddenFilePatterns = [...state.hiddenFilePatterns, pattern];
      saveLs("oleafly.fileTree.hiddenPatterns", JSON.stringify(hiddenFilePatterns));
      return { hiddenFilePatterns };
    });
  },
  removeHiddenFilePattern: (pattern) => {
    set((state) => {
      const hiddenFilePatterns = state.hiddenFilePatterns.filter(
        (candidate) => candidate !== pattern,
      );
      saveLs("oleafly.fileTree.hiddenPatterns", JSON.stringify(hiddenFilePatterns));
      return { hiddenFilePatterns };
    });
  },
  accentColor: ls("oleafly.accent", "#2563eb"),
  setAccentColor: (v) => {
    saveLs("oleafly.accent", v);
    set({ accentColor: v });
  },
  dockPlacement: (ls("oleafly.dockPlacement", "left") as DockPlacement) || "left",
  setDockPlacement: (v) => {
    saveLs("oleafly.dockPlacement", v);
    set({ dockPlacement: v });
  },
  bgPattern: (ls("oleafly.bgPattern", "dots") as BackgroundPattern) || "dots",
  setBgPattern: (v) => {
    saveLs("oleafly.bgPattern", v);
    set({ bgPattern: v });
  },
  visualEditor: ls("oleafly.visualEditor", "0") === "1",
  setVisualEditor: (v) => {
    saveLs("oleafly.visualEditor", v ? "1" : "0");
    set({ visualEditor: v });
  },
  latexTools: ls("oleafly.latexTools", "0") === "1",
  setLatexTools: (v) => {
    saveLs("oleafly.latexTools", v ? "1" : "0");
    set({ latexTools: v });
  },
  showTree: true,
  toggleTree: () => set((s) => ({ showTree: !s.showTree })),
  hotkeysOpen: false,
  setHotkeysOpen: (v) => set({ hotkeysOpen: v }),
  railTab: "files",
  setRailTab: (v) => set({ railTab: v }),
  suppressAiAutoLayout: false,
  setSuppressAiAutoLayout: (v) => set({ suppressAiAutoLayout: v }),
  hideEditorArea: false,
  setHideEditorArea: (v) => set({ hideEditorArea: v }),
  setLayoutPreset: (preset) => {
    switch (preset) {
      case "editor-preview-ai":
        set({
          suppressAiAutoLayout: true,
          showTree: true,
          railTab: "ai",
          viewMode: "split",
          hideEditorArea: false,
        });
        break;
      case "editor-preview":
        set((s) => ({
          showTree: true,
          railTab: s.railTab === "ai" || s.railTab === "chat" ? "files" : s.railTab,
          viewMode: "split",
          hideEditorArea: false,
        }));
        break;
      case "editor-ai":
        set({
          suppressAiAutoLayout: true,
          showTree: true,
          railTab: "ai",
          viewMode: "editor",
          hideEditorArea: false,
        });
        break;
      case "preview-ai":
        set({
          suppressAiAutoLayout: true,
          showTree: true,
          railTab: "ai",
          viewMode: "pdf",
          hideEditorArea: false,
        });
        break;
      case "editor-only":
        set((s) => ({
          showTree: false,
          railTab: s.railTab === "ai" || s.railTab === "chat" ? "files" : s.railTab,
          viewMode: "editor",
          hideEditorArea: false,
        }));
        break;
      case "preview-only":
        set((s) => ({
          showTree: false,
          railTab: s.railTab === "ai" || s.railTab === "chat" ? "files" : s.railTab,
          viewMode: "pdf",
          hideEditorArea: false,
        }));
        break;
      case "ai-only":
        set({ suppressAiAutoLayout: true, showTree: true, railTab: "ai", hideEditorArea: true });
        break;
    }
  },
  defaultLatexEngine: readDefaultLatexEngine(ls("oleafly.defaultLatexEngine", "tectonic")),
  setDefaultLatexEngine: (v) => {
    saveLs("oleafly.defaultLatexEngine", v);
    set({ defaultLatexEngine: v });
  },
  resetToDefaults: () => {
    // Drop the persisted copies so a restart doesn't resurrect old values.
    saveLs("oleafly.vim", PREF_DEFAULTS.vim ? "1" : "0");
    saveLs(
      "oleafly.editor.autocomplete",
      PREF_DEFAULTS.editorAutocomplete ? "1" : "0",
    );
    saveLs(
      "oleafly.editor.closeBrackets",
      PREF_DEFAULTS.editorAutoCloseBrackets ? "1" : "0",
    );
    saveLs(
      "oleafly.editor.ghostCompletion",
      PREF_DEFAULTS.editorGhostCompletion ? "1" : "0",
    );
    saveLs(
      "oleafly.editor.solidCursor",
      PREF_DEFAULTS.editorNonBlinkingCursor ? "1" : "0",
    );
    saveLs(
      "oleafly.editor.stickyScroll",
      PREF_DEFAULTS.editorStickyScroll ? "1" : "0",
    );
    saveLs("oleafly.spellcheck", PREF_DEFAULTS.spellcheck ? "1" : "0");
    saveLs("oleafly.harper", PREF_DEFAULTS.harper ? "1" : "0");
    saveLs("oleafly.harper.dialect", PREF_DEFAULTS.grammarDialect);
    saveLs("oleafly.harper.regionalism", "1");
    saveLs("oleafly.harper.wordchoice", "1");
    saveLs("oleafly.fontSize", String(PREF_DEFAULTS.editorFontSize));
    saveLs("oleafly.appFontSize", String(PREF_DEFAULTS.appFontSize));
    saveLs("oleafly.appFont", PREF_DEFAULTS.appFontFamily);
    saveLs("oleafly.editorFont", PREF_DEFAULTS.editorFontFamily);
    saveLs("oleafly.editorTheme", PREF_DEFAULTS.editorTheme);
    saveLs("oleafly.pdf.darkMode", PREF_DEFAULTS.pdfDarkMode ? "1" : "0");
    saveLs(
      "oleafly.pdf.zoomShortcuts",
      PREF_DEFAULTS.pdfZoomShortcuts ? "1" : "0",
    );
    saveLs(
      "oleafly.fileTree.hiddenPatterns",
      JSON.stringify(PREF_DEFAULTS.hiddenFilePatterns),
    );
    saveLs("oleafly.defaultView", PREF_DEFAULTS.defaultView);
    saveLs("oleafly.openInTree", PREF_DEFAULTS.openInTree ? "1" : "0");
    saveLs("oleafly.hoverPreview", PREF_DEFAULTS.hoverPreview ? "1" : "0");
    saveLs("oleafly.accent", PREF_DEFAULTS.accentColor);
    saveLs("oleafly.dockPlacement", PREF_DEFAULTS.dockPlacement);
    saveLs("oleafly.bgPattern", PREF_DEFAULTS.bgPattern);
    saveLs("oleafly.visualEditor", PREF_DEFAULTS.visualEditor ? "1" : "0");
    saveLs("oleafly.latexTools", PREF_DEFAULTS.latexTools ? "1" : "0");
    saveLs("oleafly.defaultLatexEngine", PREF_DEFAULTS.defaultLatexEngine);
    set({ ...PREF_DEFAULTS });
    notifyProofreadingSettingsChanged("reset", get());
  },
}));
