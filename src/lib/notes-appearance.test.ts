import { describe, expect, it } from "vitest";
import {
  NOTE_WIDTH_KEY,
  NOTES_APPEARANCE_DEFAULTS,
  NOTES_APPEARANCE_KEYS,
  NOTES_APPEARANCE_STORAGE_KEYS,
  NOTES_CODE_THEMES,
  NOTES_TEXT_REPLACEMENTS,
  TEXT_REPLACEMENT_LIMITS,
  clampNotesFontSize,
  clampNotesLineHeight,
  normalizeNotesSetting,
  notesOption,
  readNotesAppearance,
  type NotesAppearance,
} from "./notes-appearance";
import {
  NOTES_CODE_PALETTE,
  NOTES_TYPEFACE_STACKS,
  notesAppearanceAttributes,
  notesAppearanceVariables,
  notesCodeFont,
  notesHeadingFont,
  notesLineHeightValue,
  notesSettingIsDefault,
  notesTextFont,
  readableForeground,
  resolveNotesCodeTheme,
} from "./notes-appearance-style";

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
      "data-notes-task-box": null,
      "data-notes-field-style": null,
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
        notesTaskBox: "square",
        notesFieldStyle: "underline",
        notesAccentColor: "#db2777",
        notesSpellcheck: false,
      }),
    ).toEqual({
      "data-notes-callout": "bar",
      "data-notes-task-box": "square",
      "data-notes-field-style": "underline",
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
    expect(NOTES_APPEARANCE_DEFAULTS.notesTaskBox).toBe("round");
    expect(normalizeNotesSetting("notesTaskBox", "square")).toBe("square");
    expect(normalizeNotesSetting("notesTaskBox", "oval")).toBe("round");
    expect(NOTES_APPEARANCE_DEFAULTS.notesFieldStyle).toBe("tint");
    expect(NOTES_APPEARANCE_STORAGE_KEYS.notesFieldStyle).toBe("oleafly.notes.fieldStyle");
    expect(normalizeNotesSetting("notesFieldStyle", "outline")).toBe("outline");
    expect(normalizeNotesSetting("notesFieldStyle", "underline")).toBe("underline");
    expect(normalizeNotesSetting("notesFieldStyle", "ghost")).toBe("tint");
    expect(normalizeNotesSetting("notesFieldStyle", null)).toBe("tint");
    expect(NOTES_APPEARANCE_DEFAULTS.notesInfo).toBe("side");
    expect(NOTES_APPEARANCE_STORAGE_KEYS.notesInfo).toBe("oleafly.notes.info");
    expect(normalizeNotesSetting("notesInfo", "inline")).toBe("inline");
    expect(normalizeNotesSetting("notesInfo", "bottom")).toBe("side");
    expect(normalizeNotesSetting("notesInfo", null)).toBe("side");
  });

  it("keeps the TikZ preamble's lines and tabs but drops other control characters and overflow", () => {
    expect(NOTES_APPEARANCE_DEFAULTS.notesTikzPreamble).toBe("");
    expect(normalizeNotesSetting("notesTikzPreamble", "\\usetikzlibrary{calc}\r\n\t\\tikzset{thick}\u0007")).toBe(
      "\\usetikzlibrary{calc}\n\t\\tikzset{thick}",
    );
    expect(normalizeNotesSetting("notesTikzPreamble", "x".repeat(9000))).toHaveLength(8000);
    expect(normalizeNotesSetting("notesTikzPreamble", 3)).toBe("");
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
  });

  it("counts the built-in replacement pairs as the default after a save and a reload", () => {
    const stored = JSON.stringify(NOTES_TEXT_REPLACEMENTS);
    const reloaded = readNotesAppearance((key) => (key === NOTES_APPEARANCE_STORAGE_KEYS.notesTextReplacements ? stored : null));
    expect(reloaded.notesTextReplacements).not.toBe(NOTES_TEXT_REPLACEMENTS);
    expect(notesSettingIsDefault(reloaded, "notesTextReplacements")).toBe(true);
    const saved = { ...defaults(), notesTextReplacements: normalizeNotesSetting("notesTextReplacements", { ...NOTES_TEXT_REPLACEMENTS }) };
    expect(notesSettingIsDefault(saved, "notesTextReplacements")).toBe(true);
    const changed = { ...defaults(), notesTextReplacements: { ...NOTES_TEXT_REPLACEMENTS, "(c)": "©" } };
    expect(notesSettingIsDefault(changed, "notesTextReplacements")).toBe(false);
  });
});

describe("text replacement pairs", () => {
  it("starts with the built-in pairs and keeps a stored list, even an empty one", () => {
    expect(NOTES_APPEARANCE_DEFAULTS.notesTextReplace).toBe(true);
    expect(normalizeNotesSetting("notesTextReplacements", null)).toEqual(NOTES_TEXT_REPLACEMENTS);
    expect(normalizeNotesSetting("notesTextReplacements", "")).toEqual(NOTES_TEXT_REPLACEMENTS);
    expect(normalizeNotesSetting("notesTextReplacements", "{}")).toEqual({});
    expect(normalizeNotesSetting("notesTextReplacements", JSON.stringify({ "(c)": "©" }))).toEqual({ "(c)": "©" });
  });

  it("drops pairs it can't use and caps the list", () => {
    const mixed = { " ": "x", a: "", b: "b", ["x".repeat(TEXT_REPLACEMENT_LIMITS.from + 1)]: "y", ok: "fine", "bad\n": "z" };
    expect(normalizeNotesSetting("notesTextReplacements", mixed)).toEqual({ ok: "fine" });
    expect(normalizeNotesSetting("notesTextReplacements", "not json")).toEqual(NOTES_TEXT_REPLACEMENTS);
    expect(normalizeNotesSetting("notesTextReplacements", ["->"])).toEqual(NOTES_TEXT_REPLACEMENTS);
    const many = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`k${index}`, "v"]));
    expect(Object.keys(normalizeNotesSetting("notesTextReplacements", many))).toHaveLength(TEXT_REPLACEMENT_LIMITS.count);
  });
});
