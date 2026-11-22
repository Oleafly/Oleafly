import { EDITOR_THEME_IDS, type EditorThemeId } from "@/lib/editor-themes";
import { withoutControlCharacters } from "@/lib/font-families";
import {
  HEADING_SIZES,
  HEADING_TYPEFACES,
  PARAGRAPH_SPACINGS,
  TEXT_LINE_HEIGHTS,
  TEXT_TYPEFACES,
  type HeadingSize,
  type HeadingTypeface,
  type Normalizers,
  type ParagraphSpacing,
  type TextLineHeightPreset,
  type TextTypeface,
  clampLineHeight,
  clampTextFontSize,
  fontFamilyValue,
  hexColorValue,
  listedNumberValue,
  numberValue,
  optionValue,
  readAppearance,
  toggleValue,
} from "@/lib/text-appearance";

export type NoteWidth = "standard" | "wide" | "full";
export const NOTE_WIDTHS: readonly NoteWidth[] = ["standard", "wide", "full"];
export const NOTE_WIDTH_KEY = "oleafly.notes.width";

export type NotesLineHeight = TextLineHeightPreset | "custom";
export const NOTES_LINE_HEIGHT_OPTIONS: readonly NotesLineHeight[] = ["compact", "normal", "wide", "custom"];

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
  notesTypeface: "sans" as TextTypeface,
  notesFontFamily: "",
  notesFontSize: 15,
  notesLineHeight: "normal" as NotesLineHeight,
  notesCustomLineHeight: TEXT_LINE_HEIGHTS.normal,
  notesParagraphSpacing: "normal" as ParagraphSpacing,
  notesHeadingTypeface: "text" as HeadingTypeface,
  notesHeadingFontFamily: "",
  notesHeadingSize: "normal" as HeadingSize,
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
  notesXPostsLive: false,
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
  notesXPostsLive: "oleafly.notes.xPostsLive",
  notesTikzPreamble: "oleafly.notes.tikzPreamble",
};

export const NOTES_TIKZ_PREAMBLE_MAX = 8000;

function preamble(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(/[^\P{Cc}\n\t]/gu, "")
    .slice(0, NOTES_TIKZ_PREAMBLE_MAX);
}

const NORMALIZERS: Normalizers<NotesAppearance> = {
  notesTypeface: optionValue(TEXT_TYPEFACES, NOTES_APPEARANCE_DEFAULTS.notesTypeface),
  notesFontFamily: fontFamilyValue,
  notesFontSize: numberValue(NOTES_APPEARANCE_DEFAULTS.notesFontSize, clampNotesFontSize),
  notesLineHeight: optionValue(NOTES_LINE_HEIGHT_OPTIONS, NOTES_APPEARANCE_DEFAULTS.notesLineHeight),
  notesCustomLineHeight: numberValue(NOTES_APPEARANCE_DEFAULTS.notesCustomLineHeight, clampLineHeight),
  notesParagraphSpacing: optionValue(PARAGRAPH_SPACINGS, NOTES_APPEARANCE_DEFAULTS.notesParagraphSpacing),
  notesHeadingTypeface: optionValue(HEADING_TYPEFACES, NOTES_APPEARANCE_DEFAULTS.notesHeadingTypeface),
  notesHeadingFontFamily: fontFamilyValue,
  notesHeadingSize: optionValue(HEADING_SIZES, NOTES_APPEARANCE_DEFAULTS.notesHeadingSize),
  notesTitleSize: listedNumberValue(NOTES_TITLE_SIZES, NOTES_APPEARANCE_DEFAULTS.notesTitleSize),
  notesWidth: optionValue(NOTE_WIDTHS, NOTES_APPEARANCE_DEFAULTS.notesWidth),
  notesCodeFontFamily: fontFamilyValue,
  notesCodeTheme: optionValue(NOTES_CODE_THEMES, NOTES_APPEARANCE_DEFAULTS.notesCodeTheme),
  notesAccentColor: hexColorValue,
  notesCalloutStyle: optionValue(NOTES_CALLOUT_STYLES, NOTES_APPEARANCE_DEFAULTS.notesCalloutStyle),
  notesTaskBox: optionValue(NOTES_TASK_BOXES, NOTES_APPEARANCE_DEFAULTS.notesTaskBox),
  notesFieldStyle: optionValue(NOTES_FIELD_STYLES, NOTES_APPEARANCE_DEFAULTS.notesFieldStyle),
  notesInfo: optionValue(NOTES_INFO_PLACES, NOTES_APPEARANCE_DEFAULTS.notesInfo),
  notesShowWordCount: toggleValue(NOTES_APPEARANCE_DEFAULTS.notesShowWordCount),
  notesSpellcheck: toggleValue(NOTES_APPEARANCE_DEFAULTS.notesSpellcheck),
  notesTextReplace: toggleValue(NOTES_APPEARANCE_DEFAULTS.notesTextReplace),
  notesTextReplacements: normalizeTextReplacements,
  notesKeepUndo: toggleValue(NOTES_APPEARANCE_DEFAULTS.notesKeepUndo),
  notesXPostsLive: toggleValue(NOTES_APPEARANCE_DEFAULTS.notesXPostsLive),
  notesTikzPreamble: preamble,
};

export function normalizeNotesSetting<K extends NotesAppearanceKey>(key: K, raw: unknown): NotesAppearance[K] {
  return NORMALIZERS[key](raw);
}

export function readNotesAppearance(read: (storageKey: string) => string | null): NotesAppearance {
  return readAppearance(NORMALIZERS, NOTES_APPEARANCE_STORAGE_KEYS, read);
}

export function clampNotesFontSize(value: number): number {
  return clampTextFontSize(value, NOTES_APPEARANCE_DEFAULTS.notesFontSize);
}
