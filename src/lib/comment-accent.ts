const WARM_HUES: readonly [number, number] = [50, 110];
const GREY_CHROMA = 0.03;
const LAB_TO_OKLAB = 375;

interface Hue {
  chroma: number;
  hue: number;
}

type Matrix = readonly number[];

const SRGB: Matrix = [0.4123908, 0.3575843, 0.1804808, 0.212639, 0.7151687, 0.0721923, 0.0193308, 0.1191948, 0.9505322];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const D50_TO_D65: Matrix = [0.9554734527, -0.0230985369, 0.0632593087, -0.028369707, 1.0099954580, 0.021041399, 0.0123140017, -0.0205076964, 1.3303659366];
const XYZ_TO_LMS: Matrix = [0.8189330101, 0.3618667424, -0.1288597137, 0.0329845436, 0.9293118715, 0.0361456387, 0.0482003018, 0.2643662691, 0.633851707];

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

const SPACES: Readonly<Record<string, { matrix: Matrix; transfer: (channel: number) => number; d50?: boolean }>> = {
  srgb: { matrix: SRGB, transfer: linear },
  "srgb-linear": { matrix: SRGB, transfer: (channel) => channel },
  "display-p3": { matrix: [0.4865709, 0.2656677, 0.1982173, 0.2289746, 0.6917385, 0.0792869, 0, 0.0451134, 1.0439444], transfer: linear },
  "a98-rgb": {
    matrix: [0.576669, 0.1855582, 0.1882286, 0.297345, 0.6273636, 0.0752915, 0.0270314, 0.0706889, 0.9913375],
    transfer: (channel) => Math.sign(channel) * Math.abs(channel) ** (563 / 256),
  },
  rec2020: {
    matrix: [0.636958, 0.1446169, 0.168881, 0.2627002, 0.6779981, 0.0593017, 0, 0.0280727, 1.0609851],
    transfer: (channel) => (channel < 0.081242858 ? channel / 4.5 : ((channel + 0.099296827) / 1.099296827) ** (1 / 0.45)),
  },
  "prophoto-rgb": {
    matrix: [0.7977605, 0.1351858, 0.0313493, 0.2880711, 0.7118432, 0.0000857, 0, 0, 0.8251046],
    transfer: (channel) => (channel <= 1 / 32 ? channel / 16 : channel ** 1.8),
    d50: true,
  },
  xyz: { matrix: IDENTITY, transfer: (channel) => channel },
  "xyz-d65": { matrix: IDENTITY, transfer: (channel) => channel },
  "xyz-d50": { matrix: IDENTITY, transfer: (channel) => channel, d50: true },
};

function times(matrix: Matrix, [x, y, z]: readonly number[]): [number, number, number] {
  return [0, 3, 6].map((row) => matrix[row] * x + matrix[row + 1] * y + matrix[row + 2] * z) as [number, number, number];
}

function fromAxes(a: number, b: number): Hue {
  return { chroma: Math.hypot(a, b), hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

function spaceHue(space: string, channels: readonly number[]): Hue | null {
  const found = SPACES[space];
  if (!found) return null;
  const xyz = times(found.matrix, channels.map(found.transfer));
  const [l, m, s] = times(XYZ_TO_LMS, found.d50 ? times(D50_TO_D65, xyz) : xyz).map(Math.cbrt);
  return fromAxes(1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}

function rgbHue(red: number, green: number, blue: number): Hue {
  return spaceHue("srgb", [red, green, blue]) as Hue;
}

function hslRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

function hueOf(color: string): Hue | null {
  const value = color.trim().toLowerCase();
  if (value.startsWith("#")) {
    const digits = value.length === 4 ? [...value.slice(1)].map((digit) => digit + digit).join("") : value.slice(1, 7);
    if (!/^[0-9a-f]{6}$/iu.test(digits)) return null;
    const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16) / 255);
    return rgbHue(r, g, b);
  }
  const call = /^([a-z]+)\((.*)\)$/u.exec(value);
  if (!call) return null;
  const args = call[2].replace(/\bnone\b/gu, "0");
  const parts = args.match(/-?[\d.]+%?/gu) ?? [];
  const at = (index: number, whole: number) => {
    const part = parts[index] ?? "";
    return part.endsWith("%") ? (Number.parseFloat(part) / 100) * whole : Number.parseFloat(part);
  };
  switch (call[1]) {
    case "rgb":
    case "rgba":
      return rgbHue(at(0, 255) / 255, at(1, 255) / 255, at(2, 255) / 255);
    case "hsl":
    case "hsla":
      return rgbHue(...hslRgb(at(0, 360), at(1, 1) > 1 ? at(1, 1) / 100 : at(1, 1), at(2, 1) > 1 ? at(2, 1) / 100 : at(2, 1)));
    case "color": {
      const [space, ...channels] = args.trim().split(/[\s/]+/u);
      return spaceHue(space, channels.slice(0, 3).map((part) => (part.endsWith("%") ? Number.parseFloat(part) / 100 : Number.parseFloat(part))));
    }
    case "oklch":
      return { chroma: at(1, 0.4), hue: at(2, 360) };
    case "lch":
      return { chroma: at(1, 150) / LAB_TO_OKLAB, hue: at(2, 360) };
    case "oklab":
      return fromAxes(at(1, 0.4), at(2, 0.4));
    case "lab":
      return fromAxes(at(1, 125) / LAB_TO_OKLAB, at(2, 125) / LAB_TO_OKLAB);
    default:
      return null;
  }
}

export function warmAccent(color: string): boolean {
  const found = hueOf(color);
  return found !== null && found.chroma > GREY_CHROMA && found.hue >= WARM_HUES[0] && found.hue <= WARM_HUES[1];
}

export function accentFits(root: HTMLElement): boolean {
  const probe = document.createElement("span");
  probe.style.color = "var(--primary)";
  root.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const primary = getComputedStyle(root).getPropertyValue("--primary");
  return !warmAccent(resolved) && !warmAccent(primary);
}
