export const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export function textAlignOf(value: unknown): TextAlign | null {
  return TEXT_ALIGNS.find((align) => align === value) ?? null;
}
