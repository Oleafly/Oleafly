import type { EditorThemeId } from "@/lib/editor-themes";
import { fontFamilyName, fontFamilyStack } from "@/lib/font-families";
import {
  clampNotesLineHeight,
  NOTES_APPEARANCE_DEFAULTS,
  NOTES_LINE_HEIGHTS,
  type NotesAppearance,
  type NotesAppearanceKey,
  type NotesCodeTheme,
  type NotesHeadingSize,
  type NotesLineHeight,
  type NotesParagraphSpacing,
  type NotesTypeface,
} from "@/lib/notes-appearance";
import { hexLuminance } from "@/lib/peer-colors";
import { sameValue } from "@/lib/same-value";

export const NOTES_TYPEFACE_STACKS: Readonly<Record<NotesTypeface, string>> = {
  sans: "var(--font-sans)",
  serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Charter, Georgia, Cambria, "Times New Roman", serif',
  mono: "var(--font-mono)",
};

export const NOTES_FONT_SIZES: readonly number[] = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24];

export const NOTES_PARAGRAPH_SPACINGS: Readonly<Record<NotesParagraphSpacing, number>> = {
  compact: 0.4,
  normal: 0.75,
  relaxed: 1.1,
  spacious: 1.5,
};

export const NOTES_HEADING_SCALES: Readonly<Record<NotesHeadingSize, readonly [number, number, number]>> = {
  small: [1.3, 1.15, 1.05],
  normal: [1.5, 1.25, 1.1],
  large: [1.8, 1.45, 1.2],
};

export function notesSettingIsDefault(state: Readonly<NotesAppearance>, key: NotesAppearanceKey): boolean {
  return sameValue(state[key], NOTES_APPEARANCE_DEFAULTS[key]);
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
    "data-notes-task-box": appearance.notesTaskBox === "round" ? null : appearance.notesTaskBox,
    "data-notes-field-style": appearance.notesFieldStyle === "tint" ? null : appearance.notesFieldStyle,
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
