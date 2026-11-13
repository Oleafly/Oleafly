import { EDITOR_THEME_IDS, type EditorThemeId } from "@/lib/editor-themes";
import { withoutControlCharacters } from "@/lib/font-families";

export type NoteWidth = "standard" | "wide" | "full";
export const NOTE_WIDTHS: readonly NoteWidth[] = ["standard", "wide", "full"];
export const NOTE_WIDTH_KEY = "oleafly.notes.width";

export type NotesTypeface = "sans" | "serif" | "mono";
export const NOTES_TYPEFACES: readonly NotesTypeface[] = ["sans", "serif", "mono"];

export type NotesHeadingTypeface = "text" | NotesTypeface;
export const NOTES_HEADING_TYPEFACES: readonly NotesHeadingTypeface[] = ["text", ...NOTES_TYPEFACES];

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
export const NOTES_PARAGRAPH_SPACING_OPTIONS: readonly NotesParagraphSpacing[] = [
  "compact",
  "normal",
  "relaxed",
  "spacious",
];

export type NotesHeadingSize = "small" | "normal" | "large";
export const NOTES_HEADING_SIZES: readonly NotesHeadingSize[] = ["small", "normal", "large"];

export const NOTES_TITLE_SIZES: readonly number[] = [20, 24, 28, 32, 36, 40];

export type NotesCodeTheme = "editor" | EditorThemeId;
export const NOTES_CODE_THEMES: readonly NotesCodeTheme[] = [
  "system",
  "editor",
  ...EDITOR_THEME_IDS.filter((id) => id !== "system"),
];

export type NotesHighlightColor = "yellow" | "orange" | "red" | "pink" | "purple" | "blue" | "green";
export const NOTES_HIGHLIGHT_COLORS: readonly NotesHighlightColor[] = ["yellow", "orange", "red", "pink", "purple", "blue", "green"];

export type NotesCalloutStyle = "tinted" | "filled" | "outlined" | "bar";
export const NOTES_CALLOUT_STYLES: readonly NotesCalloutStyle[] = ["tinted", "filled", "outlined", "bar"];

export type NotesTaskBox = "square" | "round";
export const NOTES_TASK_BOXES: readonly NotesTaskBox[] = ["square", "round"];

export type NotesFieldStyle = "tint" | "outline" | "underline";
export const NOTES_FIELD_STYLES: readonly NotesFieldStyle[] = ["tint", "outline", "underline"];

export type NotesInfoPlace = "side" | "inline";
export const NOTES_INFO_PLACES: readonly NotesInfoPlace[] = ["side", "inline"];

export type TextReplacements = Readonly<Record<string, string>>;
export const TEXT_REPLACEMENT_LIMITS = { count: 100, from: 16, to: 32 } as const;
export const NOTES_TEXT_REPLACEMENTS: TextReplacements = {
  "->": "→",
  "<-": "←",
  "=>": "⇒",
  "!=": "≠",
  "<=": "≤",
  ">=": "≥",
  "+-": "±",
  "...": "…",
  "--": "—",
};

export function textReplacementPair(from: unknown, to: unknown): [string, string] | null {
  if (typeof from !== "string" || typeof to !== "string") return null;
  const trigger = withoutControlCharacters(from);
  const replacement = withoutControlCharacters(to);
  if (trigger.trim() === "" || replacement === "" || trigger === replacement) return null;
  if (trigger.length > TEXT_REPLACEMENT_LIMITS.from || replacement.length > TEXT_REPLACEMENT_LIMITS.to) return null;
  return trigger === from && replacement === to ? [trigger, replacement] : null;
}

function parsedReplacements(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function normalizeTextReplacements(raw: unknown): TextReplacements {
  if (raw === null || raw === undefined || raw === "") return NOTES_TEXT_REPLACEMENTS;
  const value = parsedReplacements(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return NOTES_TEXT_REPLACEMENTS;
  const pairs = Object.entries(value).flatMap(([from, to]) => {
    const pair = textReplacementPair(from, to);
    return pair ? [pair] : [];
  });
  return Object.fromEntries(pairs.slice(0, TEXT_REPLACEMENT_LIMITS.count));
}

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
  notesCalloutStyle: "tinted" as NotesCalloutStyle,
  notesTaskBox: "round" as NotesTaskBox,
  notesFieldStyle: "tint" as NotesFieldStyle,
  notesInfo: "side" as NotesInfoPlace,
  notesShowWordCount: true,
  notesSpellcheck: true,
  notesTextReplace: true,
  notesTextReplacements: NOTES_TEXT_REPLACEMENTS,
  notesKeepUndo: true,
  notesTikzPreamble: "",
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
  notesCalloutStyle: "oleafly.notes.calloutStyle",
  notesTaskBox: "oleafly.notes.taskBox",
  notesFieldStyle: "oleafly.notes.fieldStyle",
  notesInfo: "oleafly.notes.info",
  notesShowWordCount: "oleafly.notes.wordCount",
  notesSpellcheck: "oleafly.notes.spellcheck",
  notesTextReplace: "oleafly.notes.textReplace",
  notesTextReplacements: "oleafly.notes.textReplacements",
  notesKeepUndo: "oleafly.notes.keepUndo",
  notesTikzPreamble: "oleafly.notes.tikzPreamble",
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

export const NOTES_TIKZ_PREAMBLE_MAX = 8000;

function preamble(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(/[^\P{Cc}\n\t]/gu, "")
    .slice(0, NOTES_TIKZ_PREAMBLE_MAX);
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
  notesCalloutStyle: option("notesCalloutStyle", NOTES_CALLOUT_STYLES),
  notesTaskBox: option("notesTaskBox", NOTES_TASK_BOXES),
  notesFieldStyle: option("notesFieldStyle", NOTES_FIELD_STYLES),
  notesInfo: option("notesInfo", NOTES_INFO_PLACES),
  notesShowWordCount: toggle(NOTES_APPEARANCE_DEFAULTS.notesShowWordCount),
  notesSpellcheck: toggle(NOTES_APPEARANCE_DEFAULTS.notesSpellcheck),
  notesTextReplace: toggle(NOTES_APPEARANCE_DEFAULTS.notesTextReplace),
  notesTextReplacements: normalizeTextReplacements,
  notesKeepUndo: toggle(NOTES_APPEARANCE_DEFAULTS.notesKeepUndo),
  notesTikzPreamble: preamble,
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
