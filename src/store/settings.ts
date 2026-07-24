import { create } from "zustand";

const SETTINGS_SECTIONS = new Set([
  "general",
  "appearance",
  "dictionary",
  "data",
  "ai",
  "engine",
  "downloads",
  "github",
  "shortcuts",
  "mcp",
  "help",
]);

export type ViewMode = "split" | "editor" | "pdf";
export type LayoutPreset =
  | "editor-preview-ai"
  | "editor-preview"
  | "editor-ai"
  | "preview-ai"
  | "editor-only"
  | "preview-only";

export function layoutPresetViewMode(preset: LayoutPreset): ViewMode {
  if (preset === "editor-preview-ai" || preset === "editor-preview") return "split";
  if (preset === "editor-ai" || preset === "editor-only") return "editor";
  return "pdf";
}

export function layoutPresetWantsAi(preset: LayoutPreset): boolean {
  return preset === "editor-preview-ai" || preset === "editor-ai" || preset === "preview-ai";
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
export type BackgroundPattern = "dots" | "grid";
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
function saveLs(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
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

interface SettingsState {
  vim: boolean;
  toggleVim: () => void;
  spellcheck: boolean;
  toggleSpellcheck: () => void;
  harper: boolean;
  setHarper: (v: boolean) => void;
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
  dockPlacement: DockPlacement;
  setDockPlacement: (v: DockPlacement) => void;
  bgPattern: BackgroundPattern;
  setBgPattern: (v: BackgroundPattern) => void;
  resetToDefaults: () => void;
}

const PREF_DEFAULTS = {
  vim: false,
  spellcheck: true,
  harper: true,
  showRegionalism: true,
  showWordChoice: true,
  offline: false,
  editorFontSize: 13,
  appFontSize: 16,
  appFontFamily: "",
  editorFontFamily: "",
  editorTheme: "system" as EditorThemeId,
  defaultView: "editor-preview" as LayoutPreset,
  openInTree: false,
  hoverPreview: true,
  accentColor: "#2563eb",
  dockPlacement: "left" as DockPlacement,
  bgPattern: "dots" as BackgroundPattern,
} as const;

export const useSettingsStore = create<SettingsState>((set) => ({
  vim: ls("oleafly.vim", "0") === "1",
  toggleVim: () =>
    set((s) => {
      saveLs("oleafly.vim", s.vim ? "0" : "1");
      return { vim: !s.vim };
    }),
  spellcheck: ls("oleafly.spellcheck", "1") !== "0",
  toggleSpellcheck: () =>
    set((s) => {
      saveLs("oleafly.spellcheck", s.spellcheck ? "0" : "1");
      return { spellcheck: !s.spellcheck };
    }),
  harper: ls("oleafly.harper", "1") !== "0",
  setHarper: (v) => {
    saveLs("oleafly.harper", v ? "1" : "0");
    set({ harper: v });
  },
  showRegionalism: ls("oleafly.harper.regionalism", "1") !== "0",
  setShowRegionalism: (v) => {
    saveLs("oleafly.harper.regionalism", v ? "1" : "0");
    set({ showRegionalism: v });
  },
  showWordChoice: ls("oleafly.harper.wordchoice", "1") !== "0",
  setShowWordChoice: (v) => {
    saveLs("oleafly.harper.wordchoice", v ? "1" : "0");
    set({ showWordChoice: v });
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
  showTree: true,
  toggleTree: () => set((s) => ({ showTree: !s.showTree })),
  hotkeysOpen: false,
  setHotkeysOpen: (v) => set({ hotkeysOpen: v }),
  railTab: "files",
  setRailTab: (v) => set({ railTab: v }),
  suppressAiAutoLayout: false,
  setSuppressAiAutoLayout: (v) => set({ suppressAiAutoLayout: v }),
  setLayoutPreset: (preset) => {
    switch (preset) {
      case "editor-preview-ai":
        set({ suppressAiAutoLayout: true, showTree: true, railTab: "ai", viewMode: "split" });
        break;
      case "editor-preview":
        set((s) => ({
          showTree: true,
          railTab: s.railTab === "ai" || s.railTab === "chat" ? "files" : s.railTab,
          viewMode: "split",
        }));
        break;
      case "editor-ai":
        set({ suppressAiAutoLayout: true, showTree: true, railTab: "ai", viewMode: "editor" });
        break;
      case "preview-ai":
        set({ suppressAiAutoLayout: true, showTree: true, railTab: "ai", viewMode: "pdf" });
        break;
      case "editor-only":
        set((s) => ({
          showTree: false,
          railTab: s.railTab === "ai" || s.railTab === "chat" ? "files" : s.railTab,
          viewMode: "editor",
        }));
        break;
      case "preview-only":
        set((s) => ({
          showTree: false,
          railTab: s.railTab === "ai" || s.railTab === "chat" ? "files" : s.railTab,
          viewMode: "pdf",
        }));
        break;
    }
  },
  resetToDefaults: () => {
    // Drop the persisted copies so a restart doesn't resurrect old values.
    saveLs("oleafly.vim", PREF_DEFAULTS.vim ? "1" : "0");
    saveLs("oleafly.spellcheck", PREF_DEFAULTS.spellcheck ? "1" : "0");
    saveLs("oleafly.harper", PREF_DEFAULTS.harper ? "1" : "0");
    saveLs("oleafly.harper.regionalism", "1");
    saveLs("oleafly.harper.wordchoice", "1");
    saveLs("oleafly.fontSize", String(PREF_DEFAULTS.editorFontSize));
    saveLs("oleafly.appFontSize", String(PREF_DEFAULTS.appFontSize));
    saveLs("oleafly.appFont", PREF_DEFAULTS.appFontFamily);
    saveLs("oleafly.editorFont", PREF_DEFAULTS.editorFontFamily);
    saveLs("oleafly.editorTheme", PREF_DEFAULTS.editorTheme);
    saveLs("oleafly.defaultView", PREF_DEFAULTS.defaultView);
    saveLs("oleafly.openInTree", PREF_DEFAULTS.openInTree ? "1" : "0");
    saveLs("oleafly.hoverPreview", PREF_DEFAULTS.hoverPreview ? "1" : "0");
    saveLs("oleafly.accent", PREF_DEFAULTS.accentColor);
    saveLs("oleafly.dockPlacement", PREF_DEFAULTS.dockPlacement);
    saveLs("oleafly.bgPattern", PREF_DEFAULTS.bgPattern);
    set({ ...PREF_DEFAULTS });
  },
}));
