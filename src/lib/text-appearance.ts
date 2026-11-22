import { fontFamilyOr, withoutControlCharacters } from "@/lib/font-families";

export type TextTypeface = "sans" | "serif" | "mono";
export const TEXT_TYPEFACES: readonly TextTypeface[] = ["sans", "serif", "mono"];

export type HeadingTypeface = "text" | TextTypeface;
export const HEADING_TYPEFACES: readonly HeadingTypeface[] = ["text", ...TEXT_TYPEFACES];

export const TEXT_FONT_SIZE_RANGE = { min: 10, max: 40, step: 1 } as const;
export const TEXT_FONT_SIZES: readonly number[] = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24];

export type TypefaceStacks = Readonly<Record<TextTypeface, string>>;

export function typefaceFont(stacks: TypefaceStacks, typeface: TextTypeface, family: string): string {
  return fontFamilyOr(family, stacks[typeface]);
}

export function headingFont(stacks: TypefaceStacks, textFont: string, typeface: HeadingTypeface, family: string): string {
  return fontFamilyOr(family, typeface === "text" ? textFont : stacks[typeface]);
}

export type TextLineHeightPreset = "compact" | "normal" | "wide";
export const TEXT_LINE_HEIGHTS: Readonly<Record<TextLineHeightPreset, number>> = {
  compact: 1.5,
  normal: 1.7,
  wide: 2,
};
export const CUSTOM_LINE_HEIGHT = { min: 1, max: 3, step: 0.05 } as const;

export type ParagraphSpacing = "compact" | "normal" | "relaxed" | "spacious";
export const PARAGRAPH_SPACINGS: readonly ParagraphSpacing[] = ["compact", "normal", "relaxed", "spacious"];

export type HeadingSize = "small" | "normal" | "large";
export const HEADING_SIZES: readonly HeadingSize[] = ["small", "normal", "large"];

export type Normalizer<T> = (raw: unknown) => T;

export type Normalizers<T> = { readonly [K in keyof T]: Normalizer<T[K]> };

export function readAppearance<T extends object>(
  normalizers: Normalizers<T>,
  storageKeys: Readonly<Record<keyof T, string>>,
  read: (storageKey: string) => string | null,
): T {
  const appearance: Partial<T> = {};
  for (const key of Object.keys(normalizers) as (keyof T)[]) appearance[key] = normalizers[key](read(storageKeys[key]));
  return appearance as T;
}

export function appearanceOption<T extends string>(options: readonly T[], raw: unknown, fallback: T): T {
  return options.find((option) => option === raw) ?? fallback;
}

export function optionValue<T extends string>(options: readonly T[], fallback: T): Normalizer<T> {
  return (raw) => appearanceOption(options, raw, fallback);
}

export function listedNumberValue(options: readonly number[], fallback: number): Normalizer<number> {
  return (raw) => {
    const value = Number(raw);
    return raw !== "" && options.includes(value) ? value : fallback;
  };
}

export function fontFamilyValue(raw: unknown): string {
  return typeof raw === "string" ? withoutControlCharacters(raw).slice(0, 200) : "";
}

export function numberValue(fallback: number, clamp: (value: number) => number): Normalizer<number> {
  return (raw) => {
    if (raw === null || raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value) : fallback;
  };
}

export function toggleValue(fallback: boolean): Normalizer<boolean> {
  return (raw) => {
    if (raw === true || raw === "1") return true;
    if (raw === false || raw === "0") return false;
    return fallback;
  };
}

export function hexColorValue(raw: unknown): string {
  return typeof raw === "string" && /^#[\da-f]{6}$/iu.test(raw) ? raw.toLowerCase() : "";
}

export function clampTextFontSize(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const { min, max } = TEXT_FONT_SIZE_RANGE;
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

export function clampLineHeight(value: number): number {
  if (!Number.isFinite(value)) return TEXT_LINE_HEIGHTS.normal;
  const { min, max } = CUSTOM_LINE_HEIGHT;
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

export function lineHeightValue(choice: TextLineHeightPreset | "custom", custom: number): number {
  return choice === "custom" ? clampLineHeight(custom) : TEXT_LINE_HEIGHTS[choice];
}
