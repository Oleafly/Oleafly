// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTES_APPEARANCE_DEFAULTS, NOTES_APPEARANCE_STORAGE_KEYS } from "@/lib/notes-appearance";
import { SECTION_SETTINGS, sectionDiffersFromDefaults, useSettingsStore } from "./settings";

const KEYS = NOTES_APPEARANCE_STORAGE_KEYS;

async function reload(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  vi.resetModules();
  return (await import("./settings")).useSettingsStore.getState();
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ ...NOTES_APPEARANCE_DEFAULTS });
});

describe("Notes appearance in the settings store", () => {
  it("starts with the look Notes had before the settings existed", async () => {
    const state = await reload({});
    for (const [key, value] of Object.entries(NOTES_APPEARANCE_DEFAULTS)) {
      expect(state[key as keyof typeof NOTES_APPEARANCE_DEFAULTS], key).toEqual(value);
    }
  });

  it("reads what was saved, and ignores what it cannot use", async () => {
    const state = await reload({
      [KEYS.notesTypeface]: "serif",
      [KEYS.notesFontSize]: "17.5",
      [KEYS.notesWidth]: "wide",
      [KEYS.notesShowWordCount]: "0",
      [KEYS.notesAccentColor]: "#DB2777",
      [KEYS.notesCalloutStyle]: "neon",
      [KEYS.notesTitleSize]: "31",
    });
    expect(state).toMatchObject({
      notesTypeface: "serif",
      notesFontSize: 17.5,
      notesWidth: "wide",
      notesShowWordCount: false,
      notesAccentColor: "#db2777",
      notesCalloutStyle: "tinted",
      notesTitleSize: 24,
    });
  });

  it("saves each change in the format it reads back", async () => {
    const { setNotesAppearance } = useSettingsStore.getState();
    setNotesAppearance("notesFontSize", 300);
    setNotesAppearance("notesSpellcheck", false);
    setNotesAppearance("notesHeadingFontFamily", "Lora");
    setNotesAppearance("notesCodeTheme", "nord");
    expect(useSettingsStore.getState()).toMatchObject({
      notesFontSize: 40,
      notesSpellcheck: false,
      notesHeadingFontFamily: "Lora",
      notesCodeTheme: "nord",
    });
    expect(localStorage.getItem(KEYS.notesFontSize)).toBe("40");
    expect(localStorage.getItem(KEYS.notesSpellcheck)).toBe("0");
    const state = await reload({});
    expect(state).toMatchObject({ notesFontSize: 40, notesSpellcheck: false, notesHeadingFontFamily: "Lora" });
  });

  it("starts a custom line height from the spacing that was chosen", () => {
    const { setNotesAppearance } = useSettingsStore.getState();
    setNotesAppearance("notesLineHeight", "wide");
    setNotesAppearance("notesLineHeight", "custom");
    expect(useSettingsStore.getState()).toMatchObject({ notesLineHeight: "custom", notesCustomLineHeight: 2 });
    expect(localStorage.getItem(KEYS.notesCustomLineHeight)).toBe("2");
    setNotesAppearance("notesCustomLineHeight", 2.4);
    setNotesAppearance("notesLineHeight", "compact");
    setNotesAppearance("notesLineHeight", "custom");
    expect(useSettingsStore.getState().notesCustomLineHeight).toBe(2.4);
    setNotesAppearance("notesLineHeight", "custom");
    expect(useSettingsStore.getState().notesLineHeight).toBe("custom");
  });

  it("resets only the Notes appearance, and the Appearance reset includes it", () => {
    const store = useSettingsStore.getState();
    store.setNotesAppearance("notesTypeface", "mono");
    store.setNotesAppearance("notesWidth", "full");
    store.setEditorFontSize(18);
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(true);

    useSettingsStore.getState().resetNotesAppearance();
    expect(useSettingsStore.getState()).toMatchObject({ notesTypeface: "sans", notesWidth: "standard", editorFontSize: 18 });
    expect(localStorage.getItem(KEYS.notesTypeface)).toBe("sans");
    expect(localStorage.getItem(KEYS.notesWidth)).toBe("standard");

    useSettingsStore.getState().setNotesAppearance("notesHighlightColor", "green");
    useSettingsStore.getState().resetAppearancePreferences();
    expect(useSettingsStore.getState().notesHighlightColor).toBe("yellow");
    expect(localStorage.getItem(KEYS.notesHighlightColor)).toBe("yellow");
  });

  it("lists every Notes key in the Appearance section", () => {
    expect(SECTION_SETTINGS.appearance).toMatchObject(KEYS);
  });
});
