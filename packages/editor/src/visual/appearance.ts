export const VISUAL_SERIF_FONT =
  '"Noto Serif", "Palatino Linotype", "Book Antiqua", Palatino, var(--cm-cjk-font, serif), serif';

export const VISUAL_TEXT_SCALE = 1.15;

export const VISUAL_TEXT_WIDTH_VALUES = {
  narrow: "70ch",
  standard: "95ch",
  wide: "120ch",
  full: "100%",
} as const;

export type VisualTextWidth = keyof typeof VISUAL_TEXT_WIDTH_VALUES;

export const VISUAL_TEXT_WIDTH_ATTRIBUTE = "data-visual-text-width";

export const VISUAL_APPEARANCE_FALLBACKS = {
  "--visual-text-font": VISUAL_SERIF_FONT,
  "--visual-text-size": `calc(var(--cm-font-size, 13px) * ${VISUAL_TEXT_SCALE})`,
  "--visual-line-height": "var(--cm-line-height, 1.7)",
  "--visual-paragraph-gap": "1",
  "--visual-paragraph-indent": "0",
  "--visual-text-align": "start",
  "--visual-text-width": VISUAL_TEXT_WIDTH_VALUES.standard,
  "--visual-heading-font": `var(--visual-text-font, ${VISUAL_SERIF_FONT})`,
  "--visual-heading-scale": "1",
  "--visual-heading-color": "currentColor",
} as const;

export type VisualAppearanceVariable = keyof typeof VISUAL_APPEARANCE_FALLBACKS;

export function visualVariable(name: VisualAppearanceVariable): string {
  return `var(${name}, ${VISUAL_APPEARANCE_FALLBACKS[name]})`;
}

export function visualHeadingSize(size: number): string {
  const growth = Math.round((size - 1) * 100) / 100;
  return `calc(1em + ${growth}em * ${visualVariable("--visual-heading-scale")})`;
}

export function visualContentPadding(width: VisualTextWidth): string {
  if (width === "full") return "0.75em 1.5em";
  return `0.75em max(calc((100% - ${VISUAL_TEXT_WIDTH_VALUES[width]}) / 2), 6%)`;
}

export function visualTextWidthRules(selector: string): Record<string, { padding: string }> {
  const rules: Record<string, { padding: string }> = {};
  for (const width of Object.keys(VISUAL_TEXT_WIDTH_VALUES) as VisualTextWidth[]) {
    if (width === "standard") continue;
    rules[`:root[${VISUAL_TEXT_WIDTH_ATTRIBUTE}="${width}"] & ${selector}`] = { padding: visualContentPadding(width) };
  }
  return rules;
}

export const VISUAL_HEADING_COLOR_ATTRIBUTE = "data-visual-heading-color";

export function visualHeadingColorSelectors(selectors: readonly string[]): string {
  return selectors.map((selector) => `:root[${VISUAL_HEADING_COLOR_ATTRIBUTE}] & ${selector}`).join(", ");
}
