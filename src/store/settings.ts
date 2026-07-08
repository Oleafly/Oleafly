import { create } from "zustand";

export type ViewMode = "split" | "editor" | "pdf";
export type RailTab = "files" | "search" | "ai" | "source" | "review" | "chat";

/** Read a persisted setting (cosmetics survive restarts, like the theme). */
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

/** Preset accent colors. The default is primary blue. */
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
  editorFontSize: number;
  setEditorFontSize: (v: number) => void;
  accentColor: string;
  setAccentColor: (v: string) => void;
  showTree: boolean;
  toggleTree: () => void;
  hotkeysOpen: boolean;
  setHotkeysOpen: (v: boolean) => void;
  railTab: RailTab;
  setRailTab: (v: RailTab) => void;
  /** Restore Appearance + General preferences to their factory defaults. */
  resetToDefaults: () => void;
}

/** Factory defaults for the user-facing Appearance + General preferences. */
const PREF_DEFAULTS = {
  vim: false,
  spellcheck: true,
  harper: true,
  showRegionalism: true,
  showWordChoice: true,
  offline: false,
  editorFontSize: 13,
  accentColor: "#2563eb",
} as const;

export const useSettingsStore = create<SettingsState>((set) => ({
  vim: false,
  toggleVim: () => set((s) => ({ vim: !s.vim })),
  spellcheck: true,
  toggleSpellcheck: () => set((s) => ({ spellcheck: !s.spellcheck })),
  harper: true,
  setHarper: (v) => set({ harper: v }),
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
  editorFontSize: Number(ls("openleaf.fontSize", "13")) || 13,
  setEditorFontSize: (v) => {
    saveLs("openleaf.fontSize", String(v));
    set({ editorFontSize: v });
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
    saveLs("openleaf.harper.regionalism", "1");
    saveLs("openleaf.harper.wordchoice", "1");
    saveLs("openleaf.fontSize", String(PREF_DEFAULTS.editorFontSize));
    saveLs("openleaf.accent", PREF_DEFAULTS.accentColor);
    set({ ...PREF_DEFAULTS });
  },
}));
