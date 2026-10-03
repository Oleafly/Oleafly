import type {
  DiagEdge,
  DiagNode,
  DiagramFontFamily,
  DiagramModel,
  EdgeArrow,
  EdgeStyle,
  NodeShape,
  StrokeStyle,
} from "@oleafly/latex";
import { modelMarkLine, readModelMark, withoutModelMark } from "./languages/model-mark";
import type { DiagramNote, DiagramNoteKind, DiagramRead, DiagramReadOptions } from "./languages/types";

export const MERMAID_COMMENT = "%%";

export const MERMAID_NOTE_ENGLISH: Record<string, string> = {
  mermaidNotFlowchart: "Only flowcharts can be drawn on the canvas. This code is a {{detail}} diagram.",
  mermaidNoFlowchartHeader: "Only flowcharts can be drawn on the canvas. Start the code with flowchart or graph.",
  mermaidFrontmatter: "The frontmatter block is kept in the code.",
  mermaidDirective: "Config directives are kept in the code.",
  mermaidComment: "Comments are kept in the code.",
  mermaidAccessibility: "Accessibility titles and descriptions are kept in the code.",
  mermaidClick: "Click handlers are kept in the code.",
  mermaidStyleProperty: "The {{detail}} style property is kept in the code.",
  mermaidClassProperty: "The {{detail}} class property is kept in the code.",
  mermaidLinkStyleProperty: "The {{detail}} link style property is kept in the code.",
  mermaidNodeSetting: "The {{detail}} node setting is kept in the code.",
  mermaidEdgeSetting: "The {{detail}} edge setting is kept in the code.",
  mermaidInvisibleLink: "Invisible links are kept in the code.",
  mermaidLinkLength: "Link lengths are kept in the code.",
  mermaidSubgraphDirection: "Subgraph directions are kept in the code.",
  mermaidUnknownStatement: "Statements the canvas cannot read are kept in the code.",
  mermaidShape: "The {{detail}} shape is shown as the closest canvas shape.",
  mermaidThickLink: "Thick links are shown as normal lines.",
  mermaidArrowHead: "Circle and cross arrow heads are shown as arrows.",
  mermaidMarkdownLabel: "Markdown labels are shown as plain text.",
};

type Direction = "TB" | "BT" | "LR" | "RL";
type StyleKey = "fill" | "stroke" | "strokeWidth" | "strokeStyle" | "textColor" | "fontSize" | "fontFamily";

export type MermaidNodeStyle = Partial<Pick<DiagNode, StyleKey>>;

export type MermaidForm = { open: string; close: string } | { data: [string, string][] };

export interface MermaidVertexRef {
  id: string;
  from: number;
  to: number;
  owner: boolean;
  suffix: string;
}

export interface MermaidLinkRef {
  from: number;
  to: number;
  edges: string[];
}

export type MermaidItemKind =
  | "graph"
  | "subgraph"
  | "end"
  | "direction"
  | "style"
  | "class"
  | "linkStyle"
  | "click"
  | "edgeData"
  | "raw";

export interface MermaidItem {
  kind: MermaidItemKind;
  lead: string;
  text: string;
  depth: number;
  ids: string[];
  vertices?: MermaidVertexRef[];
  links?: MermaidLinkRef[];
  props?: string[];
  prefix?: string;
  indices?: number[] | null;
  className?: string;
}

export interface MermaidLinkRaw {
  thick?: boolean;
  heads?: [string, string];
  length?: number;
  id?: string;
}

export interface MermaidExtras {
  before: string;
  header: string;
  direction: string;
  tail: string;
  indent: string;
  items: MermaidItem[];
  model: DiagramModel;
  names: Record<string, string>;
  decls: Record<string, string>;
  forms: Record<string, MermaidForm>;
  bases: Record<string, MermaidNodeStyle>;
  parents: Record<string, string>;
  containers: string[];
  directions: Record<string, string>;
  links: Record<string, MermaidLinkRaw>;
  hidden: Record<string, [string, string]>;
}

export interface MermaidWriteOptions {
  extras?: MermaidExtras | null;
}

type NoteSink = (kind: DiagramNoteKind, code: string, detail?: string) => void;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LabelInfo {
  text: string;
  markdown: boolean;
}

interface ShapeHit {
  type: string;
  open: string;
  close: string;
  label: LabelInfo;
}

interface PVertex {
  name: string;
  from: number;
  to: number;
  shape?: ShapeHit;
  data?: [string, string][];
  classes: string[];
  suffix: string;
}

interface LinkBody {
  stroke: "normal" | "thick" | "dotted" | "invisible";
  end: string;
  length: number;
  label?: LabelInfo;
}

interface PLink extends LinkBody {
  from: number;
  to: number;
  start: string;
  id?: string;
}

interface PGraph {
  groups: PVertex[][];
  links: PLink[];
}

interface Stmt {
  kind: MermaidItemKind;
  text: string;
  lead: string;
  depth: number;
  graph?: PGraph;
  name?: string;
  names?: string[];
  props?: string[];
  prefix?: string;
  indices?: number[] | null;
  className?: string;
  title?: string;
  titled?: boolean;
  direction?: string;
  classDef?: boolean;
}

const STYLE_KEYS: StyleKey[] = ["fill", "stroke", "strokeWidth", "strokeStyle", "textColor", "fontSize", "fontFamily"];

const RESERVED_IDS = new Set([
  "end",
  "subgraph",
  "graph",
  "flowchart",
  "flowchart-elk",
  "style",
  "linkStyle",
  "classDef",
  "class",
  "click",
  "call",
  "href",
  "default",
  "direction",
  "interpolate",
  "_self",
  "_blank",
  "_parent",
  "_top",
]);

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  num: "#",
  nbsp: String.fromCodePoint(160),
};

const ESCAPES: Record<string, string> = {
  "#": "#35;",
  '"': "#quot;",
  "<": "#lt;",
  ">": "#gt;",
  "|": "#124;",
  "`": "#96;",
  "\\": "#92;",
  "&": "#amp;",
};

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  aqua: "#00ffff",
  cyan: "#00ffff",
  teal: "#008080",
  navy: "#000080",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  gold: "#ffd700",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  lightblue: "#add8e6",
  lightgreen: "#90ee90",
  lightyellow: "#ffffe0",
  coral: "#ff7f50",
  salmon: "#fa8072",
  violet: "#ee82ee",
  indigo: "#4b0082",
  beige: "#f5f5dc",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  tomato: "#ff6347",
  crimson: "#dc143c",
  skyblue: "#87ceeb",
  steelblue: "#4682b4",
};

const CLASSIC_SHAPES: Record<string, [NodeShape, boolean]> = {
  square: ["rectangle", true],
  round: ["roundrect", true],
  stadium: ["ellipse", true],
  circle: ["circle", true],
  diamond: ["diamond", true],
  lean_right: ["parallelogram", true],
  ellipse: ["ellipse", true],
  doublecircle: ["circle", false],
  subroutine: ["rectangle", false],
  cylinder: ["rectangle", false],
  hexagon: ["rectangle", false],
  odd: ["rectangle", false],
  lean_left: ["parallelogram", false],
  trapezoid: ["parallelogram", false],
  inv_trapezoid: ["parallelogram", false],
};

const DATA_SHAPES: Record<string, NodeShape> = {
  rect: "rectangle",
  proc: "rectangle",
  process: "rectangle",
  rectangle: "rectangle",
  squarerect: "rectangle",
  rounded: "roundrect",
  event: "roundrect",
  roundedrect: "roundrect",
  stadium: "ellipse",
  terminal: "ellipse",
  pill: "ellipse",
  circle: "circle",
  circ: "circle",
  diam: "diamond",
  decision: "diamond",
  diamond: "diamond",
  question: "diamond",
  "lean-r": "parallelogram",
  "lean-right": "parallelogram",
  "in-out": "parallelogram",
  text: "text",
};

const NEAR_DATA_SHAPES: Record<string, NodeShape> = {
  "sm-circ": "circle",
  start: "circle",
  "small-circle": "circle",
  "fr-circ": "circle",
  stop: "circle",
  "framed-circle": "circle",
  "dbl-circ": "circle",
  "double-circle": "circle",
  "f-circ": "circle",
  junction: "circle",
  "filled-circle": "circle",
  "cross-circ": "circle",
  summary: "circle",
  "crossed-circle": "circle",
  "lean-l": "parallelogram",
  "lean-left": "parallelogram",
  "out-in": "parallelogram",
  "trap-b": "parallelogram",
  priority: "parallelogram",
  "trapezoid-bottom": "parallelogram",
  trapezoid: "parallelogram",
  "trap-t": "parallelogram",
  manual: "parallelogram",
  "trapezoid-top": "parallelogram",
  "inv-trapezoid": "parallelogram",
};

const OPENERS: [string, string[], string[]][] = [
  ["(((", [")))"], ["doublecircle"]],
  ["((", ["))"], ["circle"]],
  ["([", ["])"], ["stadium"]],
  ["[[", ["]]"], ["subroutine"]],
  ["[(", [")]"], ["cylinder"]],
  ["[/", ["/]", String.raw`\]`], ["lean_right", "trapezoid"]],
  ["[\\", [String.raw`\]`, "/]"], ["lean_left", "inv_trapezoid"]],
  ["(-", ["-)"], ["ellipse"]],
  ["{{", ["}}"], ["hexagon"]],
  ["[", ["]"], ["square"]],
  ["(", [")"], ["round"]],
  ["{", ["}"], ["diamond"]],
  [">", ["]"], ["odd"]],
];

const BRACKETS: Record<Exclude<NodeShape, "text">, [string, string]> = {
  rectangle: ["[", "]"],
  roundrect: ["(", ")"],
  circle: ["((", "))"],
  ellipse: ["([", "])"],
  diamond: ["{", "}"],
  parallelogram: ["[/", "/]"],
};

const OTHER_DIAGRAMS = new Set([
  "sequenceDiagram",
  "classDiagram",
  "classDiagram-v2",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "gitGraph",
  "mindmap",
  "timeline",
  "zenuml",
  "sankey",
  "sankey-beta",
  "xychart",
  "xychart-beta",
  "block",
  "block-beta",
  "packet",
  "packet-beta",
  "kanban",
  "architecture",
  "architecture-beta",
  "radar-beta",
  "treemap",
  "treemap-beta",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
]);

const DASHED = "stroke-dasharray:6 4";
const HEADS = "xo>";
const NAME_CHAR = /[\p{L}\p{N}_.$]/u;
const PLAIN_ID = /^\w+(?:-\w+)*$/;
const PLAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N} _,.?!']*[\p{L}\p{N}_,.?!'])?$/u;
const BREAK = /<br\s*\/?>/gi;
const LINE_BREAK = /\r\n|\r|\n/;

const LAYER_GAP = 60;
const NODE_GAP = 40;
const PAD = 20;
const TITLE = 24;
const ORIGIN = 40;

const isBlank = (character: string | undefined) => character?.trim() === "";
const oneOf = (character: string, set: string) => character !== "" && set.includes(character);
const round2 = (value: number) => +value.toFixed(2);

function noteSink(notes: DiagramNote[]): NoteSink {
  return (kind, code, detail) => {
    if (notes.some((n) => n.kind === kind && n.code === code && n.detail === detail)) return;
    notes.push(detail === undefined ? { kind, code } : { kind, code, detail });
  };
}

function lineEnd(text: string, from: number): number {
  const index = text.indexOf("\n", from);
  return index < 0 ? text.length : index;
}

function entityEnd(text: string, at: number): number {
  let index = at + 1;
  while (index < text.length && /\w/.test(text[index])) index++;
  return index > at + 1 && text[index] === ";" ? index + 1 : -1;
}

function entityValue(name: string): string {
  if (/^\d+$/.test(name)) {
    const code = Number(name);
    return code <= 0x10ffff ? String.fromCodePoint(code) : `#${name};`;
  }
  return NAMED_ENTITIES[name] ?? `#${name};`;
}

function decodeEntities(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const end = text[index] === "#" ? entityEnd(text, index) : -1;
    if (end > 0) {
      out += entityValue(text.slice(index + 1, end - 1));
      index = end;
    } else {
      out += text[index];
      index++;
    }
  }
  return out;
}

const decodeText = (raw: string) => decodeEntities(raw.replace(BREAK, "\n")).trim();

function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2 && (text.startsWith('"') || text.startsWith("'")) && text.at(-1) === text[0]) return text.slice(1, -1);
  return text;
}

function labelInfo(raw: string): LabelInfo {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    const inner = text.slice(1, -1);
    if (inner.length >= 2 && inner.startsWith("`") && inner.endsWith("`")) {
      return { text: decodeText(inner.slice(1, -1)), markdown: true };
    }
    return { text: decodeText(inner), markdown: false };
  }
  return { text: decodeText(text), markdown: false };
}

function escapeLine(line: string): string {
  let out = "";
  for (const character of line) out += ESCAPES[character] ?? character;
  return out;
}

function quoted(label: string): string {
  const body = label.split(LINE_BREAK).map(escapeLine).join("<br>");
  return `"${body.trim() ? body : " "}"`;
}

function plainLabel(label: string): boolean {
  if (!PLAIN_LABEL.test(label) || label.includes("  ")) return false;
  return !label.split(" ").some((word) => RESERVED_IDS.has(word));
}

const labelText = (label: string) => (plainLabel(label) ? label : quoted(label));

const plainId = (id: string) => PLAIN_ID.test(id) && !RESERVED_IDS.has(id);

function trimUnderscores(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "_") start += 1;
  while (end > start && text[end - 1] === "_") end -= 1;
  return text.slice(start, end);
}

function sanitizeId(id: string): string {
  const base = trimUnderscores(id.replaceAll(/\W+/g, "_")) || "node";
  return RESERVED_IDS.has(base) ? `${base}_` : base;
}

function freeName(base: string, used: Set<string>): string {
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}_${suffix}`;
    suffix += 1;
  }
  return name;
}

function keptWriterNames(model: DiagramModel, extras: MermaidExtras, names: Map<string, string>, used: Set<string>): void {
  for (const raw of Object.values(extras.links)) if (raw.id) used.add(raw.id);
  for (const n of model.nodes) {
    const name = extras.names[n.id];
    if (name && !used.has(name) && !names.has(n.id)) {
      names.set(n.id, name);
      used.add(name);
    }
  }
}

function writerNames(model: DiagramModel, extras: MermaidExtras | null): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  if (extras) keptWriterNames(model, extras, names, used);
  for (const n of model.nodes) {
    if (names.has(n.id)) continue;
    const name = freeName(plainId(n.id) ? n.id : sanitizeId(n.id), used);
    names.set(n.id, name);
    used.add(name);
  }
  return names;
}

function normalizeColor(value: string, allowNone: boolean): string | null {
  const lowered = value.trim().toLowerCase();
  const declared = lowered.endsWith("!important") ? lowered.slice(0, -"!important".length).trimEnd() : lowered;
  const text = declared.replaceAll("\\", "");
  if (text === "none" || text === "transparent") return allowNone ? "" : null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    return digits.length === 3 ? `#${[...digits].map((d) => d + d).join("")}` : `#${digits}`;
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || (parts.length === 4 && Number(parts[3]) !== 1) || parts.length > 4) return null;
    const channels = parts.slice(0, 3).map(Number);
    if (channels.some((c) => !Number.isFinite(c) || c < 0 || c > 255)) return null;
    return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  }
  return NAMED_COLORS[text] ?? null;
}

function pixels(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(value.trim().toLowerCase());
  return match ? Number(match[1]) : null;
}

function points(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(pt|px)?$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  return match[2] === "pt" ? Number(match[1]) : round2(Number(match[1]) * 0.75);
}

function dashStyle(value: string): StrokeStyle | null {
  const text = value.trim().toLowerCase();
  if (text === "none" || text === "0") return "solid";
  const first = Number.parseFloat(text.split(/[\s,\\]+/)[0] ?? "");
  if (!Number.isFinite(first)) return null;
  return first <= 2 ? "dotted" : "dashed";
}

function fontFamily(value: string): DiagramFontFamily | null {
  const text = value.toLowerCase();
  if (["mono", "courier", "consolas", "menlo"].some((word) => text.includes(word))) return "mono";
  if (["sans", "arial", "helvetica", "trebuchet", "verdana"].some((word) => text.includes(word))) return "sans";
  if (["serif", "times", "georgia"].some((word) => text.includes(word))) return "serif";
  return null;
}

function propParts(prop: string): [string, string] {
  const colon = prop.indexOf(":");
  if (colon < 0) return [prop.trim(), ""];
  return [prop.slice(0, colon).trim(), prop.slice(colon + 1).trim()];
}

function styleEntry<K extends StyleKey>(key: K, value: MermaidNodeStyle[K] | null): MermaidNodeStyle | null {
  if (value === null) return null;
  const entry: MermaidNodeStyle = {};
  entry[key] = value;
  return entry;
}

function propStyle(key: string, value: string): MermaidNodeStyle | null {
  switch (key) {
    case "fill":
    case "stroke":
      return styleEntry(key, normalizeColor(value, true));
    case "color":
      return styleEntry("textColor", normalizeColor(value, false));
    case "stroke-width":
      return styleEntry("strokeWidth", pixels(value));
    case "stroke-dasharray":
      return styleEntry("strokeStyle", dashStyle(value));
    case "font-size":
      return styleEntry("fontSize", points(value));
    case "font-family":
      return styleEntry("fontFamily", fontFamily(value));
    default:
      return null;
  }
}

function applyProp(style: MermaidNodeStyle, prop: string): boolean {
  const [key, value] = propParts(prop);
  const entry = propStyle(key, value);
  if (!entry) return false;
  Object.assign(style, entry);
  return true;
}

function unmappedProps(props: string[]): string[] {
  return props.filter((prop) => !applyProp({}, prop));
}

function splitProps(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  const push = () => {
    const value = current.trim();
    if (value) out.push(value);
    current = "";
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\" && text[index + 1] === ",") {
      current += String.raw`\,`;
      index++;
      continue;
    }
    if (character === "(") depth++;
    else if (character === ")" && depth > 0) depth--;
    if (character === "," && depth === 0) push();
    else current += character;
  }
  push();
  return out;
}

function frontmatterEnd(text: string): number {
  let start = 0;
  while (isBlank(text[start])) start++;
  if (!text.startsWith("---", start) || text.slice(start + 3, lineEnd(text, start)).trim() !== "") return 0;
  let position = lineEnd(text, start) + 1;
  while (position < text.length) {
    const end = lineEnd(text, position);
    const line = text.slice(position, end);
    if (line.startsWith("---") && line.slice(3).trim() === "") return end;
    position = end + 1;
  }
  return 0;
}

function bracketDepth(character: string, depth: number): number {
  if (character === "[" || character === "(" || character === "{") return depth + 1;
  if ((character === "]" || character === ")" || character === "}") && depth > 0) return depth - 1;
  return depth;
}

function statementEnd(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if ((character === "\n" || character === ";") && depth === 0) break;
    if (character === '"') {
      const close = text.indexOf('"', index + 1);
      index = close < 0 ? text.length : close + 1;
      continue;
    }
    const entity = character === "#" ? entityEnd(text, index) : -1;
    if (entity > 0) {
      index = entity;
      continue;
    }
    depth = bracketDepth(character, depth);
    index++;
  }
  return index;
}

function scanStatements(text: string, start: number): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if (character === ";" || isBlank(character)) {
      index++;
      continue;
    }
    let end: number;
    if (text.startsWith("%%{", index)) {
      const close = text.indexOf("}%%", index + 3);
      end = close < 0 ? lineEnd(text, index) : close + 3;
    } else if (text.startsWith("%%", index)) {
      end = lineEnd(text, index);
    } else {
      end = statementEnd(text, index);
    }
    let to = end;
    while (to > index && isBlank(text[to - 1])) to--;
    spans.push({ from: index, to });
    index = Math.max(end, index + 1);
  }
  return spans;
}

function firstWord(text: string): string {
  let end = 0;
  while (end < text.length && !isBlank(text[end]) && text[end] !== ";") end++;
  return text.slice(0, end);
}

function normalizeDirection(token: string): Direction {
  const text = token.trim();
  if (text === "BT" || text === "^") return "BT";
  if (text === "LR" || text === ">") return "LR";
  if (text === "RL" || text === "<") return "RL";
  return "TB";
}

class Scan {
  text: string;
  pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  get done(): boolean {
    return this.pos >= this.text.length;
  }

  peek(offset = 0): string {
    return this.text[this.pos + offset] ?? "";
  }

  at(value: string): boolean {
    return this.text.startsWith(value, this.pos);
  }

  spaces(): void {
    while (!this.done && isBlank(this.peek())) this.pos++;
  }

  run(character: string): number {
    const start = this.pos;
    while (this.peek() === character) this.pos++;
    return this.pos - start;
  }
}

function nameEnd(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if (NAME_CHAR.test(character)) {
      index++;
      continue;
    }
    const next = text[index + 1] ?? "";
    if (character === "-" && index > start && next !== "." && NAME_CHAR.test(next)) {
      index++;
      continue;
    }
    break;
  }
  return index;
}

function classNameEnd(text: string, start: number): number {
  let index = start;
  while (index < text.length && (NAME_CHAR.test(text[index]) || text[index] === "-")) index++;
  return index;
}

function shapeContent(text: string, start: number, closes: string[]): { end: number; content: string; which: number } | null {
  let index = start;
  while (isBlank(text[index])) index++;
  if (text[index] === '"') {
    const close = text.indexOf('"', index + 1);
    if (close >= 0) {
      let after = close + 1;
      while (isBlank(text[after])) after++;
      const which = closes.findIndex((c) => text.startsWith(c, after));
      if (which >= 0) return { end: after + closes[which].length, content: text.slice(index, close + 1), which };
    }
  }
  let best: { at: number; which: number } | null = null;
  closes.forEach((close, which) => {
    const at = text.indexOf(close, start);
    if (at >= 0 && (!best || at < best.at)) best = { at, which };
  });
  if (!best) return null;
  const found: { at: number; which: number } = best;
  return { end: found.at + closes[found.which].length, content: text.slice(start, found.at), which: found.which };
}

function parseShape(s: Scan): ShapeHit | null | undefined {
  for (const [open, closes, types] of OPENERS) {
    if (!s.at(open)) continue;
    if (open === "[" && s.peek(1) === "|") return null;
    const hit = shapeContent(s.text, s.pos + open.length, closes);
    if (!hit) return null;
    s.pos = hit.end;
    return { type: types[hit.which], open, close: closes[hit.which], label: labelInfo(hit.content) };
  }
  return undefined;
}

function dataEntries(body: string): [string, string][] {
  const parts: string[] = [];
  let current = "";
  let quote = "";
  for (const character of body) {
    if (quote) {
      if (character === quote) quote = "";
      current += character;
      continue;
    }
    if (character === '"') quote = character;
    if (character === "," || character === "\n") {
      parts.push(current);
      current = "";
    } else current += character;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [key, value] = propParts(part);
      return [key, value];
    });
}

function readData(s: Scan): [string, string][] | null {
  const start = s.pos + 2;
  let index = start;
  let depth = 1;
  while (index < s.text.length) {
    const character = s.text[index];
    if (character === '"') {
      const close = s.text.indexOf('"', index + 1);
      if (close < 0) return null;
      index = close + 1;
      continue;
    }
    if (character === "{") depth++;
    else if (character === "}") {
      depth--;
      if (depth === 0) break;
    }
    index++;
  }
  if (depth !== 0) return null;
  s.pos = index + 1;
  return dataEntries(s.text.slice(start, index));
}

type VertexStep = "more" | "done" | "fail";

function vertexShapeStep(s: Scan, vertex: PVertex): VertexStep {
  const shape = parseShape(s);
  if (shape === null) return "fail";
  if (!shape) return "done";
  vertex.shape = shape;
  return "more";
}

function vertexClassStep(s: Scan, vertex: PVertex): VertexStep {
  const start = s.pos;
  const close = classNameEnd(s.text, s.pos + 3);
  if (close === s.pos + 3) return "fail";
  vertex.classes.push(s.text.slice(s.pos + 3, close));
  s.pos = close;
  vertex.suffix += s.text.slice(start, close);
  return "more";
}

function vertexStep(s: Scan, vertex: PVertex): VertexStep {
  if (!vertex.shape && !vertex.data) {
    const step = vertexShapeStep(s, vertex);
    if (step !== "done") return step;
  }
  if (!vertex.data && s.at("@{")) {
    const data = readData(s);
    if (!data) return "fail";
    vertex.data = data;
    return "more";
  }
  if (s.at(":::")) return vertexClassStep(s, vertex);
  return "done";
}

function parseVertex(s: Scan): PVertex | null {
  const from = s.pos;
  const end = nameEnd(s.text, s.pos);
  if (end === s.pos) return null;
  const vertex: PVertex = { name: s.text.slice(s.pos, end), from, to: end, classes: [], suffix: "" };
  s.pos = end;
  let step = vertexStep(s, vertex);
  while (step === "more") step = vertexStep(s, vertex);
  if (step === "fail") return null;
  vertex.to = s.pos;
  return vertex;
}

function headType(head: string): string {
  if (head === "<" || head === ">") return "point";
  if (head === "x") return "cross";
  if (head === "o") return "circle";
  return "open";
}

function textEnd(text: string, from: number, needle: string): number {
  let index = from;
  while (isBlank(text[index])) index++;
  if (text[index] === '"') {
    const close = text.indexOf('"', index + 1);
    if (close >= 0) index = close + 1;
  }
  return text.indexOf(needle, index);
}

function solidLink(s: Scan, character: string, start: string): LinkBody | null {
  const count = s.run(character);
  if (count < 2) return null;
  const stroke = character === "=" ? "thick" : "normal";
  if (oneOf(s.peek(), HEADS)) {
    const end = s.peek();
    s.pos++;
    return { stroke, end, length: count - 1 };
  }
  if (count >= 3) return { stroke, end: "", length: count - 2 };
  const close = textEnd(s.text, s.pos, character + character);
  if (close < 0) return null;
  const label = labelInfo(s.text.slice(s.pos, close));
  s.pos = close;
  const closing = s.run(character);
  let end = "";
  if (oneOf(s.peek(), HEADS)) {
    end = s.peek();
    s.pos++;
  } else if (closing < 3) return null;
  if (start && headType(start) !== headType(end)) return null;
  return { stroke, end, length: end ? closing - 1 : closing - 2, label };
}

function dottedLink(s: Scan, start: string): LinkBody | null {
  const lead = s.peek() === "-" ? 1 : 0;
  s.pos += lead;
  const dots = s.run(".");
  if (dots === 0) return null;
  if (s.peek() === "-") {
    s.pos++;
    const end = oneOf(s.peek(), HEADS) ? s.peek() : "";
    s.pos += end.length;
    return { stroke: "dotted", end, length: dots };
  }
  if (lead !== 1 || dots !== 1) return null;
  const close = textEnd(s.text, s.pos, ".");
  if (close < 0) return null;
  const label = labelInfo(s.text.slice(s.pos, close));
  s.pos = close;
  const closing = s.run(".");
  if (s.peek() !== "-") return null;
  s.pos++;
  const end = oneOf(s.peek(), HEADS) ? s.peek() : "";
  s.pos += end.length;
  if (start && headType(start) !== headType(end)) return null;
  return { stroke: "dotted", end, length: closing, label };
}

function pipeEnd(text: string, from: number): number {
  let index = from;
  while (isBlank(text[index])) index++;
  if (text[index] === '"') {
    const close = text.indexOf('"', index + 1);
    if (close >= 0) index = close + 1;
  }
  return text.indexOf("|", index);
}

function parseLink(s: Scan): PLink | null {
  const from = s.pos;
  let id: string | undefined;
  const idEnd = nameEnd(s.text, s.pos);
  const afterAt = s.text[idEnd + 1] ?? "";
  if (idEnd > s.pos && s.text[idEnd] === "@" && afterAt !== "{" && afterAt !== '"') {
    id = s.text.slice(s.pos, idEnd);
    s.pos = idEnd + 1;
  }
  let start = "";
  if (oneOf(s.peek(), "<ox") && oneOf(s.peek(1), "-=.")) {
    start = s.peek();
    s.pos++;
  }
  let body: LinkBody | null = null;
  if (s.at("~~~")) body = { stroke: "invisible", end: "", length: s.run("~") - 2 };
  else if (s.peek() === "=") body = solidLink(s, "=", start);
  else if (s.at("--")) body = solidLink(s, "-", start);
  else if (s.at("-.") || s.peek() === ".") body = dottedLink(s, start);
  if (!body) return null;
  const save = s.pos;
  s.spaces();
  if (s.peek() === "|") {
    const close = pipeEnd(s.text, s.pos + 1);
    if (close < 0) return null;
    body.label = labelInfo(s.text.slice(s.pos + 1, close));
    s.pos = close + 1;
  } else s.pos = save;
  return { ...body, from, to: s.pos, start, id };
}

function parseGroup(s: Scan): PVertex[] | null {
  const first = parseVertex(s);
  if (!first) return null;
  const group = [first];
  for (;;) {
    const save = s.pos;
    s.spaces();
    if (s.peek() !== "&") {
      s.pos = save;
      return group;
    }
    s.pos++;
    s.spaces();
    const next = parseVertex(s);
    if (!next) return null;
    group.push(next);
  }
}

function parseGraph(text: string): PGraph | null {
  const s = new Scan(text);
  const first = parseGroup(s);
  if (!first) return null;
  const graph: PGraph = { groups: [first], links: [] };
  for (;;) {
    s.spaces();
    if (s.done) return graph;
    const link = parseLink(s);
    if (!link) return null;
    s.spaces();
    const group = parseGroup(s);
    if (!group) return null;
    graph.links.push(link);
    graph.groups.push(group);
  }
}

function parseSubgraph(rest: string): Partial<Stmt> {
  if (rest.startsWith('"')) {
    const title = labelInfo(rest).text;
    return /\s/.test(title) ? { kind: "subgraph", title, titled: true } : { kind: "subgraph", name: title, title, titled: true };
  }
  const end = nameEnd(rest, 0);
  const name = rest.slice(0, end);
  const after = rest.slice(end).trim();
  if (!name) return { kind: "subgraph", title: decodeText(rest), titled: true };
  if (!after) return { kind: "subgraph", name, title: name, titled: false };
  if (after.startsWith("[") && after.endsWith("]")) {
    return { kind: "subgraph", name, title: labelInfo(after.slice(1, -1)).text, titled: true };
  }
  return { kind: "subgraph", title: decodeText(rest), titled: true };
}

function parseLinkStyle(rest: string): Partial<Stmt> | null {
  const target = firstWord(rest);
  let remainder = rest.slice(target.length).trim();
  let indices: number[] | null = null;
  if (target !== "default") {
    const parts = target.split(",");
    if (parts.some((part) => !/^\d+$/.test(part))) return null;
    indices = parts.map(Number);
  }
  let prefix = "";
  if (remainder.startsWith("interpolate")) {
    const curve = firstWord(remainder.slice("interpolate".length).trim());
    prefix = `interpolate ${curve}`;
    remainder = remainder.slice(remainder.indexOf(curve) + curve.length).trim();
  }
  return { kind: "linkStyle", indices, prefix, props: splitProps(remainder) };
}

function classifyStyling(word: string, rest: string): Partial<Stmt> | null {
  if (word === "linkStyle") return parseLinkStyle(rest);
  if (word !== "style" && word !== "classDef" && word !== "class") return null;
  const target = firstWord(rest);
  if (!target) return null;
  const after = rest.slice(target.length).trim();
  if (word === "style") return { kind: "style", name: target, props: splitProps(after) };
  if (word === "classDef") return { kind: "raw", classDef: true, names: target.split(","), props: splitProps(after) };
  return after ? { kind: "class", names: target.split(","), className: firstWord(after) } : null;
}

function classifyKeyword(word: string, rest: string, notes: NoteSink): Partial<Stmt> | null {
  if (word.startsWith("accTitle") || word.startsWith("accDescr")) {
    notes("kept", "mermaidAccessibility");
    return { kind: "raw" };
  }
  if (word === "subgraph") return parseSubgraph(rest);
  if (word === "end" && !rest) return { kind: "end" };
  if (word === "direction" && rest) return { kind: "direction", direction: rest };
  if (word === "click" && rest) {
    notes("kept", "mermaidClick");
    return { kind: "click", name: firstWord(rest) };
  }
  return classifyStyling(word, rest);
}

function classify(text: string, notes: NoteSink): Partial<Stmt> {
  if (text.startsWith("%%{")) {
    notes("kept", "mermaidDirective");
    return { kind: "raw" };
  }
  if (text.startsWith("%%")) {
    notes("kept", "mermaidComment");
    return { kind: "raw" };
  }
  const word = firstWord(text);
  const rest = text.slice(word.length).trim();
  const keyword = classifyKeyword(word, rest, notes);
  if (keyword) return keyword;
  const graph = parseGraph(text);
  if (graph) return { kind: "graph", graph };
  notes("kept", "mermaidUnknownStatement");
  return { kind: "raw" };
}

interface Vertex {
  name: string;
  key: number;
  shape?: [NodeShape, boolean, string];
  label?: LabelInfo;
  form?: MermaidForm;
  classes: string[];
  styles: string[][];
  owner?: [number, number];
  first?: [number, number];
}

interface Group {
  name: string;
  title: string;
  key: number;
  stmt: number;
  members: string[];
  direction?: string;
  classes: string[];
  styles: string[][];
}

interface Conn {
  source: string;
  target: string;
  link: PLink;
  stmt: number;
  index: number;
}

interface Analysis {
  stmts: Stmt[];
  vertices: Map<string, Vertex>;
  groups: Map<string, Group>;
  conns: Conn[];
  classDefs: Map<string, string[]>;
  claims: Map<string, string>;
}

function dataShape(value: string): [NodeShape, boolean] {
  const key = unquote(value).toLowerCase();
  const exact = DATA_SHAPES[key];
  if (exact) return [exact, true];
  return [NEAR_DATA_SHAPES[key] ?? "rectangle", false];
}

interface Frame {
  group: Group;
  body: string[];
}

interface AnalyzeState {
  notes: NoteSink;
  vertices: Map<string, Vertex>;
  groups: Map<string, Group>;
  conns: Conn[];
  classDefs: Map<string, string[]>;
  claims: Map<string, string>;
  linkIds: Set<string>;
  stack: Frame[];
  key: number;
}

function closeFrame(state: AnalyzeState, frame: Frame): Group {
  const group = frame.group;
  if (!group.name) group.name = `subGraph${state.groups.size}`;
  for (const name of frame.body) {
    if (state.claims.has(name) || name === group.name || group.members.includes(name)) continue;
    state.claims.set(name, group.name);
    group.members.push(name);
  }
  state.groups.set(group.name, group);
  state.stack.at(-1)?.body.push(group.name);
  return group;
}

function touchVertex(state: AnalyzeState, name: string, at: [number, number]): Vertex {
  let vertex = state.vertices.get(name);
  if (!vertex) {
    vertex = { name, key: state.key++, classes: [], styles: [], first: at };
    state.vertices.set(name, vertex);
  }
  return vertex;
}

function applyVertexData(state: AnalyzeState, vertex: Vertex, data: [string, string][], at: [number, number]): void {
  for (const [dataKey, value] of data) {
    if (dataKey === "shape") vertex.shape = [...dataShape(value), unquote(value).toLowerCase()];
    else if (dataKey === "label") vertex.label = { text: decodeText(unquote(value)), markdown: false };
    else state.notes("kept", "mermaidNodeSetting", dataKey);
  }
  vertex.form = { data };
  vertex.owner = at;
}

function analyzeVertex(state: AnalyzeState, v: PVertex, at: [number, number]): void {
  const vertex = touchVertex(state, v.name, at);
  if (v.shape) {
    vertex.shape = [...(CLASSIC_SHAPES[v.shape.type] ?? ["rectangle", false]), v.shape.type];
    vertex.label = v.shape.label;
    vertex.form = { open: v.shape.open, close: v.shape.close };
    vertex.owner = at;
  }
  if (v.data) applyVertexData(state, vertex, v.data, at);
  vertex.classes.push(...v.classes);
  state.stack.at(-1)?.body.push(v.name);
}

function analyzeGraph(state: AnalyzeState, stmt: Stmt, graph: PGraph, index: number): void {
  const lone = graph.groups.length === 1 && graph.groups[0].length === 1 ? graph.groups[0][0] : null;
  if (lone?.data && !lone.shape && state.linkIds.has(lone.name)) {
    stmt.kind = "edgeData";
    for (const [dataKey] of lone.data) state.notes("kept", "mermaidEdgeSetting", dataKey);
    return;
  }
  let sequence = 0;
  for (const group of graph.groups) {
    for (const v of group) analyzeVertex(state, v, [index, sequence++]);
  }
  graph.links.forEach((link, linkIndex) => {
    for (const source of graph.groups[linkIndex]) {
      for (const target of graph.groups[linkIndex + 1]) {
        state.conns.push({ source: source.name, target: target.name, link, stmt: index, index: linkIndex });
      }
    }
  });
}

function analyzeSubgraph(state: AnalyzeState, stmt: Stmt, index: number): void {
  const group: Group = {
    name: stmt.name ?? "",
    title: stmt.title ?? "",
    key: state.key++,
    stmt: index,
    members: [],
    classes: [],
    styles: [],
  };
  state.stack.push({ group, body: [] });
}

function analyzeEnd(state: AnalyzeState, stmt: Stmt): void {
  const frame = state.stack.pop();
  if (!frame) {
    stmt.kind = "raw";
    state.notes("kept", "mermaidUnknownStatement");
    return;
  }
  stmt.depth = state.stack.length;
  stmt.name = closeFrame(state, frame).name;
}

function analyzeDirection(state: AnalyzeState, stmt: Stmt): void {
  const frame = state.stack.at(-1);
  if (frame) {
    frame.group.direction = stmt.direction;
    state.notes("kept", "mermaidSubgraphDirection");
  } else stmt.kind = "raw";
}

function analyzeStyle(state: AnalyzeState, stmt: Stmt, name: string, index: number): void {
  for (const prop of unmappedProps(stmt.props ?? [])) state.notes("kept", "mermaidStyleProperty", propParts(prop)[0]);
  const frame = state.stack.find((f) => f.group.name === name);
  if (frame) frame.group.styles.push(stmt.props ?? []);
  else if (state.groups.has(name)) state.groups.get(name)?.styles.push(stmt.props ?? []);
  else touchVertex(state, name, [index, 0]).styles.push(stmt.props ?? []);
}

function analyzeRules(state: AnalyzeState, stmt: Stmt): void {
  if (stmt.classDef) {
    for (const prop of unmappedProps(stmt.props ?? [])) state.notes("kept", "mermaidClassProperty", propParts(prop)[0]);
    for (const name of stmt.names ?? []) state.classDefs.set(name, stmt.props ?? []);
  }
  if (stmt.kind === "linkStyle") {
    if (stmt.prefix) state.notes("kept", "mermaidLinkStyleProperty", "interpolate");
    for (const prop of stmt.props ?? []) {
      const [propKey] = propParts(prop);
      if (propKey !== "stroke-dasharray") state.notes("kept", "mermaidLinkStyleProperty", propKey);
    }
  }
}

function analyzeStatement(state: AnalyzeState, stmt: Stmt, index: number): void {
  stmt.depth = state.stack.length;
  if (stmt.kind === "graph" && stmt.graph) analyzeGraph(state, stmt, stmt.graph, index);
  else if (stmt.kind === "subgraph") analyzeSubgraph(state, stmt, index);
  else if (stmt.kind === "end") analyzeEnd(state, stmt);
  else if (stmt.kind === "direction") analyzeDirection(state, stmt);
  else if (stmt.kind === "style" && stmt.name) analyzeStyle(state, stmt, stmt.name, index);
  else analyzeRules(state, stmt);
}

function analyze(stmts: Stmt[], notes: NoteSink): Analysis {
  const linkIds = new Set<string>();
  for (const stmt of stmts) for (const link of stmt.graph?.links ?? []) if (link.id) linkIds.add(link.id);
  const state: AnalyzeState = {
    notes,
    vertices: new Map<string, Vertex>(),
    groups: new Map<string, Group>(),
    conns: [],
    classDefs: new Map<string, string[]>(),
    claims: new Map<string, string>(),
    linkIds,
    stack: [],
    key: 0,
  };
  stmts.forEach((stmt, index) => analyzeStatement(state, stmt, index));
  for (let frame = state.stack.pop(); frame; frame = state.stack.pop()) closeFrame(state, frame);
  for (const stmt of stmts) {
    if (stmt.kind !== "class") continue;
    for (const name of stmt.names ?? []) {
      const target = state.groups.get(name) ?? state.vertices.get(name);
      target?.classes.push(stmt.className ?? "");
    }
  }
  const { vertices, groups, conns, classDefs, claims } = state;
  return { stmts, vertices, groups, conns, classDefs, claims };
}

function styleOf(classes: string[], styles: string[][], classDefs: Map<string, string[]>) {
  const base: MermaidNodeStyle = {};
  for (const prop of classDefs.get("default") ?? []) applyProp(base, prop);
  for (const name of classes) for (const prop of classDefs.get(name) ?? []) applyProp(base, prop);
  const own: MermaidNodeStyle = { ...base };
  for (const props of styles) for (const prop of props) applyProp(own, prop);
  return { base, own };
}

function estimateSize(shape: NodeShape, label: string): { w: number; h: number } {
  const lines = label.split(LINE_BREAK);
  const width = Math.max(...lines.map((line) => line.length)) * 7.5;
  const height = lines.length * 16;
  const r = Math.round;
  if (shape === "circle") {
    const d = r(Math.max(72, width + 24, height + 24));
    return { w: d, h: d };
  }
  if (shape === "ellipse") return { w: r(Math.max(110, width * 1.3 + 30)), h: r(Math.max(64, height + 32)) };
  if (shape === "diamond") return { w: r(Math.max(92, width * 1.4 + 24)), h: r(Math.max(92, height * 1.4 + 40)) };
  if (shape === "parallelogram") return { w: r(Math.max(140, width + 60)), h: r(Math.max(60, height + 28)) };
  if (shape === "text") return { w: r(Math.max(90, width + 16)), h: r(Math.max(32, height + 12)) };
  return { w: r(Math.max(120, width + 32)), h: r(Math.max(56, height + 24)) };
}

interface LayoutGraph {
  children: Map<string | null, string[]>;
  parent: Map<string, string | null>;
  containers: Set<string>;
  sizes: Map<string, { w: number; h: number }>;
  titled: Set<string>;
  edges: [string, string][];
  directions: Map<string, Direction>;
}

interface Block {
  w: number;
  h: number;
  pos: Map<string, { x: number; y: number }>;
  dims: Map<string, { w: number; h: number }>;
}

function itemWithin(g: LayoutGraph, id: string, block: string | null): string | null {
  let current: string | null = id;
  while (current !== null) {
    const parent: string | null = g.parent.get(current) ?? null;
    if (parent === block) return current;
    current = parent;
  }
  return null;
}

function backEdges(count: number, out: number[][], edges: [number, number][]): Set<number> {
  const state = new Array<number>(count).fill(0);
  const back = new Set<number>();
  const visit = (v: number) => {
    state[v] = 1;
    for (const k of out[v]) {
      const w = edges[k][1];
      if (state[w] === 1) back.add(k);
      else if (state[w] === 0) visit(w);
    }
    state[v] = 2;
  };
  for (let v = 0; v < count; v++) if (state[v] === 0) visit(v);
  return back;
}

function longestPathLayers(count: number, out: number[][], edges: [number, number][], back: Set<number>): number[] {
  const indegree = new Array<number>(count).fill(0);
  edges.forEach(([, b], k) => {
    if (!back.has(k)) indegree[b]++;
  });
  const layer = new Array<number>(count).fill(0);
  const queue: number[] = [];
  for (let v = 0; v < count; v++) if (indegree[v] === 0) queue.push(v);
  while (queue.length) {
    const v = queue.shift() as number;
    for (const k of out[v]) {
      if (back.has(k)) continue;
      const w = edges[k][1];
      layer[w] = Math.max(layer[w], layer[v] + 1);
      indegree[w]--;
      if (indegree[w] === 0) queue.push(w);
    }
  }
  return layer;
}

function orderLayers(filled: number[][], edges: [number, number][]): void {
  for (let l = 1; l < filled.length; l++) {
    const previous = new Map(filled[l - 1].map((v, i) => [v, i]));
    const weight = new Map<number, number>();
    filled[l].forEach((v, i) => {
      const preds = edges.filter(([a, b]) => b === v && previous.has(a)).map(([a]) => previous.get(a) ?? 0);
      weight.set(v, preds.length ? preds.reduce((sum, p) => sum + p, 0) / preds.length : i);
    });
    filled[l] = [...filled[l]].sort((a, b) => (weight.get(a) ?? 0) - (weight.get(b) ?? 0));
  }
}

function layerItems(count: number, edges: [number, number][]): number[][] {
  const out: number[][] = Array.from({ length: count }, () => []);
  edges.forEach(([a], k) => {
    out[a].push(k);
  });
  const layer = longestPathLayers(count, out, edges, backEdges(count, out, edges));
  const layers: number[][] = [];
  for (let v = 0; v < count; v++) {
    layers[layer[v]] ??= [];
    layers[layer[v]].push(v);
  }
  const filled = layers.filter((l) => l !== undefined);
  orderLayers(filled, edges);
  return filled;
}

function layoutBlock(g: LayoutGraph, id: string | null, inherited: Direction): Block {
  const dir = (id !== null ? g.directions.get(id) : undefined) ?? inherited;
  const kids = g.children.get(id) ?? [];
  const blocks = new Map<string, Block>();
  const sizes = kids.map((kid) => {
    if (!g.containers.has(kid)) return g.sizes.get(kid) ?? { w: 120, h: 56 };
    const block = layoutBlock(g, kid, dir);
    blocks.set(kid, block);
    return { w: block.w, h: block.h };
  });
  const index = new Map(kids.map((kid, i) => [kid, i]));
  const seen = new Set<string>();
  const lifted: [number, number][] = [];
  for (const [source, target] of g.edges) {
    const a = itemWithin(g, source, id);
    const b = itemWithin(g, target, id);
    if (a === null || b === null || a === b || seen.has(`${a}\n${b}`)) continue;
    seen.add(`${a}\n${b}`);
    lifted.push([index.get(a) ?? 0, index.get(b) ?? 0]);
  }
  const layers = layerItems(kids.length, lifted);
  const vertical = dir === "TB" || dir === "BT";
  const main = (i: number) => (vertical ? sizes[i].h : sizes[i].w);
  const cross = (i: number) => (vertical ? sizes[i].w : sizes[i].h);
  const thickness = layers.map((layer) => Math.max(...layer.map(main)));
  const widths = layers.map((layer) => layer.reduce((sum, i) => sum + cross(i), 0) + NODE_GAP * (layer.length - 1));
  const maxCross = widths.length ? Math.max(...widths) : 0;
  const totalMain = thickness.reduce((sum, t) => sum + t, 0) + LAYER_GAP * Math.max(0, layers.length - 1);
  const placed = new Map<number, { x: number; y: number }>();
  let offset = 0;
  layers.forEach((layer, l) => {
    let running = (maxCross - widths[l]) / 2;
    for (const i of layer) {
      const m = offset + (thickness[l] - main(i)) / 2;
      const c = running;
      running += cross(i) + NODE_GAP;
      if (vertical) placed.set(i, { x: c, y: dir === "TB" ? m : totalMain - m - main(i) });
      else placed.set(i, { x: dir === "LR" ? m : totalMain - m - main(i), y: c });
    }
    offset += thickness[l] + LAYER_GAP;
  });
  const left = id !== null ? PAD : 0;
  const titleGap = id !== null && g.titled.has(id) ? TITLE : 0;
  const top = id !== null ? PAD + titleGap : 0;
  const pos = new Map<string, { x: number; y: number }>();
  const dims = new Map<string, { w: number; h: number }>();
  kids.forEach((kid, i) => {
    const p = placed.get(i) ?? { x: 0, y: 0 };
    const x = p.x + left;
    const y = p.y + top;
    pos.set(kid, { x, y });
    const block = blocks.get(kid);
    if (!block) return;
    dims.set(kid, { w: block.w, h: block.h });
    for (const [inner, q] of block.pos) pos.set(inner, { x: q.x + x, y: q.y + y });
    for (const [inner, d] of block.dims) dims.set(inner, d);
  });
  const w = (vertical ? maxCross : totalMain) + 2 * left;
  const h = (vertical ? totalMain : maxCross) + top + left;
  const min = id !== null ? (g.sizes.get(id) ?? { w: 0, h: 0 }) : { w: 0, h: 0 };
  return { w: Math.max(w, min.w), h: Math.max(h, min.h), pos, dims };
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.w <= outer.x + outer.w + 0.5 &&
    inner.y + inner.h <= outer.y + outer.h + 0.5
  );
}

function overlapsRect(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin
  );
}

function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

function nestParents(ids: string[], rects: Map<string, Rect>, candidates: Set<string>): Map<string, string> {
  const index = new Map(ids.map((id, i) => [id, i]));
  const area = (id: string) => {
    const r = rects.get(id);
    return r ? r.w * r.h : 0;
  };
  const outranks = (a: string, b: string) =>
    area(a) > area(b) || (area(a) === area(b) && (index.get(a) ?? 0) < (index.get(b) ?? 0));
  const parents = new Map<string, string>();
  for (const id of ids) {
    const rect = rects.get(id);
    if (!rect) continue;
    let best: string | null = null;
    for (const candidate of candidates) {
      const outer = rects.get(candidate);
      if (candidate === id || !outer || !containsRect(outer, rect) || !outranks(candidate, id)) continue;
      if (best === null || outranks(best, candidate)) best = candidate;
    }
    if (best !== null) parents.set(id, best);
  }
  return parents;
}

function descendantsOf(g: LayoutGraph, id: string): string[] {
  const out: string[] = [];
  for (const kid of g.children.get(id) ?? []) out.push(kid, ...descendantsOf(g, kid));
  return out;
}

function ancestorsOf(g: LayoutGraph, id: string): Set<string> {
  const out = new Set<string>();
  let current = g.parent.get(id) ?? null;
  while (current !== null) {
    out.add(current);
    current = g.parent.get(current) ?? null;
  }
  return out;
}

type Size = { w: number; h: number };
type Point = { x: number; y: number };
type HintUnit = { root: string; block?: Block };

interface HintLayout {
  g: LayoutGraph;
  dir: Direction;
  vertical: boolean;
  leaves: Map<string, Rect>;
  boxes: Map<string, Rect>;
}

function besideVertically(anchor: Rect, size: Size, ahead: number): Point {
  return {
    x: anchor.x + anchor.w / 2 - size.w / 2,
    y: ahead > 0 ? anchor.y + anchor.h + LAYER_GAP : anchor.y - LAYER_GAP - size.h,
  };
}

function besideHorizontally(anchor: Rect, size: Size, ahead: number): Point {
  return {
    x: ahead > 0 ? anchor.x + anchor.w + LAYER_GAP : anchor.x - LAYER_GAP - size.w,
    y: anchor.y + anchor.h / 2 - size.h / 2,
  };
}

function linkedCandidate(layout: HintLayout, inside: Set<string>, size: Size): Point | null {
  const { g, dir, leaves } = layout;
  const flip = dir === "BT" || dir === "RL" ? -1 : 1;
  for (const [source, target] of g.edges) {
    const forward = inside.has(target) && !inside.has(source);
    const backward = inside.has(source) && !inside.has(target);
    if (!forward && !backward) continue;
    const anchor = leaves.get(forward ? source : target);
    if (!anchor) continue;
    const ahead = (forward ? 1 : -1) * flip;
    return layout.vertical ? besideVertically(anchor, size, ahead) : besideHorizontally(anchor, size, ahead);
  }
  return null;
}

function fallbackCandidate(layout: HintLayout, root: string, size: Size): Point {
  const { g, dir, leaves } = layout;
  const parent = g.parent.get(root) ?? null;
  const siblings = [...leaves].filter(([id]) => (g.parent.get(id) ?? null) === parent).map(([, r]) => r);
  const pool = siblings.length ? siblings : [...leaves.values()];
  if (!pool.length) return { x: ORIGIN, y: ORIGIN };
  const box = union(pool);
  if (dir === "TB") return { x: box.x, y: box.y + box.h + LAYER_GAP };
  if (dir === "BT") return { x: box.x, y: box.y - LAYER_GAP - size.h };
  if (dir === "LR") return { x: box.x + box.w + LAYER_GAP, y: box.y };
  return { x: box.x - LAYER_GAP - size.w, y: box.y };
}

function freeSpot(candidate: Point, size: Size, obstacles: Rect[], vertical: boolean): Rect {
  const step = (vertical ? size.w : size.h) + NODE_GAP;
  for (let attempt = 0; attempt < 80; attempt++) {
    const k = attempt % 2 === 0 ? attempt / 2 : -(attempt + 1) / 2;
    const shifted = {
      x: Math.round(candidate.x + (vertical ? k * step : 0)),
      y: Math.round(candidate.y + (vertical ? 0 : k * step)),
      ...size,
    };
    if (!obstacles.some((o) => overlapsRect(shifted, o, NODE_GAP / 2))) return shifted;
  }
  return { x: Math.round(candidate.x), y: Math.round(candidate.y), ...size };
}

function placeUnit(layout: HintLayout, unit: HintUnit): void {
  const { g, leaves, boxes } = layout;
  const size = unit.block ? { w: unit.block.w, h: unit.block.h } : (g.sizes.get(unit.root) ?? { w: 120, h: 56 });
  const inside = new Set([unit.root, ...descendantsOf(g, unit.root)]);
  const candidate = linkedCandidate(layout, inside, size) ?? fallbackCandidate(layout, unit.root, size);
  const ancestors = ancestorsOf(g, unit.root);
  const obstacles = [
    ...[...leaves].filter(([id]) => !inside.has(id)).map(([, r]) => r),
    ...[...boxes].filter(([id]) => !inside.has(id) && !ancestors.has(id)).map(([, r]) => r),
  ];
  const chosen = freeSpot(candidate, size, obstacles, layout.vertical);
  if (!unit.block) {
    leaves.set(unit.root, chosen);
    return;
  }
  boxes.set(unit.root, chosen);
  for (const [id, p] of unit.block.pos) {
    const dims = unit.block.dims.get(id);
    const rect = { x: chosen.x + p.x, y: chosen.y + p.y, ...(dims ?? g.sizes.get(id) ?? { w: 120, h: 56 }) };
    (g.containers.has(id) ? boxes : leaves).set(id, rect);
  }
}

function layoutWithHint(
  g: LayoutGraph,
  ids: string[],
  dir: Direction,
  known: Map<string, Rect>,
): Map<string, Rect> {
  const leaves = new Map<string, Rect>();
  const boxes = new Map<string, Rect>();
  for (const [id, rect] of known) (g.containers.has(id) ? boxes : leaves).set(id, { ...rect });
  const units: HintUnit[] = [];
  const collect = (parent: string | null) => {
    for (const kid of g.children.get(parent) ?? []) {
      const container = g.containers.has(kid);
      if (known.has(kid)) {
        if (container) collect(kid);
      } else if (container && descendantsOf(g, kid).every((d) => !known.has(d))) {
        units.push({ root: kid, block: layoutBlock(g, kid, dir) });
      } else if (container) collect(kid);
      else units.push({ root: kid });
    }
  };
  collect(null);
  const vertical = dir === "TB" || dir === "BT";
  const layout: HintLayout = { g, dir, vertical, leaves, boxes };
  const place = (unit: HintUnit) => placeUnit(layout, unit);
  const placeAll = (pending: HintUnit[]) => {
    const queue = [...pending];
    while (queue.length) {
      let next = queue.findIndex((unit) => {
        const inside = new Set([unit.root, ...descendantsOf(g, unit.root)]);
        return g.edges.some(
          ([s, t]) => (inside.has(s) && !inside.has(t) && leaves.has(t)) || (inside.has(t) && !inside.has(s) && leaves.has(s)),
        );
      });
      if (next < 0) next = 0;
      place(queue.splice(next, 1)[0]);
    }
  };
  const depth = (id: string) => ancestorsOf(g, id).size;
  const sizeBoxes = () => {
    const order = [...g.containers].sort((a, b) => depth(b) - depth(a));
    for (const id of order) {
      const kids = (g.children.get(id) ?? [])
        .map((kid) => leaves.get(kid) ?? boxes.get(kid))
        .filter((r): r is Rect => r !== undefined);
      const current = boxes.get(id);
      if (!kids.length) {
        if (!current) boxes.set(id, { x: ORIGIN, y: ORIGIN, ...(g.sizes.get(id) ?? { w: 120, h: 80 }) });
        continue;
      }
      if (current && kids.every((r) => containsRect(current, r))) continue;
      const box = union(kids);
      const title = g.titled.has(id) ? TITLE : 0;
      const padded = { x: box.x - PAD, y: box.y - PAD - title, w: box.w + 2 * PAD, h: box.h + 2 * PAD + title };
      boxes.set(id, current && known.has(id) ? union([current, padded]) : padded);
    }
  };
  placeAll(units);
  sizeBoxes();
  for (let pass = 0; pass < 2; pass++) {
    const rects = new Map<string, Rect>([...leaves, ...boxes]);
    const geometric = nestParents(ids, rects, g.containers);
    const misplaced = [...leaves.keys()].filter((id) => (geometric.get(id) ?? null) !== (g.parent.get(id) ?? null));
    if (!misplaced.length) break;
    for (const id of misplaced) leaves.delete(id);
    placeAll(misplaced.map((root) => ({ root })));
    sizeBoxes();
  }
  return new Map<string, Rect>([...leaves, ...boxes]);
}

function defaultHandles(dir: Direction): [string, string] {
  if (dir === "BT") return ["t", "b"];
  if (dir === "LR") return ["r", "l"];
  if (dir === "RL") return ["l", "r"];
  return ["b", "t"];
}

const sameNumber = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a === b : Math.abs(a - b) < 0.5;

const sameColor = (a: string | undefined, b: string | undefined) =>
  a === undefined || b === undefined ? a === b : a.toLowerCase() === b.toLowerCase();

function sameStyleValue(key: StyleKey, a: unknown, b: unknown): boolean {
  if (key === "strokeWidth" || key === "fontSize") return sameNumber(a as number | undefined, b as number | undefined);
  if (key === "fill" || key === "stroke" || key === "textColor") {
    return sameColor(a as string | undefined, b as string | undefined);
  }
  return a === b;
}

const sameDecl = (a: DiagNode, b: DiagNode) => a.shape === b.shape && a.label === b.label;

function sameStyle(a: DiagNode, b: DiagNode): boolean {
  return (
    sameColor(a.fill, b.fill) &&
    sameColor(a.stroke, b.stroke) &&
    (a.strokeStyle ?? "solid") === (b.strokeStyle ?? "solid") &&
    sameNumber(a.strokeWidth, b.strokeWidth) &&
    sameColor(a.textColor, b.textColor) &&
    sameNumber(a.fontSize, b.fontSize) &&
    (a.fontFamily ?? "serif") === (b.fontFamily ?? "serif")
  );
}

const sameLink = (a: DiagEdge, b: DiagEdge) =>
  a.arrow === b.arrow && a.style === b.style && (a.label ?? "") === (b.label ?? "");

function mergeStyleKey(target: Record<string, unknown>, key: StyleKey, parsed: DiagNode, hint: DiagNode): void {
  const value = parsed[key];
  if (value !== undefined) {
    target[key] = sameStyleValue(key, value, hint[key]) ? hint[key] : value;
    return;
  }
  if (key === "strokeWidth" || key === "fontFamily") return;
  if (key === "strokeStyle" && (hint.strokeStyle ?? "solid") === "solid") return;
  delete target[key];
}

function mergeNode(parsed: DiagNode, hint: DiagNode | undefined): DiagNode {
  if (!hint) return parsed;
  const out: DiagNode = { ...hint, id: parsed.id, shape: parsed.shape };
  out.label = hint.label.trim() === parsed.label ? hint.label : parsed.label;
  const target = out as unknown as Record<string, unknown>;
  for (const key of STYLE_KEYS) mergeStyleKey(target, key, parsed, hint);
  return out;
}

function arrowOf(link: PLink): EdgeArrow {
  if (!link.end) return "none";
  const both =
    (link.start === "<" && link.end === ">") || (link.start === link.end && (link.end === "x" || link.end === "o"));
  return both ? "both" : "forward";
}

interface ReadState {
  text: string;
  before: string;
  header: string;
  direction: string;
  tail: string;
  stmts: Stmt[];
}

function readDocument(text: string): ReadState | { other: string } | null {
  const start = frontmatterEnd(text);
  const spans = scanStatements(text, start);
  const headerIndex = spans.findIndex((span) => !text.startsWith("%%", span.from));
  if (headerIndex < 0) return null;
  const headerSpan = spans[headerIndex];
  const header = text.slice(headerSpan.from, headerSpan.to);
  const keyword = firstWord(header);
  if (keyword !== "flowchart" && keyword !== "graph" && keyword !== "flowchart-elk") return { other: keyword };
  const stmts: Stmt[] = [];
  let previous = headerSpan.to;
  for (const span of spans.slice(headerIndex + 1)) {
    stmts.push({ kind: "raw", text: text.slice(span.from, span.to), lead: text.slice(previous, span.from), depth: 0 });
    previous = span.to;
  }
  return {
    text,
    before: text.slice(0, headerSpan.from),
    header,
    direction: header.slice(keyword.length).trim() || "TB",
    tail: text.slice(previous).trimEnd(),
    stmts,
  };
}

function claimHintIds(names: string[], hint: DiagramModel, ids: Map<string, string>, used: Set<string>): void {
  const hintIds = new Set(hint.nodes.map((n) => n.id));
  for (const name of names) {
    if (hintIds.has(name) && !used.has(name)) {
      ids.set(name, name);
      used.add(name);
    }
  }
  const byName = new Map<string, string>();
  for (const [id, name] of writerNames(hint, null)) if (!byName.has(name)) byName.set(name, id);
  for (const name of names) {
    const id = byName.get(name);
    if (!ids.has(name) && id !== undefined && !used.has(id)) {
      ids.set(name, id);
      used.add(id);
    }
  }
}

function hintMatches(names: string[], hint: DiagramModel | null): Map<string, string> {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  if (hint) claimHintIds(names, hint, ids, used);
  for (const name of names) {
    if (ids.has(name)) continue;
    const id = freeName(name, used);
    ids.set(name, id);
    used.add(id);
  }
  return ids;
}

function matchEdges(parsed: DiagEdge[], hint: DiagramModel | null): (DiagEdge | undefined)[] {
  const matches: (DiagEdge | undefined)[] = parsed.map(() => undefined);
  if (!hint) return matches;
  const used = new Set<number>();
  const pass = (accept: (p: DiagEdge, h: DiagEdge) => boolean) => {
    parsed.forEach((p, i) => {
      if (matches[i]) return;
      const index = hint.edges.findIndex(
        (h, j) => !used.has(j) && h.source === p.source && h.target === p.target && accept(p, h),
      );
      if (index < 0) return;
      used.add(index);
      matches[i] = hint.edges[index];
    });
  };
  pass((p, h) => sameLink(p, { ...h, label: h.label?.trim() }));
  pass(() => true);
  return matches;
}

function firstIndent(stmts: Stmt[]): string {
  for (const stmt of stmts) {
    if (stmt.depth !== 0 || !stmt.lead.includes("\n")) continue;
    const indent = stmt.lead.slice(stmt.lead.lastIndexOf("\n") + 1);
    if (indent && !indent.trim()) return indent;
  }
  return "  ";
}

export function readMermaid(source: string, options: DiagramReadOptions = {}): DiagramRead<MermaidExtras> {
  const notes: DiagramNote[] = [];
  const note = noteSink(notes);
  const hint = readModelMark(source, MERMAID_COMMENT) ?? options.hint ?? null;
  const doc = readDocument(withoutModelMark(source, MERMAID_COMMENT));
  if (doc === null) return { model: { version: 1, nodes: [], edges: [] }, extras: null, notes };
  if ("other" in doc) {
    const known = OTHER_DIAGRAMS.has(doc.other);
    const only: DiagramNote = known
      ? { kind: "kept", code: "mermaidNotFlowchart", detail: doc.other }
      : { kind: "kept", code: "mermaidNoFlowchartHeader" };
    return { model: null, extras: null, notes: [only] };
  }
  if (frontmatterEnd(doc.text) > 0) note("kept", "mermaidFrontmatter");
  for (const span of scanStatements(doc.before, frontmatterEnd(doc.before))) {
    note("kept", doc.before.startsWith("%%{", span.from) ? "mermaidDirective" : "mermaidComment");
  }
  for (const stmt of doc.stmts) Object.assign(stmt, classify(stmt.text, note));
  const analysis = analyze(doc.stmts, note);
  return build(doc, analysis, hint, note, notes);
}

interface BuildContext {
  analysis: Analysis;
  note: NoteSink;
  idOf: (name: string) => string;
  hintNodes: Map<string, DiagNode>;
  bases: Record<string, MermaidNodeStyle>;
}

function nodeOrder({ vertices, groups }: Analysis): { name: string; key: number; group: boolean }[] {
  return [
    ...[...vertices.values()].filter((v) => !groups.has(v.name)).map((v) => ({ name: v.name, key: v.key, group: false })),
    ...[...groups.values()].map((g) => ({ name: g.name, key: g.key, group: true })),
  ].sort((a, b) => a.key - b.key);
}

function vertexLook(
  name: string,
  group: boolean,
  g: Group | undefined,
  v: Vertex | undefined,
  note: NoteSink,
): { shape: NodeShape; label: string } {
  if (group && g) return { shape: "roundrect", label: g.title };
  let shape: NodeShape = "rectangle";
  let label = name;
  if (!v) return { shape, label };
  if (v.shape) {
    shape = v.shape[0];
    if (!v.shape[1]) note("approximated", "mermaidShape", v.shape[2]);
  }
  if (v.label) {
    label = v.label.text;
    if (v.label.markdown) note("approximated", "mermaidMarkdownLabel");
  }
  return { shape, label };
}

function parsedNode(ctx: BuildContext, name: string, group: boolean): DiagNode {
  const id = ctx.idOf(name);
  const g = ctx.analysis.groups.get(name);
  const v = ctx.analysis.vertices.get(name);
  const { shape, label } = vertexLook(name, group, g, v, ctx.note);
  const { base, own } = styleOf(
    [...(g?.classes ?? []), ...(v?.classes ?? [])],
    [...(g?.styles ?? []), ...(v?.styles ?? [])],
    ctx.analysis.classDefs,
  );
  if (Object.keys(base).length) ctx.bases[id] = base;
  const size = estimateSize(shape, label);
  const parsed: DiagNode = { id, shape, x: 0, y: 0, w: size.w, h: size.h, label };
  for (const key of STYLE_KEYS) if (own[key] !== undefined) Object.assign(parsed, { [key]: own[key] });
  return mergeNode(parsed, ctx.hintNodes.get(id));
}

function linkDashes(stmts: Stmt[], conns: Conn[]): Map<number, StrokeStyle> {
  const dashes = new Map<number, StrokeStyle>();
  for (const stmt of stmts) {
    if (stmt.kind !== "linkStyle") continue;
    const style: MermaidNodeStyle = {};
    for (const prop of stmt.props ?? []) if (propParts(prop)[0] === "stroke-dasharray") applyProp(style, prop);
    if (!style.strokeStyle) continue;
    const targets = stmt.indices ?? conns.map((_, i) => i);
    for (const index of targets) dashes.set(index, style.strokeStyle);
  }
  return dashes;
}

function parsedEdge(ctx: BuildContext, c: Conn, dash: StrokeStyle | undefined): DiagEdge {
  const { note } = ctx;
  let style: EdgeStyle = c.link.stroke === "dotted" ? "dotted" : "solid";
  if (dash) style = dash;
  if (c.link.stroke === "thick") note("approximated", "mermaidThickLink");
  if (c.link.end === "x" || c.link.end === "o") note("approximated", "mermaidArrowHead");
  if (c.link.length > 1) note("kept", "mermaidLinkLength");
  if (c.link.label?.markdown) note("approximated", "mermaidMarkdownLabel");
  const edge: DiagEdge = {
    id: "",
    source: ctx.idOf(c.source),
    target: ctx.idOf(c.target),
    routing: "straight",
    arrow: arrowOf(c.link),
    style,
  };
  if (c.link.label?.text) edge.label = c.link.label.text;
  return edge;
}

function edgeIdAllocator(used: Set<string>): (preferred?: string) => string {
  let counter = 0;
  return (preferred) => {
    if (preferred && !used.has(preferred)) {
      used.add(preferred);
      return preferred;
    }
    let id = "";
    do {
      counter++;
      id = `e${counter}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}

function finalEdge(
  edge: DiagEdge,
  match: DiagEdge | undefined,
  link: PLink,
  freshEdgeId: (preferred?: string) => string,
  handles: [string, string],
): DiagEdge {
  if (!match) return { ...edge, id: freshEdgeId(link.id), sourceHandle: handles[0], targetHandle: handles[1] };
  const out: DiagEdge = { ...match, source: edge.source, target: edge.target, arrow: edge.arrow, style: edge.style };
  if (edge.label === undefined) delete out.label;
  else out.label = match.label?.trim() === edge.label ? match.label : edge.label;
  return out;
}

function connectionIds(
  conns: Conn[],
  visible: { c: Conn; i: number }[],
  edges: DiagEdge[],
  idOf: (name: string) => string,
): { connIds: Map<number, string>; hidden: Record<string, [string, string]> } {
  const connIds = new Map<number, string>();
  visible.forEach(({ i }, k) => {
    connIds.set(i, edges[k].id);
  });
  const hidden: Record<string, [string, string]> = {};
  conns.forEach((c, i) => {
    if (c.link.stroke !== "invisible") return;
    const key = `~${i}`;
    connIds.set(i, key);
    hidden[key] = [idOf(c.source), idOf(c.target)];
  });
  return { connIds, hidden };
}

function layoutGraph(
  parsedNodes: DiagNode[],
  edges: DiagEdge[],
  containerIds: Set<string>,
  parentOf: Map<string, string | null>,
  groups: Map<string, Group>,
  idOf: (name: string) => string,
): LayoutGraph {
  const nodeIds = parsedNodes.map((n) => n.id);
  const children = new Map<string | null, string[]>();
  for (const id of nodeIds) {
    const parent = parentOf.get(id) ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)?.push(id);
  }
  return {
    children,
    parent: new Map(nodeIds.map((id) => [id, parentOf.get(id) ?? null])),
    containers: containerIds,
    sizes: new Map(
      parsedNodes.map((n) => [
        n.id,
        containerIds.has(n.id)
          ? { w: Math.max(120, Math.round(n.label.length * 7.5 + 2 * PAD)), h: 80 }
          : { w: n.w, h: n.h },
      ]),
    ),
    titled: new Set(parsedNodes.filter((n) => containerIds.has(n.id) && n.label).map((n) => n.id)),
    edges: edges.map((e) => [e.source, e.target]),
    directions: new Map(
      [...groups.values()].filter((g) => g.direction).map((g) => [idOf(g.name), normalizeDirection(g.direction ?? "")]),
    ),
  };
}

function layoutRects(graph: LayoutGraph, nodeIds: string[], dir: Direction, hintNodes: Map<string, DiagNode>): Map<string, Rect> {
  const known = new Map<string, Rect>();
  for (const id of nodeIds) {
    const h = hintNodes.get(id);
    if (h) known.set(id, { x: h.x, y: h.y, w: h.w, h: h.h });
  }
  if (known.size) return layoutWithHint(graph, nodeIds, dir, known);
  const block = layoutBlock(graph, null, dir);
  const rects = new Map<string, Rect>();
  for (const id of nodeIds) {
    const p = block.pos.get(id) ?? { x: 0, y: 0 };
    const d = block.dims.get(id) ?? graph.sizes.get(id) ?? { w: 120, h: 56 };
    rects.set(id, { x: Math.round(p.x + ORIGIN), y: Math.round(p.y + ORIGIN), w: Math.round(d.w), h: Math.round(d.h) });
  }
  return rects;
}

function build(
  doc: ReadState,
  analysis: Analysis,
  hint: DiagramModel | null,
  note: NoteSink,
  notes: DiagramNote[],
): DiagramRead<MermaidExtras> {
  const { groups, conns, claims, stmts } = analysis;
  const dir = normalizeDirection(doc.direction);
  const order = nodeOrder(analysis);
  const ids = hintMatches(
    order.map((o) => o.name),
    hint,
  );
  const idOf = (name: string) => ids.get(name) ?? name;
  const ctx: BuildContext = {
    analysis,
    note,
    idOf,
    hintNodes: new Map((hint?.nodes ?? []).map((n) => [n.id, n])),
    bases: {},
  };
  const parsedNodes = order.map(({ name, group }) => parsedNode(ctx, name, group));
  const handles = defaultHandles(dir);
  const dashes = linkDashes(stmts, conns);
  const visible = conns.map((c, i) => ({ c, i })).filter(({ c }) => c.link.stroke !== "invisible");
  const parsedEdges: DiagEdge[] = visible.map(({ c, i }) => parsedEdge(ctx, c, dashes.get(i)));
  if (conns.some((c) => c.link.stroke === "invisible")) note("kept", "mermaidInvisibleLink");
  const matches = matchEdges(parsedEdges, hint);
  const freshEdgeId = edgeIdAllocator(new Set(matches.filter((m): m is DiagEdge => m !== undefined).map((m) => m.id)));
  const edges = parsedEdges.map((edge, k) => finalEdge(edge, matches[k], visible[k].c.link, freshEdgeId, handles));
  const { connIds, hidden } = connectionIds(conns, visible, edges, idOf);
  const nodeIds = parsedNodes.map((n) => n.id);
  const containerIds = new Set([...groups.keys()].map(idOf));
  const parentOf = new Map<string, string | null>();
  for (const [name, group] of claims) parentOf.set(idOf(name), idOf(group));
  const graph = layoutGraph(parsedNodes, edges, containerIds, parentOf, groups, idOf);
  const rects = layoutRects(graph, nodeIds, dir, ctx.hintNodes);
  const nodes = parsedNodes.map((n) => {
    const r = rects.get(n.id);
    return r ? { ...n, x: r.x, y: r.y, w: r.w, h: r.h } : n;
  });
  const model: DiagramModel = { version: 1, nodes, edges };
  if (hint?.background !== undefined) model.background = hint.background;
  const extras = buildExtras(doc, analysis, model, { idOf, connIds, hidden, bases: ctx.bases, parentOf, containerIds });
  return { model, extras, notes };
}

interface ExtrasContext {
  idOf: (name: string) => string;
  connIds: Map<number, string>;
  hidden: Record<string, [string, string]>;
  bases: Record<string, MermaidNodeStyle>;
  parentOf: Map<string, string | null>;
  containerIds: Set<string>;
}

interface ItemContext {
  analysis: Analysis;
  idOf: (name: string) => string;
  connIds: Map<number, string>;
  connsByStmt: Map<number, Conn[]>;
  connIndex: Map<Conn, number>;
  decls: Record<string, string>;
  forms: Record<string, MermaidForm>;
}

function vertexRef(ctx: ItemContext, stmt: Stmt, v: PVertex, index: number, at: number): MermaidVertexRef {
  const vertex = ctx.analysis.vertices.get(v.name);
  const isGroup = ctx.analysis.groups.has(v.name);
  const ownerAt = vertex?.owner ?? vertex?.first;
  const owner = !isGroup && ownerAt?.[0] === index && ownerAt[1] === at;
  const id = ctx.idOf(v.name);
  const ref: MermaidVertexRef = { id, from: v.from, to: v.to, owner, suffix: v.suffix };
  if (owner && (v.shape || v.data)) ctx.decls[id] = stmt.text.slice(v.from, v.to);
  if (owner && vertex?.form) ctx.forms[id] = vertex.form;
  return ref;
}

function fillGraphItem(ctx: ItemContext, item: MermaidItem, stmt: Stmt, graph: PGraph, index: number): void {
  const refs: MermaidVertexRef[] = [];
  let sequence = 0;
  for (const group of graph.groups) {
    for (const v of group) refs.push(vertexRef(ctx, stmt, v, index, sequence++));
  }
  item.vertices = refs;
  item.ids = [...new Set(refs.map((r) => r.id))];
  const own = ctx.connsByStmt.get(index) ?? [];
  item.links = graph.links.map((link, linkIndex) => ({
    from: link.from,
    to: link.to,
    edges: own.filter((c) => c.index === linkIndex).map((c) => ctx.connIds.get(ctx.connIndex.get(c) ?? -1) ?? ""),
  }));
}

function groupItemIds(ctx: ItemContext, stmt: Stmt, index: number): string[] {
  const { groups } = ctx.analysis;
  const group = [...groups.values()].find((g) => g.stmt === index) ?? (stmt.name ? groups.get(stmt.name) : undefined);
  return group ? [ctx.idOf(group.name)] : [];
}

function fillLinkStyleItem(ctx: ItemContext, item: MermaidItem, stmt: Stmt): void {
  item.indices = stmt.indices ?? null;
  item.ids = (stmt.indices ?? []).map((i) => ctx.connIds.get(i) ?? "");
  item.props = stmt.props ?? [];
  if (stmt.prefix) item.prefix = stmt.prefix;
}

function stmtItem(ctx: ItemContext, stmt: Stmt, index: number): MermaidItem {
  const item: MermaidItem = { kind: stmt.kind, lead: stmt.lead, text: stmt.text, depth: stmt.depth, ids: [] };
  switch (stmt.kind) {
    case "graph":
      if (stmt.graph) fillGraphItem(ctx, item, stmt, stmt.graph, index);
      break;
    case "edgeData": {
      const name = stmt.graph?.groups[0][0].name ?? "";
      const at = ctx.analysis.conns.findIndex((c) => c.link.id === name);
      item.ids = at >= 0 ? [ctx.connIds.get(at) ?? ""] : [];
      break;
    }
    case "subgraph":
    case "end":
      item.ids = groupItemIds(ctx, stmt, index);
      break;
    case "style":
    case "click":
      item.ids = stmt.name ? [ctx.idOf(stmt.name)] : [];
      if (stmt.props) item.props = stmt.props;
      break;
    case "class":
      item.ids = (stmt.names ?? []).map(ctx.idOf);
      item.className = stmt.className;
      break;
    case "linkStyle":
      fillLinkStyleItem(ctx, item, stmt);
      break;
  }
  return item;
}

function buildExtras(doc: ReadState, analysis: Analysis, model: DiagramModel, context: ExtrasContext): MermaidExtras {
  const { vertices, groups, conns } = analysis;
  const { idOf, connIds } = context;
  const names: Record<string, string> = {};
  for (const name of [...vertices.keys(), ...groups.keys()]) names[idOf(name)] = name;
  const decls: Record<string, string> = {};
  const forms: Record<string, MermaidForm> = {};
  const links: Record<string, MermaidLinkRaw> = {};
  const connsByStmt = new Map<number, Conn[]>();
  conns.forEach((c, i) => {
    const list = connsByStmt.get(c.stmt) ?? [];
    list.push(c);
    connsByStmt.set(c.stmt, list);
    const id = connIds.get(i);
    if (!id || id.startsWith("~")) return;
    const raw: MermaidLinkRaw = {};
    if (c.link.stroke === "thick") raw.thick = true;
    if (c.link.end === "x" || c.link.end === "o") raw.heads = [c.link.start, c.link.end];
    if (c.link.length > 1) raw.length = c.link.length;
    if (c.link.id) raw.id = c.link.id;
    if (Object.keys(raw).length) links[id] = raw;
  });
  const itemContext: ItemContext = {
    analysis,
    idOf,
    connIds,
    connsByStmt,
    connIndex: new Map(conns.map((c, i) => [c, i])),
    decls,
    forms,
  };
  const items = analysis.stmts.map((stmt, index) => stmtItem(itemContext, stmt, index));
  const parents: Record<string, string> = {};
  for (const [id, parent] of context.parentOf) if (parent) parents[id] = parent;
  const directions: Record<string, string> = {};
  for (const group of groups.values()) if (group.direction) directions[idOf(group.name)] = group.direction;
  return {
    before: doc.before,
    header: doc.header,
    direction: doc.direction,
    tail: doc.tail,
    indent: firstIndent(analysis.stmts),
    items,
    model: structuredClone(model),
    names,
    decls,
    forms,
    bases: context.bases,
    parents,
    containers: [...context.containerIds],
    directions,
    links,
    hidden: context.hidden,
  };
}

const CSS_FONT_FAMILIES: Record<DiagramFontFamily, string> = { serif: "serif", sans: "sans-serif", mono: "monospace" };

function hexColor(value: string | undefined, allowNone: boolean): string | null {
  if (value === "") return allowNone ? "none" : null;
  return value !== undefined && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value) ? value : null;
}

function colorProps(name: string, value: string | undefined, allowNone: boolean): string[] {
  const color = hexColor(value, allowNone);
  return color ? [`${name}:${color}`] : [];
}

function dashProps(n: DiagNode, base: MermaidNodeStyle): string[] {
  if (n.strokeStyle === "dashed") return [DASHED];
  if (n.strokeStyle === "dotted") return ["stroke-dasharray:2 3"];
  return base.strokeStyle ? ["stroke-dasharray:0"] : [];
}

function styleProps(n: DiagNode, base: MermaidNodeStyle): string[] {
  const props: string[] = [];
  const differs = (key: StyleKey) => n[key] !== undefined && !sameStyleValue(key, n[key], base[key]);
  if (differs("fill")) props.push(...colorProps("fill", n.fill, true));
  if (differs("stroke")) props.push(...colorProps("stroke", n.stroke, true));
  if (differs("strokeWidth")) props.push(`stroke-width:${round2(n.strokeWidth ?? 1)}px`);
  if (differs("textColor")) props.push(...colorProps("color", n.textColor, false));
  if (differs("strokeStyle")) props.push(...dashProps(n, base));
  if (differs("fontSize")) props.push(`font-size:${round2(n.fontSize ?? 11)}pt`);
  if (differs("fontFamily")) props.push(`font-family:${CSS_FONT_FAMILIES[n.fontFamily ?? "serif"]}`);
  return props;
}

function dataDecl(n: DiagNode, name: string, entries: [string, string][]): string {
  const label = quoted(n.label);
  let hasLabel = false;
  const parts = entries.map(([key, value]) => {
    if (key !== "label") return value ? `${key}: ${value}` : key;
    hasLabel = true;
    return `label: ${label}`;
  });
  if (!hasLabel) parts.push(`label: ${label}`);
  return `${name}@{ ${parts.join(", ")} }`;
}

function declText(n: DiagNode, name: string, form: MermaidForm | undefined, suffix: string): string {
  if (form && "data" in form) return dataDecl(n, name, form.data) + suffix;
  if (n.shape === "text") return `${name}@{ shape: text, label: ${quoted(n.label)} }${suffix}`;
  const [open, close] = form ? [form.open, form.close] : BRACKETS[n.shape];
  if (!form && n.shape === "rectangle" && n.label === name) return name + suffix;
  return `${name}${open}${labelText(n.label)}${close}${suffix}`;
}

function linkHeads(edge: DiagEdge, raw: MermaidLinkRaw | undefined, snap: DiagEdge | undefined): [string, string] {
  if (raw?.heads && snap?.arrow === edge.arrow) return [raw.heads[0], raw.heads[1]];
  return [edge.arrow === "both" ? "<" : "", edge.arrow === "none" ? "" : ">"];
}

function linkBody(edge: DiagEdge, raw: MermaidLinkRaw | undefined, snap: DiagEdge | undefined, end: string): string {
  const length = raw?.length ?? 1;
  if (edge.style !== "solid") return `-${".".repeat(length)}-`;
  const character = raw?.thick && (!snap || snap.style === "solid") ? "=" : "-";
  return end ? character.repeat(length + 1) : character.repeat(length + 2);
}

function linkToken(edge: DiagEdge, raw: MermaidLinkRaw | undefined, snap: DiagEdge | undefined): string {
  const [start, end] = linkHeads(edge, raw, snap);
  const body = linkBody(edge, raw, snap, end);
  const id = raw?.id ? `${raw.id}@` : "";
  const label = edge.label ? `|${labelText(edge.label)}|` : "";
  return `${id}${start}${body}${end}${label}`;
}

interface Writer {
  model: DiagramModel;
  extras: MermaidExtras | null;
  names: Map<string, string>;
  nodes: Map<string, DiagNode>;
  edges: Map<string, DiagEdge>;
  snapNodes: Map<string, DiagNode>;
  snapEdges: Map<string, DiagEdge>;
  suffixes: Map<string, string>;
}

function writer(model: DiagramModel, extras: MermaidExtras | null): Writer {
  const suffixes = new Map<string, string>();
  for (const item of extras?.items ?? []) {
    for (const ref of item.vertices ?? []) if (ref.owner) suffixes.set(ref.id, ref.suffix);
  }
  return {
    model,
    extras,
    names: writerNames(model, extras),
    nodes: new Map(model.nodes.map((n) => [n.id, n])),
    edges: new Map(model.edges.map((e) => [e.id, e])),
    snapNodes: new Map((extras?.model.nodes ?? []).map((n) => [n.id, n])),
    snapEdges: new Map((extras?.model.edges ?? []).map((e) => [e.id, e])),
    suffixes,
  };
}

const nameOf = (w: Writer, id: string) => w.names.get(id) ?? id;

function declFor(w: Writer, n: DiagNode): string {
  const snap = w.snapNodes.get(n.id);
  const raw = w.extras?.decls[n.id];
  if (snap && raw && sameDecl(n, snap)) return raw;
  const form = snap?.shape === n.shape ? w.extras?.forms[n.id] : undefined;
  return declText(n, nameOf(w, n.id), form, w.suffixes.get(n.id) ?? "");
}

function edgeLine(w: Writer, e: DiagEdge): string {
  const token = linkToken(e, w.extras?.links[e.id], w.snapEdges.get(e.id));
  return `${nameOf(w, e.source)} ${token} ${nameOf(w, e.target)}`;
}

function subgraphLine(w: Writer, n: DiagNode): string {
  const name = nameOf(w, n.id);
  return n.label === name ? `subgraph ${name}` : `subgraph ${name} [${labelText(n.label)}]`;
}

function groupTree(model: DiagramModel, extras: MermaidExtras | null) {
  const linked = new Set<string>();
  for (const e of model.edges) {
    linked.add(e.source);
    linked.add(e.target);
  }
  const subgraphs = new Set(extras?.containers ?? []);
  const candidates = new Set(
    model.nodes.filter((n) => n.shape === "roundrect" && (!linked.has(n.id) || subgraphs.has(n.id))).map((n) => n.id),
  );
  const parents = nestParents(
    model.nodes.map((n) => n.id),
    new Map(model.nodes.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }])),
    candidates,
  );
  return { parents, containers: new Set(parents.values()) };
}

function sameNodePlace(
  w: Writer,
  extras: MermaidExtras,
  snapContainers: Set<string>,
  id: string,
  parent: string | null,
  containers: Set<string>,
): boolean {
  if (w.snapNodes.has(id)) {
    if (parent !== (extras.parents[id] ?? null)) return false;
    return !containers.has(id) || snapContainers.has(id);
  }
  if (parent !== null && !snapContainers.has(parent)) return false;
  return !containers.has(id);
}

function sameStructure(w: Writer, parents: Map<string, string>, containers: Set<string>): boolean {
  const extras = w.extras;
  if (!extras) return false;
  const snapContainers = new Set(extras.containers);
  if (extras.containers.some((c) => !w.nodes.has(c))) return false;
  return w.model.nodes.every((n) =>
    sameNodePlace(w, extras, snapContainers, n.id, parents.get(n.id) ?? null, containers),
  );
}

function linkStyleText(indices: number[], prefix: string | undefined, props: string[]): string {
  return ["linkStyle", indices.join(","), prefix, props.join(",")].filter(Boolean).join(" ");
}

interface Piece {
  lead: string;
  text: string;
  links: string[];
  linkStyle?: MermaidItem;
}

function indentOf(lead: string): string | null {
  return lead.includes("\n") ? lead.slice(lead.lastIndexOf("\n") + 1) : null;
}

const isDashProp = (prop: string) => propParts(prop)[0] === "stroke-dasharray";

function linkIndexes(pieces: Piece[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const piece of pieces) {
    if (!piece.text && !piece.linkStyle) continue;
    for (const id of piece.links) index.set(id, index.size);
  }
  return index;
}

function styleMoved(w: Writer, id: string): boolean {
  const e = w.edges.get(id);
  const snap = w.snapEdges.get(id);
  return e !== undefined && snap !== undefined && e.style !== snap.style;
}

function plainLinkStyleLines(item: MermaidItem, indices: number[], numbers: number[], kept: string[], keep: boolean): string[] {
  const same = keep && numbers.length === indices.length && numbers.every((n, i) => n === indices[i]);
  if (same) return [item.text];
  if (numbers.length && (kept.length || item.prefix)) return [linkStyleText(numbers, item.prefix, kept)];
  return [];
}

function dashedLinkStyleLines(
  w: Writer,
  item: MermaidItem,
  indices: number[],
  present: string[],
  index: Map<string, number>,
  covered: Set<string>,
): string[] {
  const props = item.props ?? [];
  const other = props.filter((p) => !isDashProp(p));
  const keep = present.filter((id) => !styleMoved(w, id));
  const moved = present.filter((id) => styleMoved(w, id));
  for (const id of keep) covered.add(id);
  const numbers = keep.map((id) => index.get(id) ?? 0);
  const same = keep.length === item.ids.length && numbers.every((n, i) => n === indices[i]) && !moved.length;
  const lines: string[] = [];
  if (same) lines.push(item.text);
  else if (numbers.length) lines.push(linkStyleText(numbers, item.prefix, props));
  if (moved.length && other.length) {
    lines.push(linkStyleText(moved.map((id) => index.get(id) ?? 0), item.prefix, other));
  }
  return lines;
}

function linkStyleLines(
  w: Writer,
  item: MermaidItem,
  indices: number[],
  index: Map<string, number>,
  mode: "keep" | "strip",
  covered: Set<string>,
): string[] {
  const props = item.props ?? [];
  const present = item.ids.filter((id) => index.has(id));
  if (mode === "strip" || !props.some(isDashProp)) {
    const kept = mode === "strip" ? props.filter((p) => !isDashProp(p)) : props;
    const numbers = present.map((id) => index.get(id) ?? 0);
    return plainLinkStyleLines(item, indices, numbers, kept, mode === "keep");
  }
  return dashedLinkStyleLines(w, item, indices, present, index, covered);
}

function coverAllLinks(item: MermaidItem, index: Map<string, number>, mode: "keep" | "strip", covered: Set<string>): void {
  if (mode !== "keep" || !(item.props ?? []).some(isDashProp)) return;
  for (const id of index.keys()) covered.add(id);
}

function resolveLinkStyles(w: Writer, pieces: Piece[], mode: "keep" | "strip"): Set<string> {
  const index = linkIndexes(pieces);
  const covered = new Set<string>();
  for (const piece of pieces) {
    const item = piece.linkStyle;
    if (!item) continue;
    if (!item.indices) {
      piece.text = item.text;
      coverAllLinks(item, index, mode, covered);
      continue;
    }
    const lines = linkStyleLines(w, item, item.indices, index, mode, covered);
    const indent = indentOf(piece.lead) ?? w.extras?.indent ?? "  ";
    piece.text = lines.join(`\n${indent}`);
  }
  return covered;
}

function dashedLine(w: Writer, pieces: Piece[], covered: Set<string>): string | null {
  const indices: number[] = [];
  let count = 0;
  for (const piece of pieces) {
    if (!piece.text && !piece.linkStyle) continue;
    for (const id of piece.links) {
      if (w.edges.get(id)?.style === "dashed" && !covered.has(id)) indices.push(count);
      count++;
    }
  }
  return indices.length ? `linkStyle ${indices.join(",")} ${DASHED}` : null;
}

function assemble(head: string, pieces: Piece[], tail: string): string {
  let out = head;
  let carry = "";
  for (const piece of pieces) {
    if (!piece.text) {
      if (!carry && piece.lead.includes("\n")) carry = piece.lead;
      continue;
    }
    const lead = carry && !piece.lead.includes("\n") ? carry : piece.lead;
    carry = "";
    out += lead + piece.text;
  }
  return out + tail;
}

function headOf(extras: MermaidExtras | null): string {
  if (!extras) return "flowchart TD";
  return extras.before + (extras.header || `flowchart ${extras.direction || "TD"}`);
}

function childrenByParent(nodes: DiagNode[], parents: Map<string, string>): Map<string | null, DiagNode[]> {
  const children = new Map<string | null, DiagNode[]>();
  for (const n of nodes) {
    const parent = parents.get(n.id) ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)?.push(n);
  }
  return children;
}

function fullLinkLines(w: Writer): [string, string[]][] {
  const out: [string, string[]][] = [];
  for (const e of w.model.edges) if (w.nodes.has(e.source) && w.nodes.has(e.target)) out.push([edgeLine(w, e), [e.id]]);
  for (const [key, [source, target]] of Object.entries(w.extras?.hidden ?? {})) {
    if (w.nodes.has(source) && w.nodes.has(target)) out.push([`${nameOf(w, source)} ~~~ ${nameOf(w, target)}`, [key]]);
  }
  return out;
}

function fullStyleLine(w: Writer, n: DiagNode): string | null {
  const kept = (w.extras?.items ?? [])
    .filter((item) => item.kind === "style" && item.ids[0] === n.id)
    .flatMap((item) => unmappedProps(item.props ?? []));
  const props = [...styleProps(n, w.extras?.bases[n.id] ?? {}), ...new Set(kept)];
  return props.length ? `style ${nameOf(w, n.id)} ${props.join(",")}` : null;
}

function tailPiece(w: Writer, item: MermaidItem, unit: string): Piece | null {
  const piece: Piece = { lead: `\n${unit}`, text: "", links: [] };
  if (item.kind === "raw") piece.text = item.text;
  else if (item.kind === "click" && w.nodes.has(item.ids[0] ?? "")) piece.text = item.text;
  else if (item.kind === "edgeData" && w.edges.has(item.ids[0] ?? "")) piece.text = item.text;
  else if (item.kind === "class") piece.text = classText(w, item);
  else if (item.kind === "linkStyle") piece.linkStyle = item;
  else return null;
  return piece;
}

function writeFull(w: Writer): string {
  const extras = w.extras;
  const unit = extras?.indent ?? "  ";
  const { parents, containers } = groupTree(w.model, extras);
  const children = childrenByParent(w.model.nodes, parents);
  const pieces: Piece[] = [];
  const line = (depth: number, text: string, links: string[] = []) =>
    pieces.push({ lead: `\n${unit.repeat(depth)}`, text, links });
  const emit = (n: DiagNode, depth: number) => {
    if (!containers.has(n.id)) {
      line(depth, declFor(w, n));
      return;
    }
    line(depth, subgraphLine(w, n));
    const direction = extras?.directions[n.id];
    if (direction) line(depth + 1, `direction ${direction}`);
    for (const kid of children.get(n.id) ?? []) emit(kid, depth + 1);
    line(depth, "end");
  };
  for (const n of children.get(null) ?? []) emit(n, 1);
  for (const [text, links] of fullLinkLines(w)) line(1, text, links);
  for (const n of w.model.nodes) {
    const style = fullStyleLine(w, n);
    if (style) line(1, style);
  }
  const tailPieces = (extras?.items ?? [])
    .map((item) => tailPiece(w, item, unit))
    .filter((piece): piece is Piece => piece !== null);
  const all = [...pieces, ...tailPieces];
  resolveLinkStyles(w, all, "strip");
  const dashed = dashedLine(w, all, new Set());
  if (dashed) all.splice(pieces.length, 0, { lead: `\n${unit}`, text: dashed, links: [] });
  return assemble(headOf(extras), all, extras?.tail ?? "");
}

function classText(w: Writer, item: MermaidItem): string {
  const present = item.ids.filter((id) => w.nodes.has(id));
  if (present.length === item.ids.length) return item.text;
  return present.length ? `class ${present.map((id) => nameOf(w, id)).join(",")} ${item.className ?? ""}` : "";
}

function applyPatches(text: string, patches: [number, number, string][]): string {
  let out = text;
  for (const [from, to, value] of [...patches].sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, from) + value + out.slice(to);
  }
  return out;
}

function declChanged(w: Writer, id: string): boolean {
  const n = w.nodes.get(id);
  const snap = w.snapNodes.get(id);
  return n !== undefined && snap !== undefined && !sameDecl(n, snap);
}

function styleChanged(w: Writer, id: string): boolean {
  const n = w.nodes.get(id);
  const snap = w.snapNodes.get(id);
  return n !== undefined && snap !== undefined && !sameStyle(n, snap);
}

function edgeGone(w: Writer, id: string): boolean {
  const e = w.edges.get(id);
  const snap = w.snapEdges.get(id);
  if (!e || !snap) return true;
  return e.source !== snap.source || e.target !== snap.target;
}

function edgeChanged(w: Writer, id: string): boolean {
  const e = w.edges.get(id);
  const snap = w.snapEdges.get(id);
  return e !== undefined && snap !== undefined && !sameLink(e, snap);
}

interface IncrementalWrite {
  w: Writer;
  extras: MermaidExtras;
  unit: string;
  parents: Map<string, string>;
  pieces: Piece[];
  emitted: Set<string>;
  freshNodes: DiagNode[];
  lastStyle: Map<string, number>;
}

function graphNeedsRewrite(inc: IncrementalWrite, vertices: MermaidVertexRef[], links: MermaidLinkRef[]): boolean {
  const { w, extras } = inc;
  const real = (edgeId: string) => !extras.hidden[edgeId];
  return (
    vertices.some((ref) => !w.nodes.has(ref.id)) ||
    links.some((link) => link.edges.some((edgeId) => real(edgeId) && edgeGone(w, edgeId))) ||
    links.some((link) => link.edges.filter(real).length > 1 && link.edges.some((edgeId) => edgeChanged(w, edgeId)))
  );
}

function vertexPatches(inc: IncrementalWrite, vertices: MermaidVertexRef[]): [number, number, string][] {
  const { w, extras } = inc;
  const patches: [number, number, string][] = [];
  for (const ref of vertices) {
    const n = w.nodes.get(ref.id);
    if (!ref.owner || !n || !declChanged(w, ref.id)) continue;
    const snap = w.snapNodes.get(ref.id);
    const form = snap?.shape === n.shape ? extras.forms[ref.id] : undefined;
    patches.push([ref.from, ref.to, declText(n, nameOf(w, ref.id), form, ref.suffix)]);
  }
  return patches;
}

function linkPatches(inc: IncrementalWrite, links: MermaidLinkRef[]): [number, number, string][] {
  const { w, extras } = inc;
  const patches: [number, number, string][] = [];
  for (const link of links) {
    const e = w.edges.get(link.edges[0] ?? "");
    if (link.edges.length === 1 && e && edgeChanged(w, e.id)) {
      patches.push([link.from, link.to, linkToken(e, extras.links[e.id], w.snapEdges.get(e.id))]);
    }
  }
  return patches;
}

function patchGraph(inc: IncrementalWrite, item: MermaidItem, piece: Piece, vertices: MermaidVertexRef[], links: MermaidLinkRef[]): void {
  piece.text = applyPatches(item.text, [...vertexPatches(inc, vertices), ...linkPatches(inc, links)]);
  for (const link of links) {
    piece.links.push(...link.edges);
    for (const edgeId of link.edges) inc.emitted.add(edgeId);
  }
}

function rewrittenLink(inc: IncrementalWrite, edgeId: string): { line: string; ends: string[]; hidden: boolean } | null {
  const { w, extras } = inc;
  const pair = extras.hidden[edgeId];
  const e = w.edges.get(edgeId);
  const ends = pair ?? (e && !edgeGone(w, edgeId) ? [e.source, e.target] : null);
  if (!ends || !w.nodes.has(ends[0]) || !w.nodes.has(ends[1])) return null;
  const line = e && !pair ? edgeLine(w, e) : `${nameOf(w, ends[0])} ~~~ ${nameOf(w, ends[1])}`;
  return { line, ends, hidden: Boolean(pair) };
}

function rewrittenVertex(inc: IncrementalWrite, item: MermaidItem, ref: MermaidVertexRef, n: DiagNode): string {
  const name = nameOf(inc.w, ref.id);
  if (ref.owner) return declFor(inc.w, n);
  if (ref.suffix) return name + ref.suffix;
  if (item.depth > 0 && !inc.extras.containers.includes(ref.id)) return name;
  return "";
}

function rewrittenLinks(inc: IncrementalWrite, links: MermaidLinkRef[], piece: Piece): { lines: string[]; mentioned: Set<string> } {
  const lines: string[] = [];
  const mentioned = new Set<string>();
  for (const link of links) {
    for (const edgeId of link.edges) {
      const rewritten = rewrittenLink(inc, edgeId);
      if (!rewritten) continue;
      lines.push(rewritten.line);
      piece.links.push(edgeId);
      if (!rewritten.hidden) inc.emitted.add(edgeId);
      mentioned.add(rewritten.ends[0]);
      mentioned.add(rewritten.ends[1]);
    }
  }
  return { lines, mentioned };
}

function rewrittenVertices(
  inc: IncrementalWrite,
  item: MermaidItem,
  vertices: MermaidVertexRef[],
  mentioned: Set<string>,
): string[] {
  const lines: string[] = [];
  for (const ref of vertices) {
    const n = inc.w.nodes.get(ref.id);
    if (!n) continue;
    let text = rewrittenVertex(inc, item, ref, n);
    if (text === nameOf(inc.w, ref.id) && mentioned.has(ref.id)) text = "";
    if (text && !lines.includes(text)) lines.push(text);
  }
  return lines;
}

function rewriteGraph(
  inc: IncrementalWrite,
  item: MermaidItem,
  piece: Piece,
  vertices: MermaidVertexRef[],
  links: MermaidLinkRef[],
  indent: string,
): void {
  const linked = rewrittenLinks(inc, links, piece);
  const lines = rewrittenVertices(inc, item, vertices, linked.mentioned);
  piece.text = [...lines, ...linked.lines].join(`\n${indent}`);
}

function writeGraphItem(inc: IncrementalWrite, item: MermaidItem, piece: Piece, indent: string): void {
  const vertices = item.vertices ?? [];
  const links = item.links ?? [];
  if (graphNeedsRewrite(inc, vertices, links)) rewriteGraph(inc, item, piece, vertices, links, indent);
  else patchGraph(inc, item, piece, vertices, links);
}

function writeEndItem(inc: IncrementalWrite, item: MermaidItem, piece: Piece, indent: string, id: string): void {
  const inner = indent + inc.unit;
  for (const n of inc.freshNodes) {
    if (inc.parents.get(n.id) === id) inc.pieces.splice(-1, 0, { lead: `\n${inner}`, text: declFor(inc.w, n), links: [] });
  }
  piece.text = item.text;
}

function writeStyleItem(inc: IncrementalWrite, item: MermaidItem, piece: Piece, index: number, id: string): void {
  const { w, extras } = inc;
  const n = w.nodes.get(id);
  if (!n) return;
  if (!styleChanged(w, id)) {
    piece.text = item.text;
    return;
  }
  const props = [
    ...(inc.lastStyle.get(id) === index ? styleProps(n, extras.bases[id] ?? {}) : []),
    ...unmappedProps(item.props ?? []),
  ];
  piece.text = props.length ? `style ${nameOf(w, id)} ${props.join(",")}` : "";
}

function writeItem(inc: IncrementalWrite, item: MermaidItem, index: number): void {
  const { w } = inc;
  const piece: Piece = { lead: item.lead, text: "", links: [] };
  inc.pieces.push(piece);
  const indent = indentOf(item.lead) ?? inc.unit.repeat(item.depth + 1);
  const id = item.ids[0] ?? "";
  switch (item.kind) {
    case "graph":
      writeGraphItem(inc, item, piece, indent);
      break;
    case "subgraph": {
      const n = w.nodes.get(id);
      piece.text = n && declChanged(w, id) ? subgraphLine(w, n) : item.text;
      break;
    }
    case "end":
      writeEndItem(inc, item, piece, indent, id);
      break;
    case "style":
      writeStyleItem(inc, item, piece, index, id);
      break;
    case "class":
      piece.text = classText(w, item);
      break;
    case "click":
      piece.text = w.nodes.has(id) ? item.text : "";
      break;
    case "edgeData":
      piece.text = w.edges.has(id) ? item.text : "";
      break;
    case "linkStyle":
      piece.linkStyle = item;
      break;
    default:
      piece.text = item.text;
  }
}

function appendNewLines(inc: IncrementalWrite, owned: Set<string>): void {
  const { w, unit } = inc;
  const add = (text: string, links: string[] = []) => inc.pieces.push({ lead: `\n${unit}`, text, links });
  for (const n of inc.freshNodes) if (!inc.parents.has(n.id)) add(declFor(w, n));
  for (const n of w.model.nodes) if (!owned.has(n.id) && w.snapNodes.has(n.id) && declChanged(w, n.id)) add(declFor(w, n));
  for (const e of w.model.edges) {
    if (inc.emitted.has(e.id) || !w.nodes.has(e.source) || !w.nodes.has(e.target)) continue;
    add(edgeLine(w, e), [e.id]);
  }
}

function appendNewStyles(inc: IncrementalWrite, pendingStyles: DiagNode[]): void {
  const { w, extras, unit } = inc;
  const add = (text: string) => inc.pieces.push({ lead: `\n${unit}`, text, links: [] });
  for (const n of pendingStyles) {
    const props = styleProps(n, extras.bases[n.id] ?? {});
    if (props.length) add(`style ${nameOf(w, n.id)} ${props.join(",")}`);
  }
  for (const n of inc.freshNodes) {
    const props = styleProps(n, {});
    if (props.length) add(`style ${nameOf(w, n.id)} ${props.join(",")}`);
  }
}

function writeIncremental(w: Writer, extras: MermaidExtras, parents: Map<string, string>): string {
  const unit = extras.indent || "  ";
  const lastStyle = new Map<string, number>();
  extras.items.forEach((item, index) => {
    if (item.kind === "style") lastStyle.set(item.ids[0] ?? "", index);
  });
  const owned = new Set<string>(extras.containers);
  for (const item of extras.items) for (const ref of item.vertices ?? []) if (ref.owner) owned.add(ref.id);
  const inc: IncrementalWrite = {
    w,
    extras,
    unit,
    parents,
    pieces: [],
    emitted: new Set<string>(),
    freshNodes: w.model.nodes.filter((n) => !w.snapNodes.has(n.id)),
    lastStyle,
  };
  const pendingStyles = w.model.nodes.filter((n) => styleChanged(w, n.id) && !lastStyle.has(n.id));
  extras.items.forEach((item, index) => writeItem(inc, item, index));
  appendNewLines(inc, owned);
  appendNewStyles(inc, pendingStyles);
  const covered = resolveLinkStyles(w, inc.pieces, "keep");
  const dashed = dashedLine(w, inc.pieces, covered);
  if (dashed) inc.pieces.push({ lead: `\n${unit}`, text: dashed, links: [] });
  return assemble(headOf(extras), inc.pieces, extras.tail);
}

export function modelToMermaid(model: DiagramModel, options: MermaidWriteOptions = {}): string {
  const w = writer(model, options.extras ?? null);
  if (w.extras) {
    const { parents, containers } = groupTree(model, w.extras);
    if (sameStructure(w, parents, containers)) return writeIncremental(w, w.extras, parents);
  }
  return writeFull(w);
}

export function mermaidFileSource(model: DiagramModel, options: MermaidWriteOptions = {}): string {
  return `${modelToMermaid(model, options)}\n${modelMarkLine(MERMAID_COMMENT, model)}`;
}

function fenceOpen(line: string): { marker: string; indent: number } | null {
  let indent = 0;
  while (line[indent] === " ") indent++;
  if (indent > 3) return null;
  const character = line[indent];
  if (character !== "`" && character !== "~") return null;
  let end = indent;
  while (line[end] === character) end++;
  if (end - indent < 3) return null;
  const info = line.slice(end).trim();
  if (firstWord(info) !== "mermaid" || (character === "`" && info.includes("`"))) return null;
  return { marker: line.slice(indent, end), indent };
}

function fenceCloses(line: string, marker: string): boolean {
  const trimmed = line.trimStart();
  if (line.length - trimmed.length > 3) return false;
  let end = 0;
  while (trimmed[end] === marker[0]) end++;
  return end >= marker.length && trimmed.slice(end).trim() === "";
}

export function mermaidBlocks(markdown: string): { code: string; from: number; to: number }[] {
  const blocks: { code: string; from: number; to: number }[] = [];
  const lines: { start: number; text: string }[] = [];
  let position = 0;
  for (const text of markdown.split("\n")) {
    lines.push({ start: position, text });
    position += text.length + 1;
  }
  let index = 0;
  while (index < lines.length) {
    const open = fenceOpen(lines[index].text.replace(/\r$/, ""));
    if (!open) {
      index++;
      continue;
    }
    const from = index + 1 < lines.length ? lines[index + 1].start : markdown.length;
    let close = index + 1;
    while (close < lines.length && !fenceCloses(lines[close].text.replace(/\r$/, ""), open.marker)) close++;
    let to = from;
    if (close > index + 1) {
      const last = lines[close - 1];
      to = last.start + last.text.replace(/\r$/, "").length;
    }
    blocks.push({ code: markdown.slice(from, to), from, to });
    index = close + 1;
  }
  return blocks;
}

function withoutTrailingBreaks(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "\n" || text[end - 1] === "\r")) end -= 1;
  return text.slice(0, end);
}

export function mermaidFence(code: string): string {
  const body = withoutTrailingBreaks(code);
  let longest = 2;
  for (const line of body.split("\n")) {
    const match = /^\s*(`{3,})/.exec(line);
    if (match) longest = Math.max(longest, match[1].length);
  }
  const fence = "`".repeat(longest + 1);
  return `${fence}mermaid\n${body}\n${fence}`;
}
