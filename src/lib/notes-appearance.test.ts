import { describe, expect, it } from "vitest";
import {
  NOTE_WIDTH_KEY,
  NOTES_APPEARANCE_DEFAULTS,
  NOTES_APPEARANCE_KEYS,
  NOTES_APPEARANCE_STORAGE_KEYS,
  NOTES_CODE_PALETTE,
  NOTES_CODE_THEMES,
  NOTES_TYPEFACE_STACKS,
  clampNotesFontSize,
  clampNotesLineHeight,
  normalizeNotesSetting,
  notesAppearanceAttributes,
  notesAppearanceDiffersFromDefaults,
  notesAppearanceVariables,
  notesCodeFont,
  notesHeadingFont,
  notesLineHeightValue,
  notesOption,
  notesSettingIsDefault,
  notesTextFont,
  readNotesAppearance,
  readableForeground,
  resolveNotesCodeTheme,
  type NotesAppearance,
} from "./notes-appearance";

const defaults = (): NotesAppearance => ({ ...NOTES_APPEARANCE_DEFAULTS });

describe("Notes appearance defaults", () => {
  it("map to the values Notes used before the settings existed", () => {
    expect(notesAppearanceVariables(defaults())).toEqual({
      "--notes-text-font": "var(--font-sans)",
      "--notes-text-size": "0.9375rem",
      "--notes-line-height": "1.7",
      "--notes-block-gap": "0.75em",
      "--notes-heading-font": "var(--font-sans)",
      "--notes-h1": "1.5em",
      "--notes-h2": "1.25em",
      "--notes-h3": "1.1em",
      "--notes-title-size": "1.5rem",
      "--notes-code-font": "var(--font-mono)",
    });
    expect(notesAppearanceAttributes(defaults())).toEqual({
      "data-notes-callout": null,
      "data-notes-highlight": null,
      "data-notes-accent": null,
      spellcheck: null,
    });
  });

  it("store every setting under its own key and keep the width key the toolbar used", () => {
    expect(NOTES_APPEARANCE_STORAGE_KEYS.notesWidth).toBe(NOTE_WIDTH_KEY);
    expect(Object.keys(NOTES_APPEARANCE_STORAGE_KEYS).sort()).toEqual([...NOTES_APPEARANCE_KEYS].sort());
    expect(new Set(Object.values(NOTES_APPEARANCE_STORAGE_KEYS)).size).toBe(NOTES_APPEARANCE_KEYS.length);
  });

  it("offers the app and editor choices before every editor theme", () => {
    expect(NOTES_CODE_THEMES.slice(0, 2)).toEqual(["system", "editor"]);
    expect(NOTES_CODE_THEMES).toContain("dracula");
    expect(NOTES_CODE_THEMES.filter((theme) => theme === "system")).toHaveLength(1);
    expect(NOTES_CODE_PALETTE.map(([source]) => source)).toContain("--cm-keyword");
  });
});

describe("Notes fonts", () => {
  it("uses the typeface stack until a font is named, and falls back to it", () => {
    expect(notesTextFont({ notesTypeface: "serif", notesFontFamily: "" })).toBe(NOTES_TYPEFACE_STACKS.serif);
    expect(notesTextFont({ notesTypeface: "serif", notesFontFamily: "Charter" })).toBe(
      `"Charter", ${NOTES_TYPEFACE_STACKS.serif}`,
    );
    expect(notesTextFont({ notesTypeface: "mono", notesFontFamily: "  " })).toBe("var(--font-mono)");
  });

  it("gives headings the text font, a typeface of their own, or a named font", () => {
    const base = { notesTypeface: "serif", notesFontFamily: "Lora", notesHeadingFontFamily: "" } as const;
    expect(notesHeadingFont({ ...base, notesHeadingTypeface: "text" })).toBe(`"Lora", ${NOTES_TYPEFACE_STACKS.serif}`);
    expect(notesHeadingFont({ ...base, notesHeadingTypeface: "sans" })).toBe("var(--font-sans)");
    expect(notesHeadingFont({ ...base, notesHeadingTypeface: "mono", notesHeadingFontFamily: "Iosevka" })).toBe(
      '"Iosevka", var(--font-mono)',
    );
  });

  it("puts a named code font in front of the monospace stack", () => {
    expect(notesCodeFont({ notesCodeFontFamily: "" })).toBe("var(--font-mono)");
    expect(notesCodeFont({ notesCodeFontFamily: "Fira Code" })).toBe('"Fira Code", var(--font-mono)');
  });
});

describe("Notes variables", () => {
  it("follows every choice", () => {
    const variables = notesAppearanceVariables({
      ...defaults(),
      notesFontSize: 18,
      notesLineHeight: "custom",
      notesCustomLineHeight: 2.25,
      notesParagraphSpacing: "spacious",
      notesHeadingSize: "large",
      notesTitleSize: 32,
      notesAccentColor: "#0d9488",
    });
    expect(variables).toMatchObject({
      "--notes-text-size": "1.125rem",
      "--notes-line-height": "2.25",
      "--notes-block-gap": "1.5em",
      "--notes-h1": "1.8em",
      "--notes-h2": "1.45em",
      "--notes-h3": "1.2em",
      "--notes-title-size": "2rem",
      "--notes-accent": "#0d9488",
      "--notes-accent-foreground": "#ffffff",
    });
    expect(notesAppearanceVariables({ ...defaults(), notesLineHeight: "compact" })["--notes-line-height"]).toBe("1.5");
  });

  it("marks the root only for choices that differ from the plain look", () => {
    expect(
      notesAppearanceAttributes({
        ...defaults(),
        notesCalloutStyle: "bar",
        notesHighlightColor: "accent",
        notesAccentColor: "#db2777",
        notesSpellcheck: false,
      }),
    ).toEqual({
      "data-notes-callout": "bar",
      "data-notes-highlight": "accent",
      "data-notes-accent": "",
      spellcheck: "false",
    });
  });

  it("picks dark text for a light accent and white for anything else", () => {
    expect(readableForeground("#fde047")).toBe("#111111");
    expect(readableForeground("#2563eb")).toBe("#ffffff");
    expect(readableForeground("#010101")).toBe("#ffffff");
    expect(readableForeground("blue")).toBe("#ffffff");
  });

  it("reads the editor's theme for the current mode when code follows the editor", () => {
    const editor = { light: "paper", dark: "dracula" } as const;
    expect(resolveNotesCodeTheme("editor", "light", editor)).toBe("paper");
    expect(resolveNotesCodeTheme("editor", "dark", editor)).toBe("dracula");
    expect(resolveNotesCodeTheme("nord", "light", editor)).toBe("nord");
  });
});

describe("Notes number limits", () => {
  it("keeps sizes and line heights inside their ranges", () => {
    expect(clampNotesFontSize(Number.NaN)).toBe(15);
    expect(clampNotesFontSize(2)).toBe(10);
    expect(clampNotesFontSize(99)).toBe(40);
    expect(clampNotesFontSize(13.46)).toBe(13.5);
    expect(clampNotesLineHeight(Number.POSITIVE_INFINITY)).toBe(1.7);
    expect(clampNotesLineHeight(0.2)).toBe(1);
    expect(clampNotesLineHeight(9)).toBe(3);
    expect(clampNotesLineHeight(1.234)).toBe(1.23);
    expect(notesLineHeightValue("custom", 7)).toBe(3);
    expect(notesLineHeightValue("wide", 1.2)).toBe(2);
  });
});

describe("normalizing a Notes setting", () => {
  it("keeps only the choices it knows", () => {
    expect(notesOption(["a", "b"], "b", "a")).toBe("b");
    expect(notesOption(["a", "b"], "c", "a")).toBe("a");
    expect(normalizeNotesSetting("notesTypeface", "serif")).toBe("serif");
    expect(normalizeNotesSetting("notesTypeface", "comic")).toBe("sans");
    expect(normalizeNotesSetting("notesWidth", "full")).toBe("full");
    expect(normalizeNotesSetting("notesWidth", 3)).toBe("standard");
    expect(normalizeNotesSetting("notesCodeTheme", "editor")).toBe("editor");
    expect(normalizeNotesSetting("notesCalloutStyle", "outlined")).toBe("outlined");
    expect(normalizeNotesSetting("notesHighlightColor", "orange")).toBe("yellow");
  });

  it("cleans font names", () => {
    expect(normalizeNotesSetting("notesFontFamily", "Lora\u0007")).toBe("Lora");
    expect(normalizeNotesSetting("notesHeadingFontFamily", 12)).toBe("");
    expect(normalizeNotesSetting("notesCodeFontFamily", "x".repeat(300))).toHaveLength(200);
  });

  it("reads numbers from storage text and typed values", () => {
    expect(normalizeNotesSetting("notesFontSize", "17")).toBe(17);
    expect(normalizeNotesSetting("notesFontSize", 300)).toBe(40);
    expect(normalizeNotesSetting("notesFontSize", "")).toBe(15);
    expect(normalizeNotesSetting("notesFontSize", null)).toBe(15);
    expect(normalizeNotesSetting("notesFontSize", "big")).toBe(15);
    expect(normalizeNotesSetting("notesCustomLineHeight", undefined)).toBe(1.7);
    expect(normalizeNotesSetting("notesTitleSize", "32")).toBe(32);
    expect(normalizeNotesSetting("notesTitleSize", 33)).toBe(24);
    expect(normalizeNotesSetting("notesTitleSize", "")).toBe(24);
  });

  it("reads switches and colors", () => {
    expect(normalizeNotesSetting("notesShowWordCount", "0")).toBe(false);
    expect(normalizeNotesSetting("notesShowWordCount", false)).toBe(false);
    expect(normalizeNotesSetting("notesShowWordCount", "1")).toBe(true);
    expect(normalizeNotesSetting("notesSpellcheck", true)).toBe(true);
    expect(normalizeNotesSetting("notesSpellcheck", "maybe")).toBe(true);
    expect(normalizeNotesSetting("notesAccentColor", "#ABCDEF")).toBe("#abcdef");
    expect(normalizeNotesSetting("notesAccentColor", "red")).toBe("");
    expect(normalizeNotesSetting("notesAccentColor", 5)).toBe("");
  });

  it("reads a whole saved set and falls back for what is missing", () => {
    const saved: Record<string, string> = {
      [NOTES_APPEARANCE_STORAGE_KEYS.notesTypeface]: "mono",
      [NOTES_APPEARANCE_STORAGE_KEYS.notesFontSize]: "18",
      [NOTES_APPEARANCE_STORAGE_KEYS.notesSpellcheck]: "0",
    };
    const appearance = readNotesAppearance((key) => saved[key] ?? null);
    expect(appearance).toEqual({ ...defaults(), notesTypeface: "mono", notesFontSize: 18, notesSpellcheck: false });
  });
});

describe("comparing with the defaults", () => {
  it("tells which Notes keys differ", () => {
    const state = { ...defaults(), accentColor: "#123456", notesTitleSize: 28 };
    expect(notesSettingIsDefault(state, "notesTypeface")).toBe(true);
    expect(notesSettingIsDefault(state, "notesTitleSize")).toBe(false);
    expect(notesAppearanceDiffersFromDefaults(state)).toBe(true);
    expect(notesAppearanceDiffersFromDefaults(defaults())).toBe(false);
  });
});
