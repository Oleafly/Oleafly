import { VISUAL_TEXT_WIDTH_VALUES, type VisualTextWidth } from "@oleafly/editor/visual/appearance";
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

export const VISUAL_MATCH_EDITOR_SIZE = 0;

export type VisualLineHeight = "editor" | TextLineHeightPreset | "custom";
export const VISUAL_LINE_HEIGHT_OPTIONS: readonly VisualLineHeight[] = ["editor", "compact", "normal", "wide", "custom"];

export const VISUAL_PARAGRAPH_INDENTS: readonly number[] = [0, 1, 1.5, 2, 3];

export type VisualTextAlign = "start" | "justify";
export const VISUAL_TEXT_ALIGNS: readonly VisualTextAlign[] = ["start", "justify"];

export const VISUAL_TEXT_WIDTHS = Object.keys(VISUAL_TEXT_WIDTH_VALUES) as VisualTextWidth[];

export const VISUAL_APPEARANCE_DEFAULTS = {
  visualTypeface: "serif" as TextTypeface,
  visualFontFamily: "",
  visualFontSize: VISUAL_MATCH_EDITOR_SIZE,
  visualLineHeight: "editor" as VisualLineHeight,
  visualCustomLineHeight: TEXT_LINE_HEIGHTS.normal,
  visualParagraphSpacing: "normal" as ParagraphSpacing,
  visualParagraphIndent: 0,
  visualTextAlign: "start" as VisualTextAlign,
  visualTextWidth: "standard" as VisualTextWidth,
  visualHeadingTypeface: "text" as HeadingTypeface,
  visualHeadingFontFamily: "",
  visualHeadingSize: "normal" as HeadingSize,
  visualHeadingColor: "",
  visualMarkdown: false,
};

export type VisualAppearance = typeof VISUAL_APPEARANCE_DEFAULTS;
export type VisualAppearanceKey = keyof VisualAppearance;

export const VISUAL_APPEARANCE_KEYS = Object.keys(VISUAL_APPEARANCE_DEFAULTS) as VisualAppearanceKey[];

export const VISUAL_APPEARANCE_STORAGE_KEYS: Readonly<Record<VisualAppearanceKey, string>> = {
  visualTypeface: "oleafly.visual.typeface",
  visualFontFamily: "oleafly.visual.font",
  visualFontSize: "oleafly.visual.fontSize",
  visualLineHeight: "oleafly.visual.lineHeight",
  visualCustomLineHeight: "oleafly.visual.lineHeightCustom",
  visualParagraphSpacing: "oleafly.visual.paragraphSpacing",
  visualParagraphIndent: "oleafly.visual.paragraphIndent",
  visualTextAlign: "oleafly.visual.textAlign",
  visualTextWidth: "oleafly.visual.width",
  visualHeadingTypeface: "oleafly.visual.headingTypeface",
  visualHeadingFontFamily: "oleafly.visual.headingFont",
  visualHeadingSize: "oleafly.visual.headingSize",
  visualHeadingColor: "oleafly.visual.headingColor",
  visualMarkdown: "oleafly.visual.markdown",
};

export function isVisualAppearanceKey(key: string): key is VisualAppearanceKey {
  return Object.hasOwn(VISUAL_APPEARANCE_DEFAULTS, key);
}

export function clampVisualFontSize(value: number): number {
  return value === VISUAL_MATCH_EDITOR_SIZE ? value : clampTextFontSize(value, VISUAL_MATCH_EDITOR_SIZE);
}

const NORMALIZERS: Normalizers<VisualAppearance> = {
  visualTypeface: optionValue(TEXT_TYPEFACES, VISUAL_APPEARANCE_DEFAULTS.visualTypeface),
  visualFontFamily: fontFamilyValue,
  visualFontSize: numberValue(VISUAL_APPEARANCE_DEFAULTS.visualFontSize, clampVisualFontSize),
  visualLineHeight: optionValue(VISUAL_LINE_HEIGHT_OPTIONS, VISUAL_APPEARANCE_DEFAULTS.visualLineHeight),
  visualCustomLineHeight: numberValue(VISUAL_APPEARANCE_DEFAULTS.visualCustomLineHeight, clampLineHeight),
  visualParagraphSpacing: optionValue(PARAGRAPH_SPACINGS, VISUAL_APPEARANCE_DEFAULTS.visualParagraphSpacing),
  visualParagraphIndent: listedNumberValue(VISUAL_PARAGRAPH_INDENTS, VISUAL_APPEARANCE_DEFAULTS.visualParagraphIndent),
  visualTextAlign: optionValue(VISUAL_TEXT_ALIGNS, VISUAL_APPEARANCE_DEFAULTS.visualTextAlign),
  visualTextWidth: optionValue(VISUAL_TEXT_WIDTHS, VISUAL_APPEARANCE_DEFAULTS.visualTextWidth),
  visualHeadingTypeface: optionValue(HEADING_TYPEFACES, VISUAL_APPEARANCE_DEFAULTS.visualHeadingTypeface),
  visualHeadingFontFamily: fontFamilyValue,
  visualHeadingSize: optionValue(HEADING_SIZES, VISUAL_APPEARANCE_DEFAULTS.visualHeadingSize),
  visualHeadingColor: hexColorValue,
  visualMarkdown: toggleValue(VISUAL_APPEARANCE_DEFAULTS.visualMarkdown),
};

export function normalizeVisualSetting<K extends VisualAppearanceKey>(key: K, raw: unknown): VisualAppearance[K] {
  return NORMALIZERS[key](raw);
}

export function readVisualAppearance(read: (storageKey: string) => string | null): VisualAppearance {
  return readAppearance(NORMALIZERS, VISUAL_APPEARANCE_STORAGE_KEYS, read);
}
