import type { EditorThemeId } from "@/lib/editor-themes";
import { fontFamilyOr } from "@/lib/font-families";
import type { NotesAppearance, NotesCodeTheme } from "@/lib/notes-appearance";
import { hexLuminance } from "@/lib/peer-colors";
import {
  headingFont,
  lineHeightValue,
  typefaceFont,
  type HeadingSize,
  type ParagraphSpacing,
  type TypefaceStacks,
} from "@/lib/text-appearance";

export const NOTES_TYPEFACE_STACKS: TypefaceStacks = {
  sans: "var(--font-sans)",
  serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Charter, Georgia, Cambria, "Times New Roman", serif',
  mono: "var(--font-mono)",
};

const NOTES_PARAGRAPH_SPACINGS: Readonly<Record<ParagraphSpacing, number>> = {
  compact: 0.4,
  normal: 0.75,
  relaxed: 1.1,
  spacious: 1.5,
};

const NOTES_HEADING_SCALES: Readonly<Record<HeadingSize, readonly [number, number, number]>> = {
  small: [1.3, 1.15, 1.05],
  normal: [1.5, 1.25, 1.1],
  large: [1.8, 1.45, 1.2],
};

function rem(pixels: number): string {
  return `${pixels / 16}rem`;
}

export function notesTextFont(appearance: Pick<NotesAppearance, "notesTypeface" | "notesFontFamily">): string {
  return typefaceFont(NOTES_TYPEFACE_STACKS, appearance.notesTypeface, appearance.notesFontFamily);
}

export function notesHeadingFont(
  appearance: Pick<NotesAppearance, "notesTypeface" | "notesFontFamily" | "notesHeadingTypeface" | "notesHeadingFontFamily">,
): string {
  return headingFont(
    NOTES_TYPEFACE_STACKS,
    notesTextFont(appearance),
    appearance.notesHeadingTypeface,
    appearance.notesHeadingFontFamily,
  );
}

export function notesCodeFont(appearance: Pick<NotesAppearance, "notesCodeFontFamily">): string {
  return fontFamilyOr(appearance.notesCodeFontFamily, "var(--font-mono)");
}

export function notesAppearanceVariables(appearance: NotesAppearance): Record<string, string> {
  const [h1, h2, h3] = NOTES_HEADING_SCALES[appearance.notesHeadingSize];
  const variables: Record<string, string> = {
    "--notes-text-font": notesTextFont(appearance),
    "--notes-text-size": rem(appearance.notesFontSize),
    "--notes-line-height": String(lineHeightValue(appearance.notesLineHeight, appearance.notesCustomLineHeight)),
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
