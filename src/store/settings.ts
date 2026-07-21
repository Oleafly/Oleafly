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

function ls(k: string, fb: string): string {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(k) ?? fb
      : fb;
  } catch {
    return fb;
  }
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

export const ACCENTS: { id: string; name: string; color: string }[] = [
  { id: "blue", name: "Blue", color: "#2563eb" },
  { id: "green", name: "Green", color: "#16a34a" },
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
  diagramComposerOpen: boolean;
  setDiagramComposerOpen: (v: boolean) => void;
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
  defaultView: ViewMode;
  setDefaultView: (v: ViewMode) => void;
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
  accentColor: string;
  setAccentColor: (v: string) => void;
  showTree: boolean;
  toggleTree: () => void;
  hotkeysOpen: boolean;
  setHotkeysOpen: (v: boolean) => void;
  railTab: RailTab;
  setRailTab: (v: RailTab) => void;
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
  defaultView: "split" as ViewMode,
  openInTree: false,
  hoverPreview: true,
  accentColor: "#2563eb",
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
  diagramComposerOpen: false,
  setDiagramComposerOpen: (v) => set({ diagramComposerOpen: v }),
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
  defaultView: (ls("oleafly.defaultView", "split") as ViewMode) || "split",
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
  accentColor: ls("oleafly.accent", "#2563eb"),
  setAccentColor: (v) => {
    saveLs("oleafly.accent", v);
    set({ accentColor: v });
  },
  showTree: true,
  toggleTree: () => set((s) => ({ showTree: !s.showTree })),
  hotkeysOpen: false,
  setHotkeysOpen: (v) => set({ hotkeysOpen: v }),
  railTab: "files",
  setRailTab: (v) => set({ railTab: v }),
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
    saveLs("oleafly.defaultView", PREF_DEFAULTS.defaultView);
    saveLs("oleafly.openInTree", PREF_DEFAULTS.openInTree ? "1" : "0");
    saveLs("oleafly.hoverPreview", PREF_DEFAULTS.hoverPreview ? "1" : "0");
    saveLs("oleafly.accent", PREF_DEFAULTS.accentColor);
    set({ ...PREF_DEFAULTS });
  },
}));
