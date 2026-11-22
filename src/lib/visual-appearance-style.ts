import {
  VISUAL_APPEARANCE_FALLBACKS,
  VISUAL_HEADING_COLOR_ATTRIBUTE,
  VISUAL_SERIF_FONT,
  VISUAL_TEXT_WIDTH_ATTRIBUTE,
  VISUAL_TEXT_WIDTH_VALUES,
  type VisualAppearanceVariable,
} from "@oleafly/editor/visual/appearance";
import { type AppearanceStyle, attachAppearanceStyle } from "@/lib/appearance-style";
import {
  headingFont,
  lineHeightValue,
  typefaceFont,
  type HeadingSize,
  type ParagraphSpacing,
  type TypefaceStacks,
} from "@/lib/text-appearance";
import {
  VISUAL_APPEARANCE_KEYS,
  VISUAL_MATCH_EDITOR_SIZE,
  type VisualAppearance,
  type VisualLineHeight,
} from "@/lib/visual-appearance";
import { useSettingsStore } from "@/store/settings";

export const VISUAL_MARKDOWN_ATTRIBUTE = "data-visual-markdown";

export const VISUAL_TYPEFACE_STACKS: TypefaceStacks = {
  serif: VISUAL_SERIF_FONT,
  sans: "var(--font-sans)",
  mono: "var(--font-mono)",
};

const VISUAL_PARAGRAPH_GAPS: Readonly<Record<ParagraphSpacing, number>> = {
  compact: 0.5,
  normal: 1,
  relaxed: 1.5,
  spacious: 2,
};

const VISUAL_HEADING_SCALES: Readonly<Record<HeadingSize, number>> = {
  small: 0.6,
  normal: 1,
  large: 1.5,
};

export function visualTextFont(appearance: Pick<VisualAppearance, "visualTypeface" | "visualFontFamily">): string {
  return typefaceFont(VISUAL_TYPEFACE_STACKS, appearance.visualTypeface, appearance.visualFontFamily);
}

export function visualHeadingFont(
  appearance: Pick<
    VisualAppearance,
    "visualTypeface" | "visualFontFamily" | "visualHeadingTypeface" | "visualHeadingFontFamily"
  >,
): string {
  return headingFont(
    VISUAL_TYPEFACE_STACKS,
    visualTextFont(appearance),
    appearance.visualHeadingTypeface,
    appearance.visualHeadingFontFamily,
  );
}

function lineHeight(choice: VisualLineHeight, custom: number): string {
  return choice === "editor" ? VISUAL_APPEARANCE_FALLBACKS["--visual-line-height"] : String(lineHeightValue(choice, custom));
}

function textSize(size: number): string {
  return size === VISUAL_MATCH_EDITOR_SIZE ? VISUAL_APPEARANCE_FALLBACKS["--visual-text-size"] : `${size}px`;
}

export function visualAppearanceStyle(appearance: VisualAppearance): AppearanceStyle {
  const variables: Record<VisualAppearanceVariable, string> = {
    "--visual-text-font": visualTextFont(appearance),
    "--visual-text-size": textSize(appearance.visualFontSize),
    "--visual-line-height": lineHeight(appearance.visualLineHeight, appearance.visualCustomLineHeight),
    "--visual-paragraph-gap": String(VISUAL_PARAGRAPH_GAPS[appearance.visualParagraphSpacing]),
    "--visual-paragraph-indent": appearance.visualParagraphIndent ? `${appearance.visualParagraphIndent}em` : "0",
    "--visual-text-align": appearance.visualTextAlign,
    "--visual-text-width": VISUAL_TEXT_WIDTH_VALUES[appearance.visualTextWidth],
    "--visual-heading-font": visualHeadingFont(appearance),
    "--visual-heading-scale": String(VISUAL_HEADING_SCALES[appearance.visualHeadingSize]),
    "--visual-heading-color": appearance.visualHeadingColor || VISUAL_APPEARANCE_FALLBACKS["--visual-heading-color"],
  };
  return {
    variables,
    attributes: {
      [VISUAL_HEADING_COLOR_ATTRIBUTE]: appearance.visualHeadingColor ? "" : null,
      [VISUAL_TEXT_WIDTH_ATTRIBUTE]: appearance.visualTextWidth === "standard" ? null : appearance.visualTextWidth,
      [VISUAL_MARKDOWN_ATTRIBUTE]: appearance.visualMarkdown ? "" : null,
    },
  };
}

export function attachVisualAppearance(element: HTMLElement): () => void {
  return attachAppearanceStyle(element, VISUAL_APPEARANCE_KEYS, () => visualAppearanceStyle(useSettingsStore.getState()));
}
