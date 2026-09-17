const BASE_COLORS =
  "black=000000 blue=0000FF brown=BF8040 cyan=00FFFF darkgray=404040 gray=808080 green=00FF00 lightgray=BFBFBF lime=BFFF00 magenta=FF00FF olive=808000 orange=FF8000 pink=FFBFBF purple=BF0040 red=FF0000 teal=008080 violet=800080 white=FFFFFF yellow=FFFF00";

const DVIPS_COLORS =
  "Apricot=FBB982 Aquamarine=00B5BE Bittersweet=C04F17 Black=221E1F Blue=2D2F92 BlueGreen=00B3B8 BlueViolet=473992 BrickRed=B6321C Brown=792500 BurntOrange=F7921D CadetBlue=74729A CarnationPink=F282B4 Cerulean=00A2E3 CornflowerBlue=41B0E4 Cyan=00AEEF Dandelion=FDBC42 DarkOrchid=A4538A Emerald=00A99D ForestGreen=009B55 Fuchsia=8C368C Goldenrod=FFDF42 Gray=949698 Green=00A64F GreenYellow=DFE674 JungleGreen=00A99A Lavender=F49EC4 LimeGreen=8DC73E Magenta=EC008C Mahogany=A9341F Maroon=AF3235 Melon=F89E7B MidnightBlue=006795 Mulberry=A93C93 NavyBlue=006EB8 OliveGreen=3C8031 Orange=F58137 OrangeRed=ED135A Orchid=AF72B0 Peach=F7965A Periwinkle=7977B8 PineGreen=008B72 Plum=92268F ProcessBlue=00B0F0 Purple=99479B RawSienna=974006 Red=ED1B23 RedOrange=F26035 RedViolet=A1246B Rhodamine=EF559F RoyalBlue=0071BC RoyalPurple=613F99 RubineRed=ED017D Salmon=F69289 SeaGreen=3FBC9D Sepia=671800 SkyBlue=46C5DD SpringGreen=C6DC67 Tan=DA9D76 TealBlue=00AEB3 Thistle=D883B7 Turquoise=00B4CE Violet=58429B VioletRed=EF58A0 White=FFFFFF WildStrawberry=EE2967 Yellow=FFF200 YellowGreen=98CC70 YellowOrange=FAA21A";

type Rgb = readonly [number, number, number];

function parseColorTable(table: string): Map<string, Rgb> {
  const entries = new Map<string, Rgb>();
  for (const pair of table.split(" ")) {
    const [name, hex] = pair.split("=");
    entries.set(name, hexToRgb(hex) ?? [0, 0, 0]);
  }
  return entries;
}

function hexToRgb(hex: string): Rgb | null {
  if (!/^[0-9A-Fa-f]{6}$/u.test(hex)) return null;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

export const LATEX_BASE_COLOR_NAMES: readonly string[] = BASE_COLORS.split(" ").map((pair) => pair.split("=")[0]);
export const LATEX_DVIPS_COLOR_NAMES: readonly string[] = DVIPS_COLORS.split(" ").map((pair) => pair.split("=")[0]);

const NAMED_COLORS = new Map<string, Rgb>([
  ...parseColorTable(BASE_COLORS),
  ...parseColorTable(DVIPS_COLORS),
]);

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function rgbToCss([red, green, blue]: Rgb): string {
  return `#${[red, green, blue].map((channel) => clampChannel(channel).toString(16).padStart(2, "0")).join("")}`;
}

function numbers(value: string, count: number): number[] | null {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== count || parts.some((part) => !Number.isFinite(part))) return null;
  return parts;
}

function modelToRgb(model: string, value: string): Rgb | null {
  if (model === "HTML") return hexToRgb(value.trim());
  if (model === "rgb") {
    const parts = numbers(value, 3);
    return parts ? [parts[0] * 255, parts[1] * 255, parts[2] * 255] : null;
  }
  if (model === "RGB") {
    const parts = numbers(value, 3);
    return parts ? [parts[0], parts[1], parts[2]] : null;
  }
  if (model === "gray") {
    const parts = numbers(value, 1);
    return parts ? [parts[0] * 255, parts[0] * 255, parts[0] * 255] : null;
  }
  return null;
}

function mix(first: Rgb, percent: number, second: Rgb): Rgb {
  const ratio = Math.min(100, Math.max(0, percent)) / 100;
  return [
    first[0] * ratio + second[0] * (1 - ratio),
    first[1] * ratio + second[1] * (1 - ratio),
    first[2] * ratio + second[2] * (1 - ratio),
  ];
}

function mixExpressionToRgb(spec: string): Rgb | null {
  const parts = spec.split("!").map((part) => part.trim());
  let current = NAMED_COLORS.get(parts[0]);
  if (!current) return null;
  for (let index = 1; index < parts.length; index += 2) {
    const percent = Number(parts[index]);
    if (!Number.isFinite(percent)) return null;
    const partner = parts[index + 1] === undefined ? NAMED_COLORS.get("white") : NAMED_COLORS.get(parts[index + 1]);
    if (!partner) return null;
    current = mix(current, percent, partner);
  }
  return current;
}

export function latexColorToCss(spec: string): string | null {
  const trimmed = spec.trim();
  const model = /^\[([A-Za-z]+)\]\s*\{([^{}]*)\}$/u.exec(trimmed);
  if (model) {
    const rgb = modelToRgb(model[1], model[2]);
    return rgb ? rgbToCss(rgb) : null;
  }
  if (!/^[A-Za-z]+(?:!\d+(?:\.\d+)?(?:![A-Za-z]+)?)*$/u.test(trimmed)) return null;
  const rgb = mixExpressionToRgb(trimmed);
  return rgb ? rgbToCss(rgb) : null;
}
