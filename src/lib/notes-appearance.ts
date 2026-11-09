import { EDITOR_THEME_IDS, type EditorThemeId } from "@/lib/editor-themes";
import { fontFamilyName, fontFamilyStack, withoutControlCharacters } from "@/lib/font-families";
import { hexLuminance } from "@/lib/peer-colors";

export type NoteWidth = "standard" | "wide" | "full";
export const NOTE_WIDTHS: readonly NoteWidth[] = ["standard", "wide", "full"];
export const NOTE_WIDTH_KEY = "oleafly.notes.width";

export type NotesTypeface = "sans" | "serif" | "mono";
export const NOTES_TYPEFACES: readonly NotesTypeface[] = ["sans", "serif", "mono"];

export type NotesHeadingTypeface = "text" | NotesTypeface;
export const NOTES_HEADING_TYPEFACES: readonly NotesHeadingTypeface[] = ["text", ...NOTES_TYPEFACES];

export const NOTES_TYPEFACE_STACKS: Readonly<Record<NotesTypeface, string>> = {
  sans: "var(--font-sans)",
  serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Charter, Georgia, Cambria, "Times New Roman", serif',
  mono: "var(--font-mono)",
};

export const NOTES_FONT_SIZES: readonly number[] = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24];
export const NOTES_FONT_SIZE_RANGE = { min: 10, max: 40, step: 1 } as const;

export type NotesLineHeightPreset = "compact" | "normal" | "wide";
export type NotesLineHeight = NotesLineHeightPreset | "custom";
export const NOTES_LINE_HEIGHTS: Readonly<Record<NotesLineHeightPreset, number>> = {
  compact: 1.5,
  normal: 1.7,
  wide: 2,
};
export const NOTES_LINE_HEIGHT_OPTIONS: readonly NotesLineHeight[] = ["compact", "normal", "wide", "custom"];
export const NOTES_CUSTOM_LINE_HEIGHT = { min: 1, max: 3, step: 0.05 } as const;

export type NotesParagraphSpacing = "compact" | "normal" | "relaxed" | "spacious";
export const NOTES_PARAGRAPH_SPACINGS: Readonly<Record<NotesParagraphSpacing, number>> = {
  compact: 0.4,
  normal: 0.75,
  relaxed: 1.1,
  spacious: 1.5,
};
export const NOTES_PARAGRAPH_SPACING_OPTIONS: readonly NotesParagraphSpacing[] = [
  "compact",
  "normal",
  "relaxed",
  "spacious",
];

export type NotesHeadingSize = "small" | "normal" | "large";
export const NOTES_HEADING_SCALES: Readonly<Record<NotesHeadingSize, readonly [number, number, number]>> = {
  small: [1.3, 1.15, 1.05],
  normal: [1.5, 1.25, 1.1],
  large: [1.8, 1.45, 1.2],
};
export const NOTES_HEADING_SIZES: readonly NotesHeadingSize[] = ["small", "normal", "large"];

export const NOTES_TITLE_SIZES: readonly number[] = [20, 24, 28, 32, 36, 40];

export type NotesCodeTheme = "editor" | EditorThemeId;
export const NOTES_CODE_THEMES: readonly NotesCodeTheme[] = [
  "system",
  "editor",
  ...EDITOR_THEME_IDS.filter((id) => id !== "system"),
];

export type NotesHighlightColor = "yellow" | "green" | "blue" | "pink" | "purple" | "accent";
export const NOTES_HIGHLIGHT_COLORS: readonly NotesHighlightColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
  "accent",
];

export type NotesCalloutStyle = "tinted" | "filled" | "outlined" | "bar";
export const NOTES_CALLOUT_STYLES: readonly NotesCalloutStyle[] = ["tinted", "filled", "outlined", "bar"];

export const NOTES_APPEARANCE_DEFAULTS = {
  notesTypeface: "sans" as NotesTypeface,
  notesFontFamily: "",
  notesFontSize: 15,
  notesLineHeight: "normal" as NotesLineHeight,
  notesCustomLineHeight: NOTES_LINE_HEIGHTS.normal,
  notesParagraphSpacing: "normal" as NotesParagraphSpacing,
  notesHeadingTypeface: "text" as NotesHeadingTypeface,
  notesHeadingFontFamily: "",
  notesHeadingSize: "normal" as NotesHeadingSize,
  notesTitleSize: 24,
  notesWidth: "standard" as NoteWidth,
  notesCodeFontFamily: "",
  notesCodeTheme: "system" as NotesCodeTheme,
  notesAccentColor: "",
  notesHighlightColor: "yellow" as NotesHighlightColor,
  notesCalloutStyle: "tinted" as NotesCalloutStyle,
  notesShowWordCount: true,
  notesSpellcheck: true,
};

export type NotesAppearance = typeof NOTES_APPEARANCE_DEFAULTS;
export type NotesAppearanceKey = keyof NotesAppearance;

export const NOTES_APPEARANCE_KEYS = Object.keys(NOTES_APPEARANCE_DEFAULTS) as NotesAppearanceKey[];

export const NOTES_APPEARANCE_STORAGE_KEYS: Readonly<Record<NotesAppearanceKey, string>> = {
  notesTypeface: "oleafly.notes.typeface",
  notesFontFamily: "oleafly.notes.font",
  notesFontSize: "oleafly.notes.fontSize",
  notesLineHeight: "oleafly.notes.lineHeight",
  notesCustomLineHeight: "oleafly.notes.lineHeightCustom",
  notesParagraphSpacing: "oleafly.notes.paragraphSpacing",
  notesHeadingTypeface: "oleafly.notes.headingTypeface",
  notesHeadingFontFamily: "oleafly.notes.headingFont",
  notesHeadingSize: "oleafly.notes.headingSize",
  notesTitleSize: "oleafly.notes.titleSize",
  notesWidth: NOTE_WIDTH_KEY,
  notesCodeFontFamily: "oleafly.notes.codeFont",
  notesCodeTheme: "oleafly.notes.codeTheme",
  notesAccentColor: "oleafly.notes.accent",
  notesHighlightColor: "oleafly.notes.highlight",
  notesCalloutStyle: "oleafly.notes.calloutStyle",
  notesShowWordCount: "oleafly.notes.wordCount",
  notesSpellcheck: "oleafly.notes.spellcheck",
};

export function notesOption<T extends string>(options: readonly T[], raw: unknown, fallback: T): T {
  return options.find((option) => option === raw) ?? fallback;
}

type Normalizer<K extends NotesAppearanceKey> = (raw: unknown) => NotesAppearance[K];

function option<K extends NotesAppearanceKey>(key: K, options: readonly string[]): Normalizer<K> {
  return (raw) => notesOption(options, raw, NOTES_APPEARANCE_DEFAULTS[key] as string) as NotesAppearance[K];
}

function family(raw: unknown): string {
  return typeof raw === "string" ? withoutControlCharacters(raw).slice(0, 200) : "";
}

function numeric(fallback: number, clamp: (value: number) => number): (raw: unknown) => number {
  return (raw) => {
    if (raw === null || raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value) : fallback;
  };
}

function toggle(fallback: boolean): (raw: unknown) => boolean {
  return (raw) => {
    if (raw === true || raw === "1") return true;
    if (raw === false || raw === "0") return false;
    return fallback;
  };
}

function hex(raw: unknown): string {
  return typeof raw === "string" && /^#[\da-f]{6}$/iu.test(raw) ? raw.toLowerCase() : "";
}

function titleSize(raw: unknown): number {
  const value = Number(raw);
  return raw !== "" && NOTES_TITLE_SIZES.includes(value) ? value : NOTES_APPEARANCE_DEFAULTS.notesTitleSize;
}

const NORMALIZERS: { readonly [K in NotesAppearanceKey]: Normalizer<K> } = {
  notesTypeface: option("notesTypeface", NOTES_TYPEFACES),
  notesFontFamily: family,
  notesFontSize: numeric(NOTES_APPEARANCE_DEFAULTS.notesFontSize, clampNotesFontSize),
  notesLineHeight: option("notesLineHeight", NOTES_LINE_HEIGHT_OPTIONS),
  notesCustomLineHeight: numeric(NOTES_APPEARANCE_DEFAULTS.notesCustomLineHeight, clampNotesLineHeight),
  notesParagraphSpacing: option("notesParagraphSpacing", NOTES_PARAGRAPH_SPACING_OPTIONS),
  notesHeadingTypeface: option("notesHeadingTypeface", NOTES_HEADING_TYPEFACES),
  notesHeadingFontFamily: family,
  notesHeadingSize: option("notesHeadingSize", NOTES_HEADING_SIZES),
  notesTitleSize: titleSize,
  notesWidth: option("notesWidth", NOTE_WIDTHS),
  notesCodeFontFamily: family,
  notesCodeTheme: option("notesCodeTheme", NOTES_CODE_THEMES),
  notesAccentColor: hex,
  notesHighlightColor: option("notesHighlightColor", NOTES_HIGHLIGHT_COLORS),
  notesCalloutStyle: option("notesCalloutStyle", NOTES_CALLOUT_STYLES),
  notesShowWordCount: toggle(NOTES_APPEARANCE_DEFAULTS.notesShowWordCount),
  notesSpellcheck: toggle(NOTES_APPEARANCE_DEFAULTS.notesSpellcheck),
};

export function normalizeNotesSetting<K extends NotesAppearanceKey>(key: K, raw: unknown): NotesAppearance[K] {
  return NORMALIZERS[key](raw);
}

export function readNotesAppearance(read: (storageKey: string) => string | null): NotesAppearance {
  const appearance: Record<string, unknown> = {};
  for (const key of NOTES_APPEARANCE_KEYS) {
    appearance[key] = normalizeNotesSetting(key, read(NOTES_APPEARANCE_STORAGE_KEYS[key]));
  }
  return appearance as NotesAppearance;
}

export function notesSettingIsDefault(state: Readonly<NotesAppearance>, key: NotesAppearanceKey): boolean {
  return Object.is(state[key], NOTES_APPEARANCE_DEFAULTS[key]);
}

export function notesAppearanceDiffersFromDefaults(state: Readonly<NotesAppearance>): boolean {
  return NOTES_APPEARANCE_KEYS.some((key) => !notesSettingIsDefault(state, key));
}

export function clampNotesFontSize(value: number): number {
  if (!Number.isFinite(value)) return NOTES_APPEARANCE_DEFAULTS.notesFontSize;
  const { min, max } = NOTES_FONT_SIZE_RANGE;
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

export function clampNotesLineHeight(value: number): number {
  if (!Number.isFinite(value)) return NOTES_LINE_HEIGHTS.normal;
  const { min, max } = NOTES_CUSTOM_LINE_HEIGHT;
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

export function notesLineHeightValue(choice: NotesLineHeight, custom: number): number {
  return choice === "custom" ? clampNotesLineHeight(custom) : NOTES_LINE_HEIGHTS[choice];
}

function rem(pixels: number): string {
  return `${pixels / 16}rem`;
}

function familyOr(name: string, fallback: string): string {
  return fontFamilyName(name) ? fontFamilyStack(name, fallback) : fallback;
}

export function notesTextFont(appearance: Pick<NotesAppearance, "notesTypeface" | "notesFontFamily">): string {
  return familyOr(appearance.notesFontFamily, NOTES_TYPEFACE_STACKS[appearance.notesTypeface]);
}

export function notesHeadingFont(
  appearance: Pick<NotesAppearance, "notesTypeface" | "notesFontFamily" | "notesHeadingTypeface" | "notesHeadingFontFamily">,
): string {
  const typeface =
    appearance.notesHeadingTypeface === "text"
      ? notesTextFont(appearance)
      : NOTES_TYPEFACE_STACKS[appearance.notesHeadingTypeface];
  return familyOr(appearance.notesHeadingFontFamily, typeface);
}

export function notesCodeFont(appearance: Pick<NotesAppearance, "notesCodeFontFamily">): string {
  return familyOr(appearance.notesCodeFontFamily, "var(--font-mono)");
}

export function notesAppearanceVariables(appearance: NotesAppearance): Record<string, string> {
  const [h1, h2, h3] = NOTES_HEADING_SCALES[appearance.notesHeadingSize];
  const variables: Record<string, string> = {
    "--notes-text-font": notesTextFont(appearance),
    "--notes-text-size": rem(appearance.notesFontSize),
    "--notes-line-height": String(notesLineHeightValue(appearance.notesLineHeight, appearance.notesCustomLineHeight)),
    "--notes-block-gap": `${NOTES_PARAGRAPH_SPACINGS[appearance.notesParagraphSpacing]}em`,
    "--notes-heading-font": notesHeadingFont(appearance),
    "--notes-h1": `${h1}em`,
    "--notes-h2": `${h2}em`,
    "--notes-h3": `${h3}em`,
    "--notes-title-size": rem(appearance.notesTitleSize),
    "--notes-code-font": notesCodeFont(appearance),
  };
  if (appearance.notesAccentColor) {
    variables["--notes-accent"] = appearance.notesAccentColor;
    variables["--notes-accent-foreground"] = readableForeground(appearance.notesAccentColor);
  }
  return variables;
}

export function notesAppearanceAttributes(appearance: NotesAppearance): Record<string, string | null> {
  return {
    "data-notes-callout": appearance.notesCalloutStyle === "tinted" ? null : appearance.notesCalloutStyle,
    "data-notes-highlight": appearance.notesHighlightColor === "yellow" ? null : appearance.notesHighlightColor,
    "data-notes-accent": appearance.notesAccentColor ? "" : null,
    spellcheck: appearance.notesSpellcheck ? null : "false",
  };
}

export function readableForeground(hex: string): string {
  const luminance = hexLuminance(hex);
  return luminance !== null && luminance > 0.4 ? "#111111" : "#ffffff";
}

export function resolveNotesCodeTheme(
  codeTheme: NotesCodeTheme,
  mode: "light" | "dark",
  editorThemes: Readonly<Record<"light" | "dark", EditorThemeId>>,
): EditorThemeId {
  return codeTheme === "editor" ? editorThemes[mode] : codeTheme;
}

export const NOTES_CODE_PALETTE: readonly (readonly [source: string, target: string])[] = [
  ["--cm-editor-bg", "--notes-code-bg"],
  ["--cm-editor-fg", "--notes-code-fg"],
  ["--cm-comment", "--notes-code-comment"],
  ["--cm-keyword", "--notes-code-keyword"],
  ["--cm-number", "--notes-code-number"],
  ["--cm-string", "--notes-code-string"],
  ["--cm-bracket", "--notes-code-bracket"],
  ["--cm-variable", "--notes-code-variable"],
  ["--cm-meta", "--notes-code-meta"],
  ["--cm-tag", "--notes-code-tag"],
  ["--cm-operator", "--notes-code-operator"],
];
