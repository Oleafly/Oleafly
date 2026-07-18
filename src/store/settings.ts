import { create } from "zustand";

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
  vim: ls("openleaf.vim", "0") === "1",
  toggleVim: () =>
    set((s) => {
      saveLs("openleaf.vim", s.vim ? "0" : "1");
      return { vim: !s.vim };
    }),
  spellcheck: ls("openleaf.spellcheck", "1") !== "0",
  toggleSpellcheck: () =>
    set((s) => {
      saveLs("openleaf.spellcheck", s.spellcheck ? "0" : "1");
      return { spellcheck: !s.spellcheck };
    }),
  harper: ls("openleaf.harper", "1") !== "0",
  setHarper: (v) => {
    saveLs("openleaf.harper", v ? "1" : "0");
    set({ harper: v });
  },
  showRegionalism: ls("openleaf.harper.regionalism", "1") !== "0",
  setShowRegionalism: (v) => {
    saveLs("openleaf.harper.regionalism", v ? "1" : "0");
    set({ showRegionalism: v });
  },
  showWordChoice: ls("openleaf.harper.wordchoice", "1") !== "0",
  setShowWordChoice: (v) => {
    saveLs("openleaf.harper.wordchoice", v ? "1" : "0");
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
  settingsInitialSection: "appearance",
  setSettingsInitialSection: (v) => set({ settingsInitialSection: v }),
  viewMode: "split",
  setViewMode: (v) => set({ viewMode: v }),
  defaultView: (ls("openleaf.defaultView", "split") as ViewMode) || "split",
  setDefaultView: (v) => {
    saveLs("openleaf.defaultView", v);
    set({ defaultView: v });
  },
  hoverPreview: ls("openleaf.hoverPreview", "1") === "1",
  setHoverPreview: (v) => {
    saveLs("openleaf.hoverPreview", v ? "1" : "0");
    set({ hoverPreview: v });
  },
  chatFloating: ls("openleaf.ai.floating", "0") === "1",
  setChatFloating: (v) => {
    saveLs("openleaf.ai.floating", v ? "1" : "0");
    set({ chatFloating: v });
  },
  openInTree: ls("openleaf.openInTree", "0") !== "0",
  setOpenInTree: (v) => {
    saveLs("openleaf.openInTree", v ? "1" : "0");
    set({ openInTree: v });
  },
  editorFontSize: Number(ls("openleaf.fontSize", "13")) || 13,
  setEditorFontSize: (v) => {
    saveLs("openleaf.fontSize", String(v));
    set({ editorFontSize: v });
  },
  appFontSize: Number(ls("openleaf.appFontSize", "16")) || 16,
  setAppFontSize: (v) => {
    saveLs("openleaf.appFontSize", String(v));
    set({ appFontSize: v });
  },
  appFontFamily: ls("openleaf.appFont", ""),
  setAppFontFamily: (v) => {
    saveLs("openleaf.appFont", v);
    set({ appFontFamily: v });
  },
  editorFontFamily: ls("openleaf.editorFont", ""),
  setEditorFontFamily: (v) => {
    saveLs("openleaf.editorFont", v);
    set({ editorFontFamily: v });
  },
  accentColor: ls("openleaf.accent", "#2563eb"),
  setAccentColor: (v) => {
    saveLs("openleaf.accent", v);
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
    saveLs("openleaf.vim", PREF_DEFAULTS.vim ? "1" : "0");
    saveLs("openleaf.spellcheck", PREF_DEFAULTS.spellcheck ? "1" : "0");
    saveLs("openleaf.harper", PREF_DEFAULTS.harper ? "1" : "0");
    saveLs("openleaf.harper.regionalism", "1");
    saveLs("openleaf.harper.wordchoice", "1");
    saveLs("openleaf.fontSize", String(PREF_DEFAULTS.editorFontSize));
    saveLs("openleaf.appFontSize", String(PREF_DEFAULTS.appFontSize));
    saveLs("openleaf.appFont", PREF_DEFAULTS.appFontFamily);
    saveLs("openleaf.editorFont", PREF_DEFAULTS.editorFontFamily);
    saveLs("openleaf.defaultView", PREF_DEFAULTS.defaultView);
    saveLs("openleaf.openInTree", PREF_DEFAULTS.openInTree ? "1" : "0");
    saveLs("openleaf.hoverPreview", PREF_DEFAULTS.hoverPreview ? "1" : "0");
    saveLs("openleaf.accent", PREF_DEFAULTS.accentColor);
    set({ ...PREF_DEFAULTS });
  },
}));
