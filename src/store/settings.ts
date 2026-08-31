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

// Only the AI-only layout hides the editor/preview region entirely; the rest
// always show it and select panes through the view mode.
export function layoutPresetHidesWorkspace(preset: LayoutPreset): boolean {
  return preset === "ai-only";
}

export type RailTab =
  | "files"
  | "search"
  | "source"
  | "review"
  | "preflight"
  | "refs"
  | "mcp";

export type DockPlacement = "left" | "right" | "bottom";
export type BackgroundPattern = "dots" | "grid" | "none";
export type HomeProjectLayout = "grid" | "list";
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
export type TerminalCursorStyle = "block" | "underline" | "bar";
export type TerminalColorThemeId = "dark" | "light";
export type BrowserSearchEngineId =
  | "google"
  | "bing"
  | "duckduckgo"
  | "brave"
  | "perplexity"
  | "startpage"
  | "ecosia";

export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  selectionInactiveBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const TERMINAL_COLOR_THEMES: Record<
  TerminalColorThemeId,
  { id: TerminalColorThemeId; name: string; colors: TerminalThemeColors }
> = {
  dark: {
    id: "dark",
    name: "Dark",
    colors: {
      background: "#1e1e1e",
      foreground: "#f2f2f2",
      cursor: "#ffffff",
      cursorAccent: "#1e1e1e",
      selectionBackground: "#264f78",
      selectionForeground: "#ffffff",
      selectionInactiveBackground: "#3a3d41",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#ffffff",
    },
  },
  light: {
    id: "light",
    name: "Light",
    colors: {
      background: "#ffffff",
      foreground: "#1f2328",
      cursor: "#1f2328",
      cursorAccent: "#ffffff",
      selectionBackground: "#add6ff",
      selectionForeground: "#1f2328",
      selectionInactiveBackground: "#d7e7f7",
      black: "#24292f",
      red: "#cf222e",
      green: "#1a7f37",
      yellow: "#9a6700",
      blue: "#0969da",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#6e7781",
      brightBlack: "#57606a",
      brightRed: "#a40e26",
      brightGreen: "#2da44e",
      brightYellow: "#bf8700",
      brightBlue: "#218bff",
      brightMagenta: "#a475f9",
      brightCyan: "#3192aa",
      brightWhite: "#24292f",
    },
  },
};

export const BROWSER_SEARCH_ENGINES: {
  id: BrowserSearchEngineId;
  name: string;
  searchUrl: string;
}[] = [
  { id: "google", name: "Google", searchUrl: "https://www.google.com/search?q=" },
  { id: "bing", name: "Bing", searchUrl: "https://www.bing.com/search?q=" },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    searchUrl: "https://duckduckgo.com/?q=",
  },
  {
    id: "brave",
    name: "Brave",
    searchUrl: "https://search.brave.com/search?q=",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    searchUrl: "https://www.perplexity.ai/search?s=o&q=",
  },
  {
    id: "startpage",
    name: "Startpage",
    searchUrl: "https://www.startpage.com/sp/search?query=",
  },
  {
    id: "ecosia",
    name: "Ecosia",
    searchUrl: "https://www.ecosia.org/search?q=",
  },
];

export const DEFAULT_TERMINAL_FONT_FAMILY =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace';

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
  "ai-only",
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
function readNumberInRange(
  raw: string | number,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}
function readTerminalCursorStyle(raw: string): TerminalCursorStyle {
  return raw === "underline" || raw === "bar" ? raw : "block";
}
function readTerminalColorTheme(raw: string): TerminalColorThemeId {
  return raw === "light" ? "light" : "dark";
}
function readTerminalColor(raw: string, fallback: string): string {
  return /^#[\da-f]{6}$/iu.test(raw) ? raw.toLowerCase() : fallback;
}
function readBrowserSearchEngine(raw: string): BrowserSearchEngineId {
  return BROWSER_SEARCH_ENGINES.some(({ id }) => id === raw)
    ? (raw as BrowserSearchEngineId)
    : "google";
}
function readBrowserHomePage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "https://www.google.com/";
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "https://www.google.com/";
  } catch {
    return "https://www.google.com/";
  }
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
export const TERMINAL_FONTS: { name: string; value: string }[] = [
  { name: "Terminal default", value: DEFAULT_TERMINAL_FONT_FAMILY },
  ...EDITOR_FONTS.filter(({ value }) => value),
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
  // The editor/preview region is hidden only for the AI-only layout; every
  // other layout shows it and picks the panes through viewMode.
  workspaceHidden: boolean;
  defaultView: LayoutPreset;
  setDefaultView: (v: LayoutPreset) => void;
  openInTree: boolean;
  setOpenInTree: (v: boolean) => void;
  hoverPreview: boolean;
  setHoverPreview: (v: boolean) => void;
  chatFloating: boolean;
  setChatFloating: (v: boolean) => void;
  terminalOpen: boolean;
  setTerminalOpen: (v: boolean) => void;
  browserOpen: boolean;
  setBrowserOpen: (v: boolean) => void;
  assistantOpen: boolean;
  setAssistantOpen: (v: boolean) => void;
  closeDocks: () => void;
  terminalFontSize: number;
  setTerminalFontSize: (v: number) => void;
  terminalFontFamily: string;
  setTerminalFontFamily: (v: string) => void;
  terminalFontWeight: number;
  setTerminalFontWeight: (v: number) => void;
  terminalFontWeightBold: number;
  setTerminalFontWeightBold: (v: number) => void;
  terminalCursorStyle: TerminalCursorStyle;
  setTerminalCursorStyle: (v: TerminalCursorStyle) => void;
  terminalCursorBlink: boolean;
  setTerminalCursorBlink: (v: boolean) => void;
  terminalColorTheme: TerminalColorThemeId;
  setTerminalColorTheme: (v: TerminalColorThemeId) => void;
  terminalBackground: string;
  setTerminalBackground: (v: string) => void;
  terminalForeground: string;
  setTerminalForeground: (v: string) => void;
  terminalCursorColor: string;
  setTerminalCursorColor: (v: string) => void;
  browserSearchEngine: BrowserSearchEngineId;
  setBrowserSearchEngine: (v: BrowserSearchEngineId) => void;
  browserHomePage: string;
  setBrowserHomePage: (v: string) => void;
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
  setShowTree: (v: boolean) => void;
  hotkeysOpen: boolean;
  setHotkeysOpen: (v: boolean) => void;
  railTab: RailTab;
  setRailTab: (v: RailTab) => void;
  setLayoutPreset: (v: LayoutPreset) => void;
  dockPlacement: DockPlacement;
  setDockPlacement: (v: DockPlacement) => void;
  bgPattern: BackgroundPattern;
  setBgPattern: (v: BackgroundPattern) => void;
  homeProjectLayout: HomeProjectLayout;
  setHomeProjectLayout: (v: HomeProjectLayout) => void;
  visualEditor: boolean;
  setVisualEditor: (v: boolean) => void;
  latexTools: boolean;
  setLatexTools: (v: boolean) => void;
  // Experimental in-app web browser (the browser dock, its toggle, the
  // shortcut, and the AI computer_use tool). Off by default; every browser
  // entry point is gated on this.
  webBrowser: boolean;
  setWebBrowser: (v: boolean) => void;
  // Engine for NEW LaTeX projects: "tectonic" (bundled, zero-setup) or
  // "latexmk" (system TeX; full Overleaf tool parity). Existing projects keep
  // their own pin in project.json.
  defaultLatexEngine: DefaultLatexEngine;
  setDefaultLatexEngine: (v: DefaultLatexEngine) => void;
  resetGeneralPreferences: () => void;
  resetAppearancePreferences: () => void;
  resetExperimentationPreferences: () => void;
  resetEnginePreferences: () => void;
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
  openInTree: true,
  hoverPreview: true,
  terminalOpen: false,
  browserOpen: false,
  terminalFontSize: 14,
  terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  terminalFontWeight: 500,
  terminalFontWeightBold: 700,
  terminalCursorStyle: "block" as TerminalCursorStyle,
  terminalCursorBlink: true,
  terminalColorTheme: "dark" as TerminalColorThemeId,
  terminalBackground: TERMINAL_COLOR_THEMES.dark.colors.background,
  terminalForeground: TERMINAL_COLOR_THEMES.dark.colors.foreground,
  terminalCursorColor: TERMINAL_COLOR_THEMES.dark.colors.cursor,
  browserSearchEngine: "google" as BrowserSearchEngineId,
  browserHomePage: "https://www.google.com/",
  accentColor: "#2563eb",
  dockPlacement: "left" as DockPlacement,
  bgPattern: "dots" as BackgroundPattern,
  homeProjectLayout: "grid" as HomeProjectLayout,
  visualEditor: false,
  latexTools: false,
  webBrowser: false,
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
  // Choosing an explicit editor/split/pdf view always reveals the workspace.
  setViewMode: (v) => set({ viewMode: v, workspaceHidden: false }),
  workspaceHidden: false,
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
  terminalOpen: false,
  setTerminalOpen: (v) => {
    set({ terminalOpen: v });
  },
  browserOpen: false,
  // The single chokepoint for opening the browser: it can only open when the
  // experimental web-browser flag is on, so the button, the shortcut, the AI
  // openBrowser hook, and computer-use all respect the flag.
  setBrowserOpen: (v) => {
    set({ browserOpen: v && get().webBrowser });
  },
  assistantOpen: false,
  setAssistantOpen: (v) => {
    // Closing the assistant while the workspace is hidden (AI-only layout)
    // would leave nothing on screen, so reveal the workspace as it closes.
    set(v ? { assistantOpen: true } : { assistantOpen: false, workspaceHidden: false });
  },
  closeDocks: () => {
    set({ terminalOpen: false, browserOpen: false });
  },
  terminalFontSize: readNumberInRange(
    ls("oleafly.terminal.fontSize", "14"),
    14,
    8,
    32,
  ),
  setTerminalFontSize: (v) => {
    const value = readNumberInRange(v, 14, 8, 32);
    saveLs("oleafly.terminal.fontSize", String(value));
    set({ terminalFontSize: value });
  },
  terminalFontFamily: ls(
    "oleafly.terminal.fontFamily",
    DEFAULT_TERMINAL_FONT_FAMILY,
  ),
  setTerminalFontFamily: (v) => {
    const value = v.trim() || DEFAULT_TERMINAL_FONT_FAMILY;
    saveLs("oleafly.terminal.fontFamily", value);
    set({ terminalFontFamily: value });
  },
  terminalFontWeight: readNumberInRange(
    ls("oleafly.terminal.fontWeight", "500"),
    500,
    100,
    900,
  ),
  setTerminalFontWeight: (v) => {
    const value = readNumberInRange(v, 500, 100, 900);
    saveLs("oleafly.terminal.fontWeight", String(value));
    set({ terminalFontWeight: value });
  },
  terminalFontWeightBold: readNumberInRange(
    ls("oleafly.terminal.fontWeightBold", "700"),
    700,
    100,
    900,
  ),
  setTerminalFontWeightBold: (v) => {
    const value = readNumberInRange(v, 700, 100, 900);
    saveLs("oleafly.terminal.fontWeightBold", String(value));
    set({ terminalFontWeightBold: value });
  },
  terminalCursorStyle: readTerminalCursorStyle(
    ls("oleafly.terminal.cursorStyle", "block"),
  ),
  setTerminalCursorStyle: (v) => {
    const value = readTerminalCursorStyle(v);
    saveLs("oleafly.terminal.cursorStyle", value);
    set({ terminalCursorStyle: value });
  },
  terminalCursorBlink: ls("oleafly.terminal.cursorBlink", "1") !== "0",
  setTerminalCursorBlink: (v) => {
    saveLs("oleafly.terminal.cursorBlink", v ? "1" : "0");
    set({ terminalCursorBlink: v });
  },
  terminalColorTheme: readTerminalColorTheme(
    ls("oleafly.terminal.colorTheme", "dark"),
  ),
  setTerminalColorTheme: (v) => {
    const terminalColorTheme = readTerminalColorTheme(v);
    const colors = TERMINAL_COLOR_THEMES[terminalColorTheme].colors;
    saveLs("oleafly.terminal.colorTheme", terminalColorTheme);
    saveLs("oleafly.terminal.background", colors.background);
    saveLs("oleafly.terminal.foreground", colors.foreground);
    saveLs("oleafly.terminal.cursorColor", colors.cursor);
    set({
      terminalColorTheme,
      terminalBackground: colors.background,
      terminalForeground: colors.foreground,
      terminalCursorColor: colors.cursor,
    });
  },
  terminalBackground: (() => {
    const theme = readTerminalColorTheme(
      ls("oleafly.terminal.colorTheme", "dark"),
    );
    const fallback = TERMINAL_COLOR_THEMES[theme].colors.background;
    return readTerminalColor(ls("oleafly.terminal.background", fallback), fallback);
  })(),
  setTerminalBackground: (v) => {
    const value = readTerminalColor(v, get().terminalBackground);
    saveLs("oleafly.terminal.background", value);
    set({ terminalBackground: value });
  },
  terminalForeground: (() => {
    const theme = readTerminalColorTheme(
      ls("oleafly.terminal.colorTheme", "dark"),
    );
    const fallback = TERMINAL_COLOR_THEMES[theme].colors.foreground;
    return readTerminalColor(ls("oleafly.terminal.foreground", fallback), fallback);
  })(),
  setTerminalForeground: (v) => {
    const value = readTerminalColor(v, get().terminalForeground);
    saveLs("oleafly.terminal.foreground", value);
    set({ terminalForeground: value });
  },
  terminalCursorColor: (() => {
    const theme = readTerminalColorTheme(
      ls("oleafly.terminal.colorTheme", "dark"),
    );
    const fallback = TERMINAL_COLOR_THEMES[theme].colors.cursor;
    return readTerminalColor(ls("oleafly.terminal.cursorColor", fallback), fallback);
  })(),
  setTerminalCursorColor: (v) => {
    const value = readTerminalColor(v, get().terminalCursorColor);
    saveLs("oleafly.terminal.cursorColor", value);
    set({ terminalCursorColor: value });
  },
  browserSearchEngine: readBrowserSearchEngine(
    ls("oleafly.browser.searchEngine", "google"),
  ),
  setBrowserSearchEngine: (v) => {
    const value = readBrowserSearchEngine(v);
    saveLs("oleafly.browser.searchEngine", value);
    set({ browserSearchEngine: value });
  },
  browserHomePage: readBrowserHomePage(
    ls("oleafly.browser.homePage", "https://www.google.com/"),
  ),
  setBrowserHomePage: (v) => {
    const value = readBrowserHomePage(v);
    saveLs("oleafly.browser.homePage", value);
    set({ browserHomePage: value });
  },
  openInTree: ls("oleafly.openInTree", "1") !== "0",
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
  homeProjectLayout:
    ls("oleafly.library.projectLayout", "grid") === "list" ? "list" : "grid",
  setHomeProjectLayout: (v) => {
    saveLs("oleafly.library.projectLayout", v);
    set({ homeProjectLayout: v });
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
  webBrowser: ls("oleafly.webBrowser", "0") === "1",
  setWebBrowser: (v) => {
    saveLs("oleafly.webBrowser", v ? "1" : "0");
    // Turning the browser off must also close any open browser dock.
    set(v ? { webBrowser: true } : { webBrowser: false, browserOpen: false });
  },
  showTree: true,
  toggleTree: () => set((s) => ({ showTree: !s.showTree })),
  setShowTree: (v) => set({ showTree: v }),
  hotkeysOpen: false,
  setHotkeysOpen: (v) => set({ hotkeysOpen: v }),
  railTab: "files",
  setRailTab: (v) => set({ railTab: v }),
  // A layout preset controls only the editor/preview/AI panes. The file tree
  // is an independent surface (its own toggle and the "show file tree on
  // open" preference), so switching layouts never opens or closes it.
  setLayoutPreset: (preset) => {
    switch (preset) {
      case "editor-preview-ai":
        set({ viewMode: "split", assistantOpen: true, workspaceHidden: false });
        break;
      case "editor-preview":
        set({ viewMode: "split", assistantOpen: false, workspaceHidden: false });
        break;
      case "editor-ai":
        set({ viewMode: "editor", assistantOpen: true, workspaceHidden: false });
        break;
      case "preview-ai":
        set({ viewMode: "pdf", assistantOpen: true, workspaceHidden: false });
        break;
      case "editor-only":
        set({ viewMode: "editor", assistantOpen: false, workspaceHidden: false });
        break;
      case "preview-only":
        set({ viewMode: "pdf", assistantOpen: false, workspaceHidden: false });
        break;
      case "ai-only":
        // No editor or preview: hide the whole workspace region and let the
        // assistant fill it.
        set({ assistantOpen: true, workspaceHidden: true });
        break;
    }
  },
  defaultLatexEngine: readDefaultLatexEngine(ls("oleafly.defaultLatexEngine", "tectonic")),
  setDefaultLatexEngine: (v) => {
    saveLs("oleafly.defaultLatexEngine", v);
    set({ defaultLatexEngine: v });
  },
  resetGeneralPreferences: () => {
    saveLs("oleafly.spellcheck", PREF_DEFAULTS.spellcheck ? "1" : "0");
    saveLs("oleafly.harper", PREF_DEFAULTS.harper ? "1" : "0");
    saveLs("oleafly.harper.dialect", PREF_DEFAULTS.grammarDialect);
    saveLs("oleafly.dictionary.locale", PREF_DEFAULTS.dictionaryLocale);
    saveLs(
      "oleafly.harper.regionalism",
      PREF_DEFAULTS.showRegionalism ? "1" : "0",
    );
    saveLs(
      "oleafly.harper.wordchoice",
      PREF_DEFAULTS.showWordChoice ? "1" : "0",
    );
    set({
      spellcheck: PREF_DEFAULTS.spellcheck,
      harper: PREF_DEFAULTS.harper,
      grammarDialect: PREF_DEFAULTS.grammarDialect,
      dictionaryLocale: PREF_DEFAULTS.dictionaryLocale,
      showRegionalism: PREF_DEFAULTS.showRegionalism,
      showWordChoice: PREF_DEFAULTS.showWordChoice,
      offline: PREF_DEFAULTS.offline,
    });
    notifyProofreadingSettingsChanged("reset", get());
  },
  resetAppearancePreferences: () => {
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
    saveLs("oleafly.terminal.fontSize", String(PREF_DEFAULTS.terminalFontSize));
    saveLs("oleafly.terminal.fontFamily", PREF_DEFAULTS.terminalFontFamily);
    saveLs(
      "oleafly.terminal.fontWeight",
      String(PREF_DEFAULTS.terminalFontWeight),
    );
    saveLs(
      "oleafly.terminal.fontWeightBold",
      String(PREF_DEFAULTS.terminalFontWeightBold),
    );
    saveLs("oleafly.terminal.cursorStyle", PREF_DEFAULTS.terminalCursorStyle);
    saveLs(
      "oleafly.terminal.cursorBlink",
      PREF_DEFAULTS.terminalCursorBlink ? "1" : "0",
    );
    saveLs("oleafly.terminal.colorTheme", PREF_DEFAULTS.terminalColorTheme);
    saveLs("oleafly.terminal.background", PREF_DEFAULTS.terminalBackground);
    saveLs("oleafly.terminal.foreground", PREF_DEFAULTS.terminalForeground);
    saveLs("oleafly.terminal.cursorColor", PREF_DEFAULTS.terminalCursorColor);
    saveLs("oleafly.browser.searchEngine", PREF_DEFAULTS.browserSearchEngine);
    saveLs("oleafly.browser.homePage", PREF_DEFAULTS.browserHomePage);
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
    saveLs("oleafly.library.projectLayout", PREF_DEFAULTS.homeProjectLayout);
    set({
      vim: PREF_DEFAULTS.vim,
      editorAutocomplete: PREF_DEFAULTS.editorAutocomplete,
      editorAutoCloseBrackets: PREF_DEFAULTS.editorAutoCloseBrackets,
      editorGhostCompletion: PREF_DEFAULTS.editorGhostCompletion,
      editorNonBlinkingCursor: PREF_DEFAULTS.editorNonBlinkingCursor,
      editorStickyScroll: PREF_DEFAULTS.editorStickyScroll,
      terminalFontSize: PREF_DEFAULTS.terminalFontSize,
      terminalFontFamily: PREF_DEFAULTS.terminalFontFamily,
      terminalFontWeight: PREF_DEFAULTS.terminalFontWeight,
      terminalFontWeightBold: PREF_DEFAULTS.terminalFontWeightBold,
      terminalCursorStyle: PREF_DEFAULTS.terminalCursorStyle,
      terminalCursorBlink: PREF_DEFAULTS.terminalCursorBlink,
      terminalColorTheme: PREF_DEFAULTS.terminalColorTheme,
      terminalBackground: PREF_DEFAULTS.terminalBackground,
      terminalForeground: PREF_DEFAULTS.terminalForeground,
      terminalCursorColor: PREF_DEFAULTS.terminalCursorColor,
      browserSearchEngine: PREF_DEFAULTS.browserSearchEngine,
      browserHomePage: PREF_DEFAULTS.browserHomePage,
      editorFontSize: PREF_DEFAULTS.editorFontSize,
      appFontSize: PREF_DEFAULTS.appFontSize,
      appFontFamily: PREF_DEFAULTS.appFontFamily,
      editorFontFamily: PREF_DEFAULTS.editorFontFamily,
      editorTheme: PREF_DEFAULTS.editorTheme,
      pdfDarkMode: PREF_DEFAULTS.pdfDarkMode,
      pdfZoomShortcuts: PREF_DEFAULTS.pdfZoomShortcuts,
      hiddenFilePatterns: [...PREF_DEFAULTS.hiddenFilePatterns],
      defaultView: PREF_DEFAULTS.defaultView,
      openInTree: PREF_DEFAULTS.openInTree,
      hoverPreview: PREF_DEFAULTS.hoverPreview,
      accentColor: PREF_DEFAULTS.accentColor,
      dockPlacement: PREF_DEFAULTS.dockPlacement,
      bgPattern: PREF_DEFAULTS.bgPattern,
      homeProjectLayout: PREF_DEFAULTS.homeProjectLayout,
    });
  },
  resetExperimentationPreferences: () => {
    saveLs("oleafly.visualEditor", PREF_DEFAULTS.visualEditor ? "1" : "0");
    saveLs("oleafly.latexTools", PREF_DEFAULTS.latexTools ? "1" : "0");
    saveLs("oleafly.webBrowser", PREF_DEFAULTS.webBrowser ? "1" : "0");
    set({
      visualEditor: PREF_DEFAULTS.visualEditor,
      latexTools: PREF_DEFAULTS.latexTools,
      webBrowser: PREF_DEFAULTS.webBrowser,
      browserOpen: false,
    });
  },
  resetEnginePreferences: () => {
    saveLs("oleafly.defaultLatexEngine", PREF_DEFAULTS.defaultLatexEngine);
    set({ defaultLatexEngine: PREF_DEFAULTS.defaultLatexEngine });
  },
  resetToDefaults: () => {
    get().resetGeneralPreferences();
    get().resetAppearancePreferences();
    get().resetExperimentationPreferences();
    get().resetEnginePreferences();
    set({ terminalOpen: false, browserOpen: false });
  },
}));
