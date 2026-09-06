import {
  type DiagEdge,
  type DiagNode,
  type DiagramFontFamily,
  type DiagramModel,
  type EdgeArrow,
  type EdgeRouting,
  type EdgeStyle,
  type NodeShape,
  type StrokeStyle,
} from "./model";
import { modelToTikz, parseEmbeddedModel, PX_PER_CM } from "./tikz-serializer";

const MAX_SOURCE = 2_000_000;
const MAX_STATEMENTS = 20000;
const STYLE_DEPTH = 8;
const DEFAULT_NODE_DISTANCE_CM = 1;
const DEFAULT_FONT_PT = 10;
const MIN_NODE_W = 44;
const MIN_NODE_H = 28;
const ORIGIN_MARGIN = 40;
const HANDLE_TOLERANCE = 6;
// Unambiguous: a digit run can be matched exactly one way, so no input makes
// the engine backtrack over it.
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const DIMENSION = new RegExp(`^(${NUMBER})([a-z]{0,4})$`, "i");
const POLAR = new RegExp(`^(${NUMBER})\\s*:\\s*(${NUMBER})([a-z]{0,4})$`, "i");
const DASH_ON = new RegExp(`on\\s+(${NUMBER})\\s*([a-z]{0,4})`, "i");
const FONT_SIZE = new RegExp(`\\\\fontsize\\{\\s*(${NUMBER})\\s*[a-z]{0,4}\\s*\\}`);
const LABEL_TOLERANCE = 8;

export interface TikzImport {
  model: DiagramModel;
  unsupported: string[];
}

type OptionPair = [string, string | null];

interface Placement {
  dirX: -1 | 0 | 1;
  dirY: -1 | 0 | 1;
  distX: number | null;
  distY: number | null;
  ref: string;
  refAnchor: string | null;
  centred: boolean;
}

interface RawNode {
  id: string;
  named: boolean;
  label: string;
  options: OptionPair[];
  at: { x: number; y: number } | null;
  atRef: string | null;
  placement: Placement | null;
  midpoint: [string, string] | null;
  order: number;
}

interface PathPoint {
  ref: string | null;
  anchor: string | null;
  coord: { x: number; y: number } | null;
  relative: "none" | "move" | "offset";
}

type PathItem =
  | { kind: "point"; point: PathPoint }
  | { kind: "op"; op: string; options: OptionPair[] }
  | { kind: "label"; text: string; name: string | null; options: OptionPair[] };

interface RawPath {
  command: string;
  options: OptionPair[];
  items: PathItem[];
}

const NAMED_COLORS: Record<string, string> = {
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  yellow: "#ffff00",
  black: "#000000",
  gray: "#808080",
  grey: "#808080",
  white: "#ffffff",
  darkgray: "#404040",
  darkgrey: "#404040",
  lightgray: "#bfbfbf",
  lightgrey: "#bfbfbf",
  brown: "#bf8040",
  lime: "#bfff00",
  olive: "#808000",
  orange: "#ff8000",
  pink: "#ffbfbf",
  purple: "#bf0040",
  teal: "#008080",
  violet: "#800080",
};

const UNIT_CM: Record<string, number> = {
  cm: 1,
  mm: 0.1,
  pt: 0.0351459804,
  bp: 0.0352777778,
  in: 2.54,
  em: 0.35,
  ex: 0.15,
};

const LINE_WIDTH_PT: Record<string, number> = {
  "ultra thin": 0.1,
  "very thin": 0.2,
  thin: 0.4,
  semithick: 0.6,
  thick: 0.8,
  "very thick": 1.2,
  "ultra thick": 1.6,
};

const ANCHOR_HANDLE: Record<string, string> = {
  north: "t",
  south: "b",
  east: "r",
  west: "l",
  "north east": "t",
  "north west": "t",
  "south east": "b",
  "south west": "b",
  "north|east": "t",
  above: "t",
  below: "b",
  right: "r",
  left: "l",
};

function normalize(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

function stripComments(source: string): string {
  let out = "";
  let escaped = false;
  let inComment = false;
  for (const ch of source) {
    if (inComment) {
      if (ch === "\n") {
        inComment = false;
        out += ch;
      }
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      continue;
    }
    out += ch;
  }
  return out;
}

const CLOSERS: Record<string, string> = { "{": "}", "[": "]", "(": ")" };

function readBalanced(source: string, start: number): { body: string; end: number } | null {
  const open = source[start];
  const close = CLOSERS[open];
  if (!close) return null;
  let depth = 0;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return { body: source.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let escaped = false;
  for (const ch of source) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function parseOptions(text: string): OptionPair[] {
  const pairs: OptionPair[] = [];
  for (const raw of splitTopLevel(text, ",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const parts = splitTopLevel(entry, "=");
    if (parts.length === 1) {
      pairs.push([entry, null]);
      continue;
    }
    const key = parts[0].trim();
    const value = parts.slice(1).join("=").trim();
    pairs.push([key, unwrapBraces(value)]);
  }
  return pairs;
}

function unwrapBraces(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  const balanced = readBalanced(trimmed, 0);
  if (balanced && balanced.end === trimmed.length) return balanced.body.trim();
  return trimmed;
}

function lookup(options: OptionPair[], key: string): string | null | undefined {
  for (let i = options.length - 1; i >= 0; i--) {
    if (options[i][0] === key) return options[i][1];
  }
  return undefined;
}

function has(options: OptionPair[], key: string): boolean {
  return options.some(([name]) => name === key);
}

function toCm(value: string | null | undefined, fallback: number | null = null): number | null {
  if (value === null || value === undefined) return fallback;
  const match = DIMENSION.exec(value.trim());
  if (!match) return fallback;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return fallback;
  const unit = match[2].toLowerCase();
  if (!unit) return amount;
  const factor = UNIT_CM[unit];
  return factor === undefined ? amount : amount * factor;
}

function mixHex(a: string, b: string, weight: number): string {
  const clamp = Math.min(100, Math.max(0, weight)) / 100;
  const channel = (from: string, to: string, index: number) => {
    const start = Number.parseInt(from.slice(1 + index * 2, 3 + index * 2), 16);
    const end = Number.parseInt(to.slice(1 + index * 2, 3 + index * 2), 16);
    const mixed = Math.round(start * clamp + end * (1 - clamp));
    return mixed.toString(16).padStart(2, "0");
  };
  return `#${channel(a, b, 0)}${channel(a, b, 1)}${channel(a, b, 2)}`;
}

function resolveColor(spec: string, defs: Map<string, string>): string | null {
  const parts = spec.trim().split("!");
  const base = parts[0].trim().toLowerCase();
  if (!base || base === "none") return null;
  let current = defs.get(parts[0].trim()) ?? NAMED_COLORS[base] ?? null;
  if (!current && /^[0-9a-f]{6}$/i.test(base)) current = `#${base}`;
  if (!current) return null;
  for (let i = 1; i < parts.length; i += 2) {
    const weight = Number.parseFloat(parts[i]);
    if (!Number.isFinite(weight)) break;
    const otherName = parts[i + 1]?.trim();
    const other = otherName
      ? (defs.get(otherName) ?? NAMED_COLORS[otherName.toLowerCase()] ?? "#ffffff")
      : "#ffffff";
    current = mixHex(current, other, weight);
  }
  return current;
}

function parseCoordinate(text: string): { x: number; y: number } | null {
  const body = text.trim();
  const polar = POLAR.exec(body);
  if (polar) {
    const angle = (Number.parseFloat(polar[1]) * Math.PI) / 180;
    const radius = toCm(`${polar[2]}${polar[3]}`, 0) ?? 0;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  }
  const parts = splitTopLevel(body, ",");
  if (parts.length !== 2) return null;
  const x = toCm(parts[0].trim());
  const y = toCm(parts[1].trim());
  if (x === null || y === null) return null;
  return { x, y };
}

function unescapeLabel(text: string): string {
  return text
    .replace(/\\\\/g, "\n")
    .replace(/\\([&%#_${}])/g, "$1")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function styleName(key: string): { name: string; append: boolean } | null {
  const trimmed = key.trim();
  if (trimmed.endsWith("/.append style")) {
    return { name: trimmed.slice(0, -"/.append style".length).trim(), append: true };
  }
  if (trimmed.endsWith("/.style")) {
    return { name: trimmed.slice(0, -"/.style".length).trim(), append: false };
  }
  return null;
}

class StyleTable {
  private readonly styles = new Map<string, OptionPair[]>();

  define(pairs: OptionPair[]): void {
    for (const [key, value] of pairs) {
      const style = styleName(key);
      if (style === null || value === null) continue;
      const existing = style.append ? (this.styles.get(style.name) ?? []) : [];
      this.styles.set(style.name, [...existing, ...parseOptions(value)]);
    }
  }

  defineNamed(name: string, body: string): void {
    const existing = this.styles.get(name) ?? [];
    this.styles.set(name, [...existing, ...parseOptions(body)]);
  }

  expand(pairs: OptionPair[], depth = 0): OptionPair[] {
    if (depth >= STYLE_DEPTH) return pairs;
    const out: OptionPair[] = [];
    for (const pair of pairs) {
      const [key, value] = pair;
      if (styleName(key) !== null) continue;
      const style = value === null ? this.styles.get(key.trim()) : undefined;
      if (style) out.push(...this.expand(style, depth + 1));
      else out.push(pair);
    }
    return out;
  }

  everyNode(): OptionPair[] {
    return this.styles.get("every node") ?? [];
  }
}

function shapeOf(options: OptionPair[]): NodeShape {
  const named = lookup(options, "shape");
  const declares = (name: string) => has(options, name) || named === name;
  if (declares("circle")) return "circle";
  if (declares("ellipse")) return "ellipse";
  if (declares("diamond")) return "diamond";
  if (declares("trapezium")) return "parallelogram";
  if (declares("regular polygon")) return "circle";
  const rounded = has(options, "rounded corners") || lookup(options, "rounded corners") !== undefined;
  if (rounded) return "roundrect";
  const drawn = has(options, "draw") || lookup(options, "draw") !== undefined;
  const filled = lookup(options, "fill") !== undefined;
  if (!drawn && !filled) return "text";
  return "rectangle";
}

const DOTTED_KEYS = new Set(["dotted", "densely dotted", "loosely dotted"]);
const DASHED_KEYS = new Set([
  "dashed",
  "densely dashed",
  "loosely dashed",
  "dash dot",
  "densely dash dot",
  "loosely dash dot",
  "dash dot dot",
  "dashdotted",
]);

function strokeStyleOf(options: OptionPair[]): StrokeStyle {
  for (let i = options.length - 1; i >= 0; i--) {
    const [rawKey, value] = options[i];
    const key = rawKey.trim();
    if (DOTTED_KEYS.has(key)) return "dotted";
    if (DASHED_KEYS.has(key)) return "dashed";
    if (key === "solid") return "solid";
    if (key !== "dash pattern" || typeof value !== "string") continue;
    const on = DASH_ON.exec(value);
    const onCm = on ? (toCm(`${on[1]}${on[2]}`, 0) ?? 0) : 0;
    return onCm > 0 && onCm < 0.06 ? "dotted" : "dashed";
  }
  return "solid";
}

function lineWidthPx(options: OptionPair[]): number | undefined {
  const explicit = lookup(options, "line width");
  if (typeof explicit === "string") {
    const cm = toCm(explicit, null);
    if (cm !== null) return Math.max(1, Math.round(cm * PX_PER_CM));
  }
  for (const [key] of options) {
    const width = LINE_WIDTH_PT[key.trim()];
    if (width !== undefined) return Math.max(1, Math.round(width * UNIT_CM.pt * PX_PER_CM));
  }
  return undefined;
}

function fontOf(options: OptionPair[]): { size: number; family: DiagramFontFamily } {
  const font = lookup(options, "font");
  let size = DEFAULT_FONT_PT;
  let family: DiagramFontFamily = "serif";
  if (typeof font === "string") {
    if (font.includes("\\sffamily")) family = "sans";
    else if (font.includes("\\ttfamily")) family = "mono";
    const explicit = FONT_SIZE.exec(font);
    if (explicit) size = Number.parseFloat(explicit[1]);
    else if (/\\tiny/.test(font)) size = 5;
    else if (/\\scriptsize/.test(font)) size = 7;
    else if (/\\footnotesize/.test(font)) size = 8;
    else if (/\\small/.test(font)) size = 9;
    else if (/\\LARGE/.test(font)) size = 17;
    else if (/\\Large/.test(font)) size = 14;
    else if (/\\large/.test(font)) size = 12;
    else if (/\\Huge/.test(font)) size = 25;
    else if (/\\huge/.test(font)) size = 20;
  }
  return { size, family };
}

function labelWidthPx(label: string, fontSize: number): number {
  const lines = label.split("\n");
  const longest = lines.reduce((width, line) => Math.max(width, line.length), 0);
  return longest * fontSize * 0.62;
}

function labelHeightPx(label: string, fontSize: number): number {
  return label.split("\n").length * fontSize * 1.45;
}

function splitDistance(text: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const parts = text
    .split(/\s+and\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = toCm(parts[0], null);
  if (first === null) return fallback;
  if (parts.length === 1) return { x: first, y: first };
  const second = toCm(parts[1], first) ?? first;
  return { x: second, y: first };
}

const PLACEMENT_DIRECTIONS: Record<string, { dirX: -1 | 0 | 1; dirY: -1 | 0 | 1 }> = {
  right: { dirX: 1, dirY: 0 },
  left: { dirX: -1, dirY: 0 },
  above: { dirX: 0, dirY: 1 },
  below: { dirX: 0, dirY: -1 },
  "above right": { dirX: 1, dirY: 1 },
  "above left": { dirX: -1, dirY: 1 },
  "below right": { dirX: 1, dirY: -1 },
  "below left": { dirX: -1, dirY: -1 },
};

function parsePlacement(options: OptionPair[], distance: { x: number; y: number }): Placement | null {
  for (let i = options.length - 1; i >= 0; i--) {
    const [rawKey, rawValue] = options[i];
    if (rawValue === null) continue;
    const key = rawKey.trim();
    const legacy = key.endsWith(" of");
    const direction = PLACEMENT_DIRECTIONS[legacy ? key.slice(0, -3).trim() : key];
    if (!direction) continue;
    const value = rawValue.trim();
    if (legacy) {
      return {
        dirX: direction.dirX,
        dirY: direction.dirY,
        distX: distance.x,
        distY: distance.y,
        ref: value.split(".")[0].trim(),
        refAnchor: null,
        centred: true,
      };
    }
    const ofIndex = value.search(/(^|\s)of\s/);
    if (ofIndex < 0) continue;
    const amount = value.slice(0, ofIndex).trim();
    const target = value.slice(ofIndex).replace(/^\s*of\s+/, "").trim();
    const [ref, ...anchorParts] = target.split(".");
    const gap = amount ? splitDistance(amount, distance) : distance;
    return {
      dirX: direction.dirX,
      dirY: direction.dirY,
      distX: gap.x,
      distY: gap.y,
      ref: ref.trim(),
      refAnchor: anchorParts.length ? anchorParts.join(".").trim() : null,
      centred: false,
    };
  }
  return null;
}

function nodeDistance(
  options: OptionPair[],
  fallback: { x: number; y: number } = {
    x: DEFAULT_NODE_DISTANCE_CM,
    y: DEFAULT_NODE_DISTANCE_CM,
  },
): { x: number; y: number } {
  const raw = lookup(options, "node distance");
  if (typeof raw !== "string") return fallback;
  return splitDistance(raw, fallback);
}

const ARROW_TIPS = new Set([
  "stealth",
  "latex",
  "latex'",
  "to",
  "to reversed",
  "implies",
  "angle",
  "angle 45",
  "angle 60",
  "angle 90",
  "arc barb",
  "straight barb",
  "tee barb",
  "hooks",
  "hook",
  "bar",
  "circle",
  "square",
  "diamond",
  "triangle",
  "rectangle",
  "kite",
  "parenthesis",
  "halfcircle",
  "butt cap",
  "round cap",
  "triangle cap",
]);

type TipKind = "none" | "bar" | "arrow" | "unknown";

function tipKind(spec: string): TipKind {
  const text = spec.trim();
  if (!text) return "none";
  if (/^\|+$/.test(text)) return "bar";
  if (/^[<>]+$/.test(text)) return "arrow";
  if (text.startsWith("{")) return "arrow";
  const name = text.replace(/\[[^\]]*\]$/, "").trim().toLowerCase();
  if (ARROW_TIPS.has(name)) return "arrow";
  return "unknown";
}

function arrowOf(options: OptionPair[]): { arrow: EdgeArrow; reversed: boolean } {
  for (let i = options.length - 1; i >= 0; i--) {
    const [key, value] = options[i];
    if (value !== null) continue;
    const spec = key.trim();
    const dashIndex = topLevelDash(spec);
    if (dashIndex < 0) continue;
    const head = tipKind(spec.slice(0, dashIndex));
    const tail = tipKind(spec.slice(dashIndex + 1));
    if (head === "unknown" || tail === "unknown") continue;
    if (head === "arrow" && tail === "arrow") return { arrow: "both", reversed: false };
    if (tail === "arrow") return { arrow: "forward", reversed: false };
    if (head === "arrow") return { arrow: "forward", reversed: true };
    return { arrow: "none", reversed: false };
  }
  return { arrow: "none", reversed: false };
}

function topLevelDash(spec: string): number {
  let depth = 0;
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "-" && depth === 0) return i;
  }
  return -1;
}

function edgeStyleOf(options: OptionPair[]): EdgeStyle {
  return strokeStyleOf(options);
}

function anchorToHandle(anchor: string | null): string | null {
  if (!anchor) return null;
  const key = anchor.trim().toLowerCase();
  const mapped = ANCHOR_HANDLE[key];
  if (mapped) return mapped;
  const degrees = Number.parseFloat(key);
  if (Number.isFinite(degrees)) {
    const normalized = ((degrees % 360) + 360) % 360;
    if (normalized >= 45 && normalized < 135) return "t";
    if (normalized >= 135 && normalized < 225) return "l";
    if (normalized >= 225 && normalized < 315) return "b";
    return "r";
  }
  return null;
}

interface ScanState {
  taken: Set<string>;
  generated: number;
  styles: StyleTable;
  distance: { x: number; y: number };
  nodes: RawNode[];
  coordinates: Map<string, { x: number; y: number }>;
  paths: RawPath[];
  unsupported: Set<string>;
}

function collectColors(source: string, colors: Map<string, string>): void {
  const pattern = /\\definecolor\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}/g;
  for (const match of source.matchAll(pattern)) defineColor(match, colors);
}

function defineColor(match: RegExpMatchArray, colors: Map<string, string>): void {
  const [, name, model, spec] = match;
  const raw = model.trim();
  const kind = raw.toLowerCase();
  if (kind === "html") {
    const hex = spec.trim();
    if (/^[0-9a-f]{6}$/i.test(hex)) colors.set(name.trim(), `#${hex.toLowerCase()}`);
    return;
  }
  if (kind === "rgb" || kind === "rgb255" || kind === "rgb256") {
    const parts = spec.split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      const scale = raw === "rgb" ? 255 : 1;
      const hex = parts
        .map((part) => Math.max(0, Math.min(255, Math.round(part * scale))).toString(16).padStart(2, "0"))
        .join("");
      colors.set(name.trim(), `#${hex}`);
    }
    return;
  }
  if (kind !== "gray") return;
  const value = Number.parseFloat(spec.trim());
  if (!Number.isFinite(value)) return;
  const channel = Math.max(0, Math.min(255, Math.round(value * 255)))
    .toString(16)
    .padStart(2, "0");
  colors.set(name.trim(), `#${channel}${channel}${channel}`);
}

function freshId(state: ScanState): string {
  state.generated += 1;
  let candidate = `node${state.generated}`;
  while (state.taken.has(candidate)) {
    state.generated += 1;
    candidate = `node${state.generated}`;
  }
  state.taken.add(candidate);
  return candidate;
}

function readNodeStatement(statement: string, order: number, state: ScanState): RawNode | null {
  void order;
  const options: OptionPair[] = [];
  let name: string | null = null;
  let at: { x: number; y: number } | null = null;
  let atRef: string | null = null;
  let label = "";
  let index = statement.indexOf("\\node") >= 0 ? statement.indexOf("\\node") + 5 : statement.indexOf("\\coordinate") + 11;
  let expectPosition = false;
  while (index < statement.length) {
    const ch = statement[index];
    if (ch === " " || ch === "\n" || ch === "\t") {
      index += 1;
      continue;
    }
    if (ch === "[") {
      const balanced = readBalanced(statement, index);
      if (!balanced) break;
      options.push(...parseOptions(balanced.body));
      index = balanced.end;
      continue;
    }
    if (ch === "(") {
      const balanced = readBalanced(statement, index);
      if (!balanced) break;
      if (expectPosition) {
        at = parseCoordinate(balanced.body);
        if (!at) atRef = balanced.body.trim();
        expectPosition = false;
      } else if (name === null) {
        name = balanced.body.trim();
      }
      index = balanced.end;
      continue;
    }
    if (ch === "{") {
      const balanced = readBalanced(statement, index);
      if (!balanced) break;
      label = balanced.body;
      index = balanced.end;
      continue;
    }
    if (statement.startsWith("at", index)) {
      expectPosition = true;
      index += 2;
      continue;
    }
    index += 1;
  }
  const expanded = state.styles.expand([...state.styles.everyNode(), ...options]);
  const usable = name !== null && /^[\w :.-]+$/.test(name) && name.trim().length > 0;
  return {
    id: usable && name ? name : freshId(state),
    named: usable,
    midpoint: null,
    atRef,
    label: unescapeLabel(label),
    options: expanded,
    at,
    placement: parsePlacement(expanded, state.distance),
    order,
  };
}

const PATH_OPERATORS = ["--", "-|", "|-", "to", "edge", "cycle"];
const SHAPE_OPERATORS = ["rectangle", "circle", "ellipse", "arc", "grid", "parabola", "sin", "cos"];

function readPathNode(
  statement: string,
  from: number,
): { item: PathItem; end: number } {
  let index = from;
  const options: OptionPair[] = [];
  let name: string | null = null;
  let text = "";
  while (index < statement.length) {
    const next = statement[index];
    if (next === " " || next === "\n" || next === "\t") {
      index += 1;
      continue;
    }
    if (next === "[") {
      const balanced = readBalanced(statement, index);
      if (!balanced) break;
      options.push(...parseOptions(balanced.body));
      index = balanced.end;
      continue;
    }
    if (next === "(") {
      if (name !== null) break;
      const balanced = readBalanced(statement, index);
      if (!balanced) break;
      name = balanced.body.trim();
      index = balanced.end;
      continue;
    }
    if (next === "{") {
      const balanced = readBalanced(statement, index);
      if (!balanced) break;
      text = balanced.body;
      index = balanced.end;
    }
    break;
  }
  return {
    item: { kind: "label", text: unescapeLabel(text), name, options },
    end: index,
  };
}

function readPathStatement(statement: string, state: ScanState): RawPath | null {
  const head = /\\(draw|path|filldraw|fill)\b/.exec(statement);
  if (!head) return null;
  let index = head.index + head[0].length;
  const options: OptionPair[] = [];
  const items: PathItem[] = [];
  const lastOp = () => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === "point") return null;
      if (items[i].kind === "op") return items[i] as { kind: "op"; op: string; options: OptionPair[] };
    }
    return null;
  };
  while (index < statement.length) {
    const ch = statement[index];
    if (ch === " " || ch === "\n" || ch === "\t") {
      index += 1;
      continue;
    }
    if (ch === "[") {
      const balanced = readBalanced(statement, index);
      if (!balanced) break;
      const owner = lastOp();
      if (owner) owner.options.push(...parseOptions(balanced.body));
      else options.push(...parseOptions(balanced.body));
      index = balanced.end;
      continue;
    }
    if (statement.startsWith("++", index) || statement.startsWith("+(", index)) {
      const relative = statement.startsWith("++", index) ? "move" : "offset";
      const offset = relative === "move" ? 2 : 1;
      const balanced = readBalanced(statement, index + offset);
      if (!balanced) break;
      items.push({
        kind: "point",
        point: { ref: null, anchor: null, coord: parseCoordinate(balanced.body), relative },
      });
      index = balanced.end;
      continue;
    }
    if (ch === "(") {
      const balanced = readBalanced(statement, index);
      if (!balanced) break;
      const body = balanced.body.trim();
      const coord = parseCoordinate(body);
      if (coord) {
        items.push({ kind: "point", point: { ref: null, anchor: null, coord, relative: "none" } });
      } else {
        const [ref, ...anchor] = body.split(".");
        items.push({
          kind: "point",
          point: {
            ref: ref.trim(),
            anchor: anchor.length ? anchor.join(".").trim() : null,
            coord: null,
            relative: "none",
          },
        });
      }
      index = balanced.end;
      continue;
    }
    if (statement.startsWith("node", index)) {
      const read = readPathNode(statement, index + 4);
      items.push(read.item);
      index = read.end;
      continue;
    }
    if (statement.startsWith("coordinate", index)) {
      const read = readPathNode(statement, index + 10);
      index = read.end;
      continue;
    }
    if (statement.startsWith("..", index)) {
      items.push({ kind: "op", op: "..controls", options: [] });
      const rest = /^\.\.\s*(controls)?/.exec(statement.slice(index));
      index += rest ? rest[0].length : 2;
      continue;
    }
    const shape = SHAPE_OPERATORS.find((candidate) => statement.startsWith(candidate, index));
    if (shape) {
      items.push({ kind: "op", op: shape, options: [] });
      index += shape.length;
      continue;
    }
    const operator = PATH_OPERATORS.find((candidate) => statement.startsWith(candidate, index));
    if (operator) {
      items.push({ kind: "op", op: operator, options: [] });
      index += operator.length;
      continue;
    }
    index += 1;
  }
  void state;
  return { command: head[1], options, items };
}

function refAt(items: PathItem[], from: number, step: number): string | null {
  for (let i = from; i >= 0 && i < items.length; i += step) {
    const item = items[i];
    if (item.kind === "point" && item.point.ref) return item.point.ref;
  }
  return null;
}

function collectPathNodes(path: RawPath, state: ScanState): void {
  path.items.forEach((item, index) => {
    if (item.kind !== "label" || !item.name) return;
    const before = refAt(path.items, index - 1, -1);
    const after = refAt(path.items, index + 1, 1);
    if (!before || !after) return;
    state.nodes.push({
      id: item.name,
      named: true,
      midpoint: [before, after],
      atRef: null,
      label: item.text,
      options: state.styles.expand([...state.styles.everyNode(), ...item.options]),
      at: null,
      placement: null,
      order: state.nodes.length,
    });
  });
}

function collectNodeNames(body: string): Set<string> {
  const names = new Set<string>();
  for (const match of body.matchAll(/\\(?:node|coordinate)\b[^;{]{0,200}?\(([^)]{1,120})\)/g)) {
    const name = match[1].trim();
    if (/^[\w :.-]+$/.test(name)) names.add(name);
  }
  return names;
}

function readMacroCalls(source: string, state: ScanState): void {
  let index = 0;
  while (index < source.length) {
    const next = readMacroCall(source, index, state);
    index = next === null ? index + 1 : next;
  }
}

function readMacroCall(body: string, index: number, state: ScanState): number | null {
  if (body.startsWith("\\definecolor", index)) {
    let cursor = index + "\\definecolor".length;
    for (let group = 0; group < 3; group++) {
      const brace = body.indexOf("{", cursor);
      const balanced = brace >= 0 ? readBalanced(body, brace) : null;
      if (!balanced) return null;
      cursor = balanced.end;
    }
    return body[cursor] === ";" ? cursor + 1 : cursor;
  }
  if (body.startsWith("\\tikzset", index)) {
    const brace = body.indexOf("{", index);
    const balanced = brace >= 0 ? readBalanced(body, brace) : null;
    if (!balanced) return null;
    state.styles.define(parseOptions(balanced.body));
    return body[balanced.end] === ";" ? balanced.end + 1 : balanced.end;
  }
  if (!body.startsWith("\\tikzstyle", index)) return null;
  const brace = body.indexOf("{", index);
  const nameBlock = brace >= 0 ? readBalanced(body, brace) : null;
  if (!nameBlock) return null;
  const bracket = body.indexOf("[", nameBlock.end);
  const optionBlock = bracket >= 0 ? readBalanced(body, bracket) : null;
  if (!optionBlock) return null;
  state.styles.defineNamed(nameBlock.body.trim(), optionBlock.body);
  return body[optionBlock.end] === ";" ? optionBlock.end + 1 : optionBlock.end;
}

function readScopeMarker(body: string, index: number, scopes: OptionPair[][]): number | null {
  if (body.startsWith("\\end{scope}", index)) {
    if (scopes.length > 1) scopes.pop();
    return index + "\\end{scope}".length;
  }
  if (!body.startsWith("\\begin{scope}", index)) return null;
  const after = index + "\\begin{scope}".length;
  const balanced = body[after] === "[" ? readBalanced(body, after) : null;
  scopes.push(balanced ? parseOptions(balanced.body) : []);
  return balanced ? balanced.end : after;
}

function readEnvironmentMarker(body: string, index: number, state: ScanState): number | null {
  const opening = body.startsWith("\\begin{", index);
  if (!opening && !body.startsWith("\\end{", index)) return null;
  const brace = body.indexOf("{", index);
  const balanced = brace >= 0 ? readBalanced(body, brace) : null;
  if (!balanced) return index + 1;
  const environment = balanced.body.trim();
  if (opening && environment !== "scope") state.unsupported.add(environment);
  return balanced.end;
}

function applyNodeOrCoordinate(trimmed: string, scopeOptions: OptionPair[], state: ScanState): void {
  const node = readNodeStatement(trimmed, state.nodes.length, state);
  if (!node) return;
  node.options = state.styles.expand([...scopeOptions, ...node.options]);
  node.placement = parsePlacement(node.options, nodeDistance(node.options, state.distance));
  if (!trimmed.startsWith("\\coordinate")) {
    state.nodes.push(node);
    return;
  }
  if (node.at) {
    state.coordinates.set(node.id, { x: node.at.x * PX_PER_CM, y: -node.at.y * PX_PER_CM });
  }
}

function applyStatement(trimmed: string, scopeOptions: OptionPair[], state: ScanState): void {
  if (trimmed.startsWith("\\node") || trimmed.startsWith("\\coordinate")) {
    applyNodeOrCoordinate(trimmed, scopeOptions, state);
    return;
  }
  if (/^\\(draw|path|filldraw|fill)\b/.test(trimmed)) {
    const path = readPathStatement(trimmed, state);
    if (!path) return;
    path.options = state.styles.expand([...scopeOptions, ...path.options]);
    state.paths.push(path);
    collectPathNodes(path, state);
    return;
  }
  const command = /^\\([a-zA-Z@]{1,40})/.exec(trimmed);
  if (command) state.unsupported.add(command[1]);
}

function scan(body: string, state: ScanState, inherited: OptionPair[]): void {
  let index = 0;
  let statements = 0;
  const scopes: OptionPair[][] = [inherited];
  while (index < body.length) {
    if (statements >= MAX_STATEMENTS) {
      state.unsupported.add("truncated");
      return;
    }
    const ch = body[index];
    if (ch === " " || ch === "\n" || ch === "\t") {
      index += 1;
      continue;
    }
    const scope = readScopeMarker(body, index, scopes);
    if (scope !== null) {
      index = scope;
      continue;
    }
    const environment = readEnvironmentMarker(body, index, state);
    if (environment !== null) {
      index = environment;
      continue;
    }
    const macro = readMacroCall(body, index, state);
    if (macro !== null) {
      index = macro;
      continue;
    }
    const end = findStatementEnd(body, index);
    const trimmed = body.slice(index, end).trim();
    index = end + 1;
    statements += 1;
    if (trimmed) applyStatement(trimmed, scopes.flat(), state);
  }
}

function findStatementEnd(body: string, start: number): number {
  let depth = 0;
  let escaped = false;
  let firstSemicolon = -1;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";") {
      if (depth === 0) return i;
      if (firstSemicolon < 0) firstSemicolon = i;
    }
    else if (depth === 0 && (body.startsWith("\\begin{scope}", i) || body.startsWith("\\end{scope}", i)) && i > start) {
      return i - 1;
    }
  }
  return firstSemicolon >= 0 ? firstSemicolon : body.length;
}

export function extractPictureBody(source: string): { body: string; options: string } | null {
  const begin = source.indexOf("\\begin{tikzpicture}");
  if (begin < 0) return null;
  let index = begin + "\\begin{tikzpicture}".length;
  let options = "";
  const optionStart = source.slice(index).search(/\S/);
  if (optionStart >= 0 && source[index + optionStart] === "[") {
    const balanced = readBalanced(source, index + optionStart);
    if (balanced) {
      options = balanced.body;
      index = balanced.end;
    }
  }
  let depth = 1;
  let cursor = index;
  while (cursor < source.length && depth > 0) {
    const nextBegin = source.indexOf("\\begin{tikzpicture}", cursor);
    const nextEnd = source.indexOf("\\end{tikzpicture}", cursor);
    if (nextEnd < 0) break;
    if (nextBegin >= 0 && nextBegin < nextEnd) {
      depth += 1;
      cursor = nextBegin + "\\begin{tikzpicture}".length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return { body: source.slice(index, nextEnd), options };
    cursor = nextEnd + "\\end{tikzpicture}".length;
  }
  return { body: source.slice(index), options };
}

function sizeOf(node: RawNode): { w: number; h: number } {
  const { size } = fontOf(node.options);
  const minWidth = toCm(lookup(node.options, "minimum width"), null);
  const minHeight = toCm(lookup(node.options, "minimum height"), null);
  const minSize = toCm(lookup(node.options, "minimum size"), null);
  const innerSep = toCm(lookup(node.options, "inner sep"), 0.117) ?? 0.117;
  if (innerSep === 0 && minWidth !== null && minHeight !== null) {
    return { w: Math.round(minWidth * PX_PER_CM), h: Math.round(minHeight * PX_PER_CM) };
  }
  const textWidth = toCm(lookup(node.options, "text width"), null);
  const padding = innerSep * 2 * PX_PER_CM;
  const contentWidth = textWidth !== null ? textWidth * PX_PER_CM : labelWidthPx(node.label, size);
  const askedWidth = minWidth ?? minSize;
  const askedHeight = minHeight ?? minSize;
  const width = Math.max(
    (askedWidth ?? 0) * PX_PER_CM,
    contentWidth + padding,
    askedWidth === null || askedWidth === undefined ? MIN_NODE_W : 0,
  );
  const height = Math.max(
    (askedHeight ?? 0) * PX_PER_CM,
    labelHeightPx(node.label, size) + padding,
    askedHeight === null || askedHeight === undefined ? MIN_NODE_H : 0,
  );
  if (shapeOf(node.options) === "circle" && minWidth === null && minHeight === null) {
    const side = Math.round(Math.max(width, height));
    return { w: side, h: side };
  }
  return { w: Math.round(width), h: Math.round(height) };
}

interface PlacedNode extends RawNode {
  w: number;
  h: number;
  cx: number;
  cy: number;
  placed: boolean;
}

function anchorOffset(node: PlacedNode, anchor: string | null): { x: number; y: number } {
  if (!anchor) return { x: 0, y: 0 };
  const key = anchor.trim().toLowerCase();
  const half = { x: node.w / 2, y: node.h / 2 };
  const map: Record<string, { x: number; y: number }> = {
    north: { x: 0, y: -half.y },
    south: { x: 0, y: half.y },
    east: { x: half.x, y: 0 },
    west: { x: -half.x, y: 0 },
    "north east": { x: half.x, y: -half.y },
    "north west": { x: -half.x, y: -half.y },
    "south east": { x: half.x, y: half.y },
    "south west": { x: -half.x, y: half.y },
    center: { x: 0, y: 0 },
  };
  return map[key] ?? { x: 0, y: 0 };
}

function resolveRound(nodes: PlacedNode[], byId: Map<string, PlacedNode>, anchors: Map<string, { x: number; y: number }>): boolean {
  let progress = false;
  for (const node of nodes) {
    if (node.placed) continue;
    if (node.atRef) {
      const [refName, ...anchorParts] = node.atRef.split(".");
      const reference = byId.get(refName.trim());
      const point = anchors.get(refName.trim());
      if (reference?.placed) {
        const offset = anchorOffset(reference, anchorParts.join(".") || null);
        node.cx = reference.cx + offset.x;
        node.cy = reference.cy + offset.y;
        node.placed = true;
        progress = true;
      } else if (point) {
        node.cx = point.x;
        node.cy = point.y;
        node.placed = true;
        progress = true;
      }
      continue;
    }
    if (node.midpoint) {
      const from = byId.get(node.midpoint[0]);
      const to = byId.get(node.midpoint[1]);
      if (!from?.placed || !to?.placed) continue;
      node.cx = (from.cx + to.cx) / 2;
      node.cy = (from.cy + to.cy) / 2;
      node.placed = true;
      progress = true;
      continue;
    }
    if (!node.placement) continue;
    const reference = byId.get(node.placement.ref);
    const anchorPoint = anchors.get(node.placement.ref);
    if (!reference?.placed && !anchorPoint) continue;
    const gapX = (node.placement.distX ?? DEFAULT_NODE_DISTANCE_CM) * PX_PER_CM;
    const gapY = (node.placement.distY ?? DEFAULT_NODE_DISTANCE_CM) * PX_PER_CM;
    const base = reference?.placed
      ? { x: reference.cx, y: reference.cy }
      : { x: anchorPoint?.x ?? 0, y: anchorPoint?.y ?? 0 };
    const anchored = node.placement.refAnchor && reference?.placed;
    const offset = anchored
      ? anchorOffset(reference as PlacedNode, node.placement.refAnchor)
      : { x: 0, y: 0 };
    const referenceHalfX = anchored || !reference?.placed ? 0 : reference.w / 2;
    const referenceHalfY = anchored || !reference?.placed ? 0 : reference.h / 2;
    const halfSpanX = node.placement.centred ? 0 : referenceHalfX + node.w / 2;
    const halfSpanY = node.placement.centred ? 0 : referenceHalfY + node.h / 2;
    node.cx = base.x + offset.x + node.placement.dirX * (gapX + halfSpanX);
    node.cy = base.y + offset.y - node.placement.dirY * (gapY + halfSpanY);
    node.placed = true;
    progress = true;
  }
  return progress;
}

function placedBounds(nodes: PlacedNode[]): { minX: number; maxY: number } {
  const placed = nodes.filter((node) => node.placed);
  if (placed.length === 0) return { minX: 0, maxY: 0 };
  return {
    minX: Math.min(...placed.map((node) => node.cx - node.w / 2)),
    maxY: Math.max(...placed.map((node) => node.cy + node.h / 2)),
  };
}

function placeNodes(raw: RawNode[], anchors: Map<string, { x: number; y: number }>): PlacedNode[] {
  const nodes: PlacedNode[] = raw.map((node) => {
    const { w, h } = sizeOf(node);
    return { ...node, w, h, cx: 0, cy: 0, placed: false };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (!node.at) continue;
    node.cx = node.at.x * PX_PER_CM;
    node.cy = -node.at.y * PX_PER_CM;
    node.placed = true;
  }
  let seeded = nodes.some((node) => node.placed);
  for (let guard = 0; guard <= nodes.length; guard++) {
    while (resolveRound(nodes, byId, anchors)) {
      seeded = true;
    }
    const next = nodes.find((node) => !node.placed);
    if (!next) break;
    if (!seeded) {
      next.cx = 0;
      next.cy = 0;
      seeded = true;
    } else {
      const bounds = placedBounds(nodes);
      next.cx = bounds.minX + next.w / 2;
      next.cy = bounds.maxY + 80 + next.h / 2;
    }
    next.placed = true;
  }
  return nodes;
}

function handlePointOf(node: PlacedNode, handle: string): { x: number; y: number } {
  if (handle === "t") return { x: node.cx, y: node.cy - node.h / 2 };
  if (handle === "b") return { x: node.cx, y: node.cy + node.h / 2 };
  if (handle === "l") return { x: node.cx - node.w / 2, y: node.cy };
  return { x: node.cx + node.w / 2, y: node.cy };
}

function matchHandle(
  point: { x: number; y: number },
  nodes: PlacedNode[],
): { node: PlacedNode; handle: string } | null {
  for (const node of nodes) {
    for (const handle of ["t", "r", "b", "l"]) {
      const candidate = handlePointOf(node, handle);
      if (
        Math.abs(candidate.x - point.x) <= HANDLE_TOLERANCE &&
        Math.abs(candidate.y - point.y) <= HANDLE_TOLERANCE
      ) {
        return { node, handle };
      }
    }
  }
  return null;
}

interface Segment {
  ops: string[];
  options: OptionPair[];
  vias: { x: number; y: number }[];
  label: string | null;
  labelName: string | null;
  labelOptions: OptionPair[];
  isEdge: boolean;
  isShape: boolean;
}

function emptySegment(): Segment {
  return {
    ops: [],
    options: [],
    vias: [],
    label: null,
    labelName: null,
    labelOptions: [],
    isEdge: false,
    isShape: false,
  };
}

function dominantHandle(
  from: { x: number; y: number },
  to: { x: number; y: number },
  outgoing: boolean,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (outgoing) return dx >= 0 ? "r" : "l";
    return dx >= 0 ? "l" : "r";
  }
  if (outgoing) return dy >= 0 ? "b" : "t";
  return dy >= 0 ? "t" : "b";
}

function angleHandle(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const degrees = Number.parseFloat(value);
  if (!Number.isFinite(degrees)) return null;
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized >= 45 && normalized < 135) return "t";
  if (normalized >= 135 && normalized < 225) return "l";
  if (normalized >= 225 && normalized < 315) return "b";
  return "r";
}

function exitHandle(
  segment: Segment,
  source: { x: number; y: number },
  next: { x: number; y: number },
): string {
  const angle = angleHandle(lookup(segment.options, "out"));
  if (angle) return angle;
  if (segment.vias.length > 0) return dominantHandle(source, next, true);
  const first = segment.ops.find((op) => op === "-|" || op === "|-");
  if (first === "-|") return next.x >= source.x ? "r" : "l";
  if (first === "|-") return next.y >= source.y ? "b" : "t";
  return dominantHandle(source, next, true);
}

function entryHandle(
  segment: Segment,
  previous: { x: number; y: number },
  target: { x: number; y: number },
): string {
  const angle = angleHandle(lookup(segment.options, "in"));
  if (angle) return angle;
  const last = [...segment.ops].reverse().find((op) => op === "-|" || op === "|-");
  if (last === "-|") return previous.y <= target.y ? "t" : "b";
  if (last === "|-") return previous.x <= target.x ? "l" : "r";
  return dominantHandle(previous, target, false);
}

function routingOf(segment: Segment): EdgeRouting {
  if (segment.ops.some((op) => op === "..controls" || op === "to")) return "curved";
  if (segment.ops.some((op) => op === "-|" || op === "|-") || segment.vias.length > 0) {
    return "orthogonal";
  }
  return "straight";
}

function segmentDistance(
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function findTrailLabel(trail: { x: number; y: number }[], nodes: PlacedNode[]): PlacedNode | null {
  let best: PlacedNode | null = null;
  let bestDistance = LABEL_TOLERANCE;
  for (const node of nodes) {
    if (node.named || !node.label) continue;
    if (has(node.options, "draw") || lookup(node.options, "draw") !== undefined) continue;
    for (let i = 1; i < trail.length; i++) {
      const distance = segmentDistance({ x: node.cx, y: node.cy }, trail[i - 1], trail[i]);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function paintsAPath(path: RawPath): boolean {
  if (path.command !== "path") return true;
  if (has(path.options, "draw") || lookup(path.options, "draw") !== undefined) return true;
  if (path.items.some((item) => item.kind === "op" && item.op === "edge")) return true;
  return arrowOf(path.options).arrow !== "none";
}

interface PathWalk {
  path: RawPath;
  byId: Map<string, PlacedNode>;
  anchors: Map<string, { x: number; y: number }>;
  nodes: PlacedNode[];
  edges: DiagEdge[];
  consumed: Set<string>;
  previous: PathEnd | null;
  subpathStart: PathEnd | null;
  segment: Segment;
  cursor: { x: number; y: number } | null;
  trail: { x: number; y: number }[];
}

interface PathEnd {
  node: PlacedNode;
  anchor: string | null;
}

function adoptRouteLabel(walk: PathWalk, from: PathEnd, to: PathEnd, handles: [string, string]): string | null {
  if (walk.segment.label) return walk.segment.label;
  if (walk.segment.vias.length === 0) return null;
  const trail = [
    handlePointOf(from.node, handles[0]),
    ...walk.segment.vias,
    handlePointOf(to.node, handles[1]),
  ];
  const found = findTrailLabel(trail, walk.nodes);
  if (!found) return null;
  walk.consumed.add(found.id);
  return found.label;
}

function connectSegment(walk: PathWalk, from: PathEnd, to: PathEnd): void {
  if (from.node.id === to.node.id || walk.segment.isShape) return;
  const options = [...walk.path.options, ...walk.segment.options];
  const segment = { ...walk.segment, options };
  const { arrow, reversed } = arrowOf(options);
  const source = { x: from.node.cx, y: from.node.cy };
  const target = { x: to.node.cx, y: to.node.cy };
  const sourceHandle =
    anchorToHandle(from.anchor) ?? exitHandle(segment, source, segment.vias[0] ?? target);
  const targetHandle =
    anchorToHandle(to.anchor) ??
    entryHandle(segment, segment.vias[segment.vias.length - 1] ?? source, target);
  const routing = routingOf(segment);
  const label =
    routing === "orthogonal"
      ? adoptRouteLabel(walk, from, to, [sourceHandle, targetHandle])
      : segment.label;
  walk.edges.push({
    id: `edge${walk.edges.length}`,
    source: reversed ? to.node.id : from.node.id,
    target: reversed ? from.node.id : to.node.id,
    routing,
    arrow,
    style: edgeStyleOf(options),
    ...(label ? { label } : {}),
    sourceHandle: reversed ? targetHandle : sourceHandle,
    targetHandle: reversed ? sourceHandle : targetHandle,
  });
}

function applyOperator(walk: PathWalk, op: string, options: OptionPair[]): void {
  if (op === "edge") {
    walk.segment.isEdge = true;
    walk.segment.options.push(...options);
    return;
  }
  if (SHAPE_OPERATORS.includes(op)) {
    walk.segment.isShape = true;
    return;
  }
  if (op === "cycle") {
    if (walk.previous && walk.subpathStart) connectSegment(walk, walk.previous, walk.subpathStart);
    walk.previous = walk.subpathStart;
    walk.segment = emptySegment();
    return;
  }
  walk.segment.ops.push(op);
  walk.segment.options.push(...options);
}

function visit(walk: PathWalk, point: { x: number; y: number }): void {
  walk.cursor = point;
  walk.trail.push(point);
  if (walk.previous) walk.segment.vias.push(point);
}

function applyCoordinate(walk: PathWalk, point: PathPoint): void {
  if (!point.coord) return;
  const base: { x: number; y: number } = walk.cursor ?? { x: 0, y: 0 };
  const next: { x: number; y: number } =
    point.relative === "none"
      ? { x: point.coord.x * PX_PER_CM, y: -point.coord.y * PX_PER_CM }
      : { x: base.x + point.coord.x * PX_PER_CM, y: base.y - point.coord.y * PX_PER_CM };
  const previousCursor = walk.cursor;
  visit(walk, next);
  if (point.relative === "offset") walk.cursor = previousCursor;
}

function applyNodeReference(walk: PathWalk, point: PathPoint): void {
  if (!point.ref) return;
  const node = walk.byId.get(point.ref);
  if (!node) {
    const anchor = walk.anchors.get(point.ref);
    if (anchor) visit(walk, { ...anchor });
    return;
  }
  const here: PathEnd = { node, anchor: point.anchor };
  const startsNewSubpath =
    walk.previous !== null && walk.segment.ops.length === 0 && !walk.segment.isEdge;
  if (walk.previous && !startsNewSubpath) connectSegment(walk, walk.previous, here);
  if (!walk.segment.isEdge || !walk.previous) {
    walk.previous = here;
    if (startsNewSubpath || walk.subpathStart === null) walk.subpathStart = here;
  }
  walk.cursor = { x: node.cx, y: node.cy };
  walk.segment = emptySegment();
}

function connectCoordinateTrail(walk: PathWalk): void {
  if (walk.previous || walk.trail.length < 2) return;
  const start = matchHandle(walk.trail[0], walk.nodes);
  const finish = matchHandle(walk.trail[walk.trail.length - 1], walk.nodes);
  if (!start || !finish || start.node.id === finish.node.id) return;
  const { arrow, reversed } = arrowOf(walk.path.options);
  const labelNode = findTrailLabel(walk.trail, walk.nodes);
  if (labelNode) walk.consumed.add(labelNode.id);
  walk.edges.push({
    id: `edge${walk.edges.length}`,
    source: reversed ? finish.node.id : start.node.id,
    target: reversed ? start.node.id : finish.node.id,
    routing: walk.trail.length > 2 ? "orthogonal" : "straight",
    arrow,
    style: edgeStyleOf(walk.path.options),
    ...(labelNode?.label ? { label: labelNode.label } : {}),
    sourceHandle: reversed ? finish.handle : start.handle,
    targetHandle: reversed ? start.handle : finish.handle,
  });
}

function buildEdges(
  paths: RawPath[],
  nodes: PlacedNode[],
  anchors: Map<string, { x: number; y: number }>,
): { edges: DiagEdge[]; consumed: Set<string> } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const consumed = new Set<string>();
  const edges: DiagEdge[] = [];
  for (const path of paths) {
    if (!paintsAPath(path)) continue;
    const walk: PathWalk = {
      path,
      byId,
      anchors,
      nodes,
      edges,
      consumed,
      previous: null,
      subpathStart: null,
      segment: emptySegment(),
      cursor: null,
      trail: [],
    };
    for (const item of path.items) {
      if (item.kind === "op") applyOperator(walk, item.op, item.options);
      else if (item.kind === "label") applyPathLabel(walk, item);
      else if (item.point.coord) applyCoordinate(walk, item.point);
      else applyNodeReference(walk, item.point);
    }
    connectCoordinateTrail(walk);
  }
  return { edges, consumed };
}

function applyPathLabel(walk: PathWalk, item: { text: string; name: string | null }): void {
  if (item.name) walk.segment.labelName = item.name;
  else if (item.text) walk.segment.label = item.text;
}

function bareColor(options: OptionPair[], colors: Map<string, string>): string | null {
  for (let i = options.length - 1; i >= 0; i--) {
    const [key, value] = options[i];
    if (value !== null) continue;
    const name = key.trim();
    if (!colors.has(name) && !NAMED_COLORS[name.split("!")[0].toLowerCase()]) continue;
    const resolved = resolveColor(name, colors);
    if (resolved) return resolved;
  }
  return null;
}

function strokeColor(
  options: OptionPair[],
  spec: string | null | undefined,
  colors: Map<string, string>,
): string | null {
  if (typeof spec === "string") return resolveColor(spec, colors);
  if (!has(options, "draw")) return null;
  return bareColor(options, colors) ?? "#000000";
}

function toModelNodes(nodes: PlacedNode[], colors: Map<string, string>): DiagNode[] {
  return nodes.map((node) => {
    const { size, family } = fontOf(node.options);
    const fillSpec = lookup(node.options, "fill");
    const drawSpec = lookup(node.options, "draw");
    const textSpec = lookup(node.options, "text");
    const shape = shapeOf(node.options);
    const fill = typeof fillSpec === "string" ? resolveColor(fillSpec, colors) : null;
    const stroke = strokeColor(node.options, drawSpec, colors);
    const textColor =
      typeof textSpec === "string"
        ? resolveColor(textSpec, colors)
        : bareColor(node.options, colors);
    const radius = toCm(lookup(node.options, "rounded corners"), null);
    const model: DiagNode = {
      id: node.id,
      shape,
      x: Math.round(node.cx - node.w / 2),
      y: Math.round(node.cy - node.h / 2),
      w: node.w,
      h: node.h,
      label: node.label,
      fontSize: size,
      fontFamily: family,
    };
    if (fill) model.fill = fill;
    if (stroke) {
      model.stroke = stroke;
      model.strokeStyle = strokeStyleOf(node.options);
      const width = lineWidthPx(node.options);
      if (width !== undefined) model.strokeWidth = width;
    }
    if (textColor) model.textColor = textColor;
    if (radius !== null) model.radius = Math.round(radius * PX_PER_CM);
    else if (shape === "roundrect") model.radius = 6;
    return model;
  });
}

function normalizeOrigin(nodes: DiagNode[]): void {
  if (nodes.length === 0) return;
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const shiftX = minX < 0 ? ORIGIN_MARGIN - minX : 0;
  const shiftY = minY < 0 ? ORIGIN_MARGIN - minY : 0;
  if (shiftX === 0 && shiftY === 0) return;
  for (const node of nodes) {
    node.x += shiftX;
    node.y += shiftY;
  }
}

function boundSource(source: string): string {
  if (source.length <= MAX_SOURCE) return source;
  const cut = source.slice(0, MAX_SOURCE);
  const lastStatement = cut.lastIndexOf(";");
  return lastStatement > 0 ? cut.slice(0, lastStatement + 1) : cut;
}

export function importTikz(source: string): TikzImport {
  const unsupported = new Set<string>();
  if (typeof source !== "string" || source.length === 0) {
    return { model: { version: 1, nodes: [], edges: [] }, unsupported: [] };
  }
  const bounded = boundSource(source);
  if (source.length > MAX_SOURCE) unsupported.add("truncated");
  const clean = stripComments(normalize(bounded));
  const picture = extractPictureBody(clean);
  const body = picture ? picture.body : clean;
  const styles = new StyleTable();
  const colors = new Map<string, string>();
  const pictureOptions = picture ? parseOptions(picture.options) : [];
  styles.define(pictureOptions);
  collectColors(clean, colors);
  const state: ScanState = {
    taken: collectNodeNames(clean),
    generated: 0,
    styles,
    distance: nodeDistance(styles.expand(pictureOptions)),
    nodes: [],
    coordinates: new Map(),
    paths: [],
    unsupported,
  };
  if (picture) {
    readMacroCalls(clean.slice(0, clean.indexOf("\\begin{tikzpicture}")), state);
  }
  state.distance = nodeDistance(styles.expand(pictureOptions));
  scan(body, state, styles.expand(pictureOptions));
  const placed = placeNodes(state.nodes, state.coordinates);
  const { edges, consumed } = buildEdges(state.paths, placed, state.coordinates);
  const modelNodes = toModelNodes(
    placed.filter((node) => !consumed.has(node.id)),
    colors,
  );
  normalizeOrigin(modelNodes);
  const known = new Set(modelNodes.map((node) => node.id));
  const pageColor = /\\pagecolor\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(clean);
  const standalone = clean.includes("\\begin{document}");
  const model: DiagramModel = {
    version: 1,
    nodes: modelNodes,
    edges: edges.filter((edge) => known.has(edge.source) && known.has(edge.target)),
    ...(pageColor
      ? { background: resolveColor(pageColor[1], colors) ?? "" }
      : standalone
        ? { background: "" }
        : {}),
  };
  return { model, unsupported: [...unsupported] };
}

export function parseTikz(source: string): DiagramModel | null {
  const { model } = importTikz(source);
  return model.nodes.length > 0 ? model : null;
}

function canonical(source: string): string {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function visibleTikz(source: string): string {
  return canonical(
    source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("% oleafly-diagram-v1:"))
      .join("\n"),
  );
}

export function diagramFromSource(source: string): DiagramModel | null {
  const embedded = parseEmbeddedModel(source);
  if (embedded && canonical(modelToTikz(embedded)) === visibleTikz(source)) return embedded;
  return parseTikz(source) ?? embedded;
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) < 0.5;
}

function sameNode(a: DiagNode, b: DiagNode): boolean {
  return (
    a.shape === b.shape &&
    a.label === b.label &&
    sameNumber(a.x, b.x) &&
    sameNumber(a.y, b.y) &&
    sameNumber(a.w, b.w) &&
    sameNumber(a.h, b.h) &&
    (a.fill ?? "") === (b.fill ?? "") &&
    (a.stroke ?? "") === (b.stroke ?? "") &&
    (a.strokeStyle ?? "solid") === (b.strokeStyle ?? "solid") &&
    sameNumber(a.strokeWidth, b.strokeWidth) &&
    (a.textColor ?? "") === (b.textColor ?? "") &&
    sameNumber(a.fontSize, b.fontSize) &&
    (a.fontFamily ?? "serif") === (b.fontFamily ?? "serif") &&
    sameNumber(a.radius, b.radius)
  );
}

function sameEdge(a: DiagEdge, b: DiagEdge): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    a.routing === b.routing &&
    a.arrow === b.arrow &&
    a.style === b.style &&
    (a.label ?? "") === (b.label ?? "") &&
    (a.sourceHandle ?? "") === (b.sourceHandle ?? "") &&
    (a.targetHandle ?? "") === (b.targetHandle ?? "")
  );
}

export function sameDiagramModel(a: DiagramModel | null, b: DiagramModel | null): boolean {
  if (!a || !b) return a === b;
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  if ((a.background ?? "") !== (b.background ?? "")) return false;
  for (let i = 0; i < a.nodes.length; i++) {
    if (a.nodes[i].id !== b.nodes[i].id) return false;
  }
  const nodes = new Map(b.nodes.map((node) => [node.id, node]));
  for (const node of a.nodes) {
    const other = nodes.get(node.id);
    if (!other || !sameNode(node, other)) return false;
  }
  const edges = new Map(b.edges.map((edge) => [edge.id, edge]));
  for (const edge of a.edges) {
    const other = edges.get(edge.id);
    if (!other || !sameEdge(edge, other)) return false;
  }
  return true;
}
