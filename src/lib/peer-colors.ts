export const LABEL_SATURATION = 70;
export const LABEL_LIGHTNESS = 45;
const MIN_LABEL_CONTRAST = 4.5;

function channel(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

// WCAG relative luminance of an HSL colour (hue in degrees, the rest 0 to 100).
export function hslLuminance(hue: number, saturation: number, lightness: number): number {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const sectors = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [r, g, b] = sectors[Math.floor(h) % 6];
  const m = l - chroma / 2;
  return relativeLuminance(r + m, g + m, b + m);
}

function relativeLuminance(red: number, green: number, blue: number): number {
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

export function hexLuminance(hex: string): number | null {
  const match = /^#([\da-f]{6})$/iu.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return relativeLuminance(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

export function contrastWithWhite(luminance: number): number {
  return 1.05 / (luminance + 0.05);
}

const labelLightnessByHue = new Map<number, number>();

export function labelLightness(hue: number): number {
  const key = Math.round(hue) % 360;
  const known = labelLightnessByHue.get(key);
  if (known !== undefined) return known;
  let lightness = LABEL_LIGHTNESS;
  while (lightness > 10 && contrastWithWhite(hslLuminance(key, LABEL_SATURATION, lightness)) < MIN_LABEL_CONTRAST) {
    lightness -= 1;
  }
  labelLightnessByHue.set(key, lightness);
  return lightness;
}

export const REMOTE_CARET_COLOR = "hsl(var(--remote-hue) 70% 45%)";

export const REMOTE_PART_STYLES = {
  selection: {
    backgroundColor: "hsl(var(--remote-hue) 85% 55% / 0.22)",
  },
  caret: {
    position: "relative",
    display: "inline",
    boxSizing: "border-box",
    marginLeft: "-1px",
    marginRight: "-1px",
    borderLeft: `1px solid ${REMOTE_CARET_COLOR}`,
    borderRight: `1px solid ${REMOTE_CARET_COLOR}`,
    pointerEvents: "none",
    userSelect: "none",
  },
  // The label hangs above its own line from inside an inline caret. WebKit
  // repaints only the line box when the editor moves the widget, so without
  // a layer of its own the old label stays on screen and the line above
  // paints over the new one, until something else forces a repaint.
  label: {
    position: "absolute",
    bottom: "100%",
    left: "-1px",
    willChange: "transform",
    padding: "0 0.25rem",
    borderRadius: "0.25rem 0.25rem 0.25rem 0",
    backgroundColor: `hsl(var(--remote-hue) ${LABEL_SATURATION}% var(--remote-label-lightness, ${LABEL_LIGHTNESS}%))`,
    color: "#fff",
    fontFamily: "var(--font-sans)",
    fontSize: "0.6875rem",
    fontStyle: "normal",
    fontWeight: "500",
    letterSpacing: "normal",
    lineHeight: "1.4",
    textDecoration: "none",
    textTransform: "none",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  flash: {
    backgroundColor: "hsl(var(--remote-hue) 85% 55% / 0.18)",
  },
} as const;

export function remoteLabelColor(hue: number): string {
  return `hsl(${hue} ${LABEL_SATURATION}% ${labelLightness(hue)}%)`;
}

function cssPropertyName(key: string): string {
  return key.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

export function cssText(style: Readonly<Record<string, string>>): string {
  return Object.entries(style)
    .map(([key, value]) => `${cssPropertyName(key)}: ${value}`)
    .join("; ");
}
