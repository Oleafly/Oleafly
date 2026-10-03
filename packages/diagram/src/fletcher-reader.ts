import type { Parser, SyntaxNode } from "@lezer/common";
import {
  type DiagEdge,
  type DiagNode,
  type DiagramHandle,
  type DiagramModel,
  type DiagramPoint,
  type EdgeArrow,
  type NodeShape,
  PX_PER_CM,
  type StrokeStyle,
} from "@oleafly/latex";
import {
  EDGE_FIELDS,
  FLETCHER_DEFAULTS,
  FLETCHER_IMPORT_NAMES,
  type FletcherArg,
  type FletcherElement,
  type FletcherEndpoints,
  type FletcherExtras,
  type FletcherRawArg,
  NODE_FIELDS,
  edgeArgList,
  fletcherNames,
  nodeArgList,
  sameFields,
  typstNames,
} from "./fletcher";
import { readModelMark } from "./languages/model-mark";
import type { DiagramNote, DiagramRead, DiagramReadOptions } from "./languages/types";

export const TYPST_COMMENT = "//";

const PT_PER_CM = 72 / 2.54;
const EM_PT = 11;
const GRID_X = 110;
const GRID_Y = 80;
const DEGREES = 180 / Math.PI;
const PUNCTUATION = new Set(["LeftParen", "RightParen", "Comma", "LineComment", "BlockComment"]);

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  gray: "#aaaaaa",
  silver: "#dddddd",
  white: "#ffffff",
  navy: "#001f3f",
  blue: "#0074d9",
  aqua: "#7fdbff",
  teal: "#39cccc",
  eastern: "#239dad",
  purple: "#b10dc9",
  fuchsia: "#f012be",
  maroon: "#85144b",
  red: "#ff4136",
  orange: "#ff851b",
  yellow: "#ffdc00",
  olive: "#3d9970",
  green: "#2ecc40",
  lime: "#01ff70",
};

const MARK_NAMES = [
  "head",
  "doublehead",
  "triplehead",
  "harpoon",
  "straight",
  "solid",
  "stealth",
  "latex",
  "cone",
  "circle",
  "square",
  "diamond",
  "bar",
  "cross",
  "hooks",
  "hook",
  "crowfoot",
  ">>>",
  "<<<",
  ">>",
  "<<",
  "|>",
  "<|",
  "}>",
  "<{",
  "|||",
  "||",
  "|",
  ">",
  "<",
  "/",
  "\\",
  "x",
  "X",
  "o",
  "O",
  "*",
  "@",
  "[]",
  "<>",
  "n!",
  "n?",
  "n",
  "1!",
  "1?",
  "1",
].sort((a, b) => b.length - a.length);

const LINES = ["==", "--", "..", "=", "-", "~"];

const EDGE_FLAGS = new Set(["dashed", "dotted", "double", "triple", "crossing", "wave", "zigzag", "coil"]);

const NODE_KEY_FIELDS: Record<string, string[]> = {
  pos: ["x", "y", "w", "h"],
  label: ["label", "fontSize", "textColor", "fontFamily"],
  name: [],
  width: ["w", "h", "shape"],
  height: ["w", "h", "shape"],
  radius: ["w", "h", "shape"],
  shape: ["shape"],
  fill: ["fill"],
  stroke: ["stroke", "strokeWidth", "strokeStyle", "shape"],
  "corner-radius": ["radius", "shape"],
  layer: ["shape", "label"],
};

const EDGE_KEY_FIELDS: Record<string, string[]> = {
  vertices: ["routing", "sourceHandle", "targetHandle"],
  marks: ["arrow", "style"],
  label: ["label"],
  "label-side": ["label"],
  "label-pos": ["label", "routing"],
  dash: ["style"],
  bend: ["routing", "sourceHandle", "targetHandle"],
  "corner-radius": ["routing"],
};

const RECTANGULAR = new Set<NodeShape>(["rectangle", "roundrect", "text"]);

interface Context {
  source: string;
  notes: DiagramNote[];
}

const slice = (context: Context, node: SyntaxNode) => context.source.slice(node.from, node.to);

const squash = (text: string) => text.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

function note(context: Context, kind: DiagramNote["kind"], code: string, detail?: string) {
  if (!context.notes.some((existing) => existing.kind === kind && existing.code === code && existing.detail === detail)) {
    context.notes.push(detail === undefined ? { kind, code } : { kind, code, detail });
  }
}

function children(node: SyntaxNode): SyntaxNode[] {
  const list: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) list.push(child);
  return list;
}

function argNodes(call: SyntaxNode): SyntaxNode[] {
  const args = call.getChild("Args");
  return args ? children(args).filter((child) => !PUNCTUATION.has(child.name)) : [];
}

function calleeName(context: Context, call: SyntaxNode): string {
  const callee = call.firstChild;
  if (!callee) return "";
  const text = slice(context, callee);
  const dot = text.lastIndexOf(".");
  return dot >= 0 ? text.slice(dot + 1) : text;
}

function namedKey(context: Context, named: SyntaxNode): string {
  const key = named.firstChild;
  return key ? slice(context, key) : "";
}

function namedValue(named: SyntaxNode): SyntaxNode | null {
  return named.getChild("Colon")?.nextSibling ?? null;
}

function stringValue(context: Context, node: SyntaxNode | null): string | null {
  if (!node || node.name !== "Str") return null;
  const raw = slice(context, node).slice(1, -1);
  return raw.replace(/\\u\{([0-9a-fA-F]+)\}|\\(.)/g, (_, code: string | undefined, escaped: string | undefined) => {
    if (code) return String.fromCodePoint(Number.parseInt(code, 16));
    if (escaped === "n") return "\n";
    if (escaped === "t") return "\t";
    return escaped ?? "";
  });
}

function signed(context: Context, node: SyntaxNode): { sign: number; node: SyntaxNode } {
  if (node.name === "Unary") {
    const operator = node.firstChild;
    const operand = operator?.nextSibling;
    if (operator && operand) {
      const sign = slice(context, operator) === "-" ? -1 : 1;
      const inner = signed(context, operand);
      return { sign: sign * inner.sign, node: inner.node };
    }
  }
  if (node.name === "Parenthesized") {
    const inner = children(node).find((child) => !PUNCTUATION.has(child.name));
    if (inner) return signed(context, inner);
  }
  return { sign: 1, node };
}

function numberOf(context: Context, node: SyntaxNode | null): number | null {
  if (!node) return null;
  const { sign, node: inner } = signed(context, node);
  if (inner.name !== "Int" && inner.name !== "Float") return null;
  const value = Number(slice(context, inner));
  return Number.isFinite(value) ? sign * value : null;
}

const UNIT_PX: Record<string, number> = {
  cm: PX_PER_CM,
  mm: PX_PER_CM / 10,
  in: PX_PER_CM * 2.54,
  pt: PX_PER_CM / PT_PER_CM,
  em: (PX_PER_CM / PT_PER_CM) * EM_PT,
};

function lengthPx(context: Context, node: SyntaxNode | null): number | null {
  if (!node) return null;
  const { sign, node: inner } = signed(context, node);
  if (inner.name === "Int" || inner.name === "Float") return Number(slice(context, inner)) === 0 ? 0 : null;
  if (inner.name !== "Numeric") return null;
  const match = /^(\d*\.?\d+(?:e[+-]?\d+)?)([a-z]+)$/i.exec(slice(context, inner));
  const unit = match ? UNIT_PX[match[2].toLowerCase()] : undefined;
  if (!match || unit === undefined) return null;
  return sign * Number(match[1]) * unit;
}

function angleDegrees(context: Context, node: SyntaxNode | null): number | null {
  if (!node) return null;
  const { sign, node: inner } = signed(context, node);
  if (inner.name !== "Numeric") return null;
  const match = /^(\d*\.?\d+)(deg|rad|turn)$/i.exec(slice(context, inner));
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "rad") return sign * value * DEGREES;
  if (unit === "turn") return sign * value * 360;
  return sign * value;
}

function hexOf(red: number, green: number, blue: number): string {
  const part = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(red)}${part(green)}${part(blue)}`;
}

function channel(context: Context, node: SyntaxNode): number | null {
  const text = slice(context, node);
  if (text.endsWith("%")) {
    const value = Number(text.slice(0, -1));
    return Number.isFinite(value) ? (value / 100) * 255 : null;
  }
  return numberOf(context, node);
}

function normalizedHex(value: string): string | null {
  const hex = value.replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3,4}$/.test(hex)) return `#${hex.slice(0, 3).split("").map((digit) => digit + digit).join("")}`;
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) return `#${hex.slice(0, 6)}`;
  return null;
}

interface ColorRead {
  hex: string;
  exact: boolean;
}

function colorOf(context: Context, node: SyntaxNode | null): ColorRead | null {
  if (!node) return null;
  if (node.name === "None") return { hex: "", exact: true };
  if (node.name === "Ident") {
    const hex = NAMED_COLORS[slice(context, node)];
    return hex ? { hex, exact: true } : null;
  }
  if (node.name === "FieldAccess") {
    const base = node.firstChild;
    const named = base ? colorOf(context, base) : null;
    return named ? { hex: named.hex, exact: false } : null;
  }
  if (node.name !== "FuncCall") return null;
  const callee = node.firstChild;
  if (callee?.name === "FieldAccess") {
    const base = callee.firstChild;
    const inner = base ? colorOf(context, base) : null;
    return inner ? { hex: inner.hex, exact: false } : null;
  }
  const name = calleeName(context, node);
  const args = argNodes(node);
  if (name === "rgb") {
    const text = stringValue(context, args[0] ?? null);
    if (args.length === 1 && text !== null) {
      const hex = normalizedHex(text);
      return hex ? { hex, exact: true } : null;
    }
    const values = args.slice(0, 3).map((arg) => channel(context, arg));
    if (values.length === 3 && values.every((value) => value !== null)) {
      const [red, green, blue] = values as number[];
      return { hex: hexOf(red, green, blue), exact: args.length === 3 };
    }
    return null;
  }
  if (name === "luma" && args[0]) {
    const value = channel(context, args[0]);
    return value === null ? null : { hex: hexOf(value, value, value), exact: args.length === 1 };
  }
  return null;
}

interface StrokeRead {
  color?: string;
  widthPx?: number;
  style?: StrokeStyle;
  exact: boolean;
}

function dashStyle(context: Context, node: SyntaxNode | null): { style: StrokeStyle; exact: boolean } | null {
  if (!node) return null;
  if (node.name === "None") return { style: "solid", exact: true };
  const value = stringValue(context, node);
  if (value === "dashed" || value === "dotted" || value === "solid") return { style: value, exact: true };
  if (value?.includes("dot")) return { style: "dotted", exact: false };
  if (value?.includes("dash")) return { style: "dashed", exact: false };
  return { style: "dashed", exact: false };
}

function strokeOf(context: Context, node: SyntaxNode): StrokeRead | null {
  if (node.name === "None") return { color: "", exact: true };
  if (node.name === "Auto") return null;
  const width = lengthPx(context, node);
  if (width !== null) return { color: "#000000", widthPx: width, exact: true };
  const color = colorOf(context, node);
  if (color) return { color: color.hex, widthPx: PX_PER_CM / PT_PER_CM, exact: color.exact };
  if (node.name === "Binary") {
    const parts = children(node).filter((child) => child.name !== "Plus");
    const reads = parts.map((part) => strokeOf(context, part));
    if (reads.length !== 2 || reads.some((read) => read === null)) return null;
    const [first, second] = reads as StrokeRead[];
    const lengthFirst = lengthPx(context, parts[0]) !== null;
    return {
      color: lengthFirst ? second.color : first.color,
      widthPx: lengthFirst ? first.widthPx : second.widthPx,
      exact: first.exact && second.exact,
    };
  }
  if (node.name === "Dict") {
    const read: StrokeRead = { color: "#000000", widthPx: PX_PER_CM / PT_PER_CM, exact: true };
    for (const named of children(node).filter((child) => child.name === "Named")) {
      const key = namedKey(context, named);
      const value = namedValue(named);
      if (key === "paint") {
        const color = colorOf(context, value);
        if (!color) return null;
        read.color = color.hex;
        read.exact &&= color.exact;
      } else if (key === "thickness") {
        const px = lengthPx(context, value);
        if (px === null) return null;
        read.widthPx = px;
      } else if (key === "dash") {
        const dash = dashStyle(context, value);
        if (!dash) return null;
        read.style = dash.style === "solid" ? undefined : dash.style;
        read.exact &&= dash.exact;
      } else if (key !== "cap") {
        read.exact = false;
      }
    }
    return read;
  }
  return null;
}

type Coordinate = { kind: "abs"; point: DiagramPoint } | { kind: "grid"; point: DiagramPoint; u: number; v: number };

function coordinateOf(context: Context, node: SyntaxNode | null): Coordinate | null {
  if (!node || node.name !== "Array") return null;
  const parts = children(node).filter((child) => !PUNCTUATION.has(child.name));
  if (parts.length !== 2) return null;
  const lengths = parts.map((part) => lengthPx(context, part));
  const numbers = parts.map((part) => numberOf(context, part));
  if (numbers.every((value) => value !== null)) {
    const [u, v] = numbers as number[];
    return { kind: "grid", point: { x: u * GRID_X, y: v * GRID_Y }, u, v };
  }
  if (lengths.every((value) => value !== null)) {
    const [x, y] = lengths as number[];
    return { kind: "abs", point: { x, y: -y } };
  }
  return null;
}

function labelNameOf(context: Context, node: SyntaxNode | null): string | null {
  if (!node) return null;
  if (node.name === "Label") return slice(context, node).slice(1, -1);
  return stringValue(context, node);
}

function decodeEscape(text: string): string {
  const unicode = /^\\u\{([0-9a-fA-F]+)\}$/.exec(text);
  if (unicode) return String.fromCodePoint(Number.parseInt(unicode[1], 16));
  return text.slice(1);
}

const PLAIN_CHILDREN = new Set(["Escape", "Shorthand", "SmartQuote", "Space", "Text"]);

function markupText(context: Context, markup: SyntaxNode): { text: string; plain: boolean } {
  const kids = children(markup);
  const meaningful = kids.filter((child) => child.name !== "Space");
  const whole = slice(context, markup).trim();
  if (meaningful.length === 1 && (meaningful[0].name === "Equation" || meaningful[0].name === "Raw")) {
    if (slice(context, meaningful[0]) === whole) return { text: whole, plain: true };
  }
  let text = "";
  let cursor = markup.from;
  let plain = true;
  for (const child of kids) {
    text += context.source.slice(cursor, child.from);
    if (child.name === "Escape") text += decodeEscape(slice(context, child));
    else {
      if (!PLAIN_CHILDREN.has(child.name)) plain = false;
      text += slice(context, child);
    }
    cursor = child.to;
  }
  text += context.source.slice(cursor, markup.to);
  return { text: text.replace(/[ \t]*(?:\r\n|\r|\n)[ \t]*/g, " "), plain };
}

function contentText(context: Context, node: SyntaxNode): { text: string; plain: boolean } {
  if (node.name === "ContentBlock") {
    const markup = node.getChild("Markup");
    return markup ? markupText(context, markup) : { text: "", plain: true };
  }
  if (node.name === "Equation" || node.name === "Raw") return { text: slice(context, node), plain: true };
  const value = stringValue(context, node);
  if (value !== null) return { text: value, plain: true };
  return { text: slice(context, node), plain: false };
}

interface LabelRead {
  label: string;
  fontSize?: number;
  textColor?: string;
  fontFamily?: DiagNode["fontFamily"];
  exact: boolean;
}

function fontFamilyOf(name: string): { family: DiagNode["fontFamily"]; exact: boolean } {
  const lower = name.toLowerCase();
  if (name === "Arial") return { family: "sans", exact: true };
  if (name === "DejaVu Sans Mono") return { family: "mono", exact: true };
  if (/mono|courier|code|consol/.test(lower)) return { family: "mono", exact: false };
  if (/sans|arial|helvetica|inter\b|roboto/.test(lower)) return { family: "sans", exact: false };
  return { family: "serif", exact: false };
}

function labelOf(context: Context, node: SyntaxNode): LabelRead {
  if (node.name === "FuncCall" && calleeName(context, node) === "text" && node.firstChild?.name === "Ident") {
    const args = argNodes(node);
    const body = args.at(-1);
    if (body && body.name === "ContentBlock") {
      const read: LabelRead = { ...{ label: "" }, exact: true };
      const content = contentText(context, body);
      read.label = content.text;
      read.exact = content.plain;
      for (const arg of args.slice(0, -1)) {
        if (arg.name !== "Named") {
          read.exact = false;
          continue;
        }
        const key = namedKey(context, arg);
        const value = namedValue(arg);
        if (key === "size") {
          const px = lengthPx(context, value);
          if (px === null) read.exact = false;
          else read.fontSize = Math.round(((px * PT_PER_CM) / PX_PER_CM) * 100) / 100;
        } else if (key === "fill") {
          const color = colorOf(context, value);
          if (color?.hex) read.textColor = color.hex;
          if (!color?.exact) read.exact = false;
        } else if (key === "font") {
          const font = stringValue(context, value);
          const family = font === null ? null : fontFamilyOf(font);
          if (family) {
            read.fontFamily = family.family === "serif" ? undefined : family.family;
            if (!family.exact) read.exact = false;
          } else read.exact = false;
        } else read.exact = false;
      }
      return read;
    }
  }
  const content = contentText(context, node);
  return { label: content.text, fontSize: EM_PT, exact: content.plain };
}

interface ShapeRead {
  shape: NodeShape | "rect";
  exact: boolean;
}

function shapeOf(context: Context, node: SyntaxNode | null): ShapeRead | null {
  if (!node) return null;
  let target = node;
  if (target.name === "FuncCall" && target.firstChild?.name === "FieldAccess") {
    const access = target.firstChild;
    if (slice(context, access).endsWith(".with") && access.firstChild) target = access.firstChild;
  }
  const text = slice(context, target);
  const name = text.slice(text.lastIndexOf(".") + 1);
  const known: Record<string, NodeShape | "rect"> = {
    rect: "rect",
    rectangle: "rect",
    circle: "circle",
    ellipse: "ellipse",
    diamond: "diamond",
    parallelogram: "parallelogram",
  };
  const shape = known[name];
  if (shape) return { shape, exact: true };
  if (name === "pill") return { shape: "roundrect", exact: false };
  return { shape: "rect", exact: false };
}

interface ParsedNode {
  node: DiagNode;
  element: FletcherElement<DiagNode>;
  center: DiagramPoint;
  grid: { u: number; v: number } | null;
  sourceArgs: Map<string, string>;
}

function estimatedWidth(label: string): number {
  return Math.max(40, Math.round(label.length * 7 + 20));
}

function readNodeCall(context: Context, call: SyntaxNode, name: string | null, fallbackId: string): ParsedNode | null {
  const args = argNodes(call);
  const positional = args.filter((arg) => arg.name !== "Named");
  const named = new Map(args.filter((arg) => arg.name === "Named").map((arg) => [namedKey(context, arg), arg]));
  const sourceArgs = new Map<string, string>();
  let posNode: SyntaxNode | null = null;
  let labelNode: SyntaxNode | null = null;
  if (positional.length > 2) return null;
  if (positional.length === 2) [posNode, labelNode] = positional;
  else if (positional.length === 1) {
    if (["Array", "Dict", "Label"].includes(positional[0].name)) posNode = positional[0];
    else labelNode = positional[0];
  }
  if (posNode) sourceArgs.set("pos", slice(context, posNode));
  if (labelNode) sourceArgs.set("label", slice(context, labelNode));
  if (named.has("pos")) {
    posNode = namedValue(named.get("pos") as SyntaxNode);
    sourceArgs.set("pos", slice(context, named.get("pos") as SyntaxNode));
  }
  if (named.has("label")) {
    labelNode = namedValue(named.get("label") as SyntaxNode);
    sourceArgs.set("label", slice(context, named.get("label") as SyntaxNode));
  }
  if (named.has("enclose")) return null;
  const coordinate = coordinateOf(context, posNode);
  if (!coordinate) return null;
  if (coordinate.kind === "grid") note(context, "approximated", "gridCoordinates");

  const label = labelNode ? labelOf(context, labelNode) : { label: "", exact: true };
  if (!label.exact) note(context, "approximated", "formattedLabels");
  const node: DiagNode = { id: name ?? fallbackId, shape: "rectangle", x: 0, y: 0, w: 0, h: 0, label: label.label };
  if (label.fontSize !== undefined) node.fontSize = label.fontSize;
  if (label.textColor) node.textColor = label.textColor;
  if (label.fontFamily) node.fontFamily = label.fontFamily;

  const shape = shapeOf(context, named.has("shape") ? namedValue(named.get("shape") as SyntaxNode) : null);
  if (shape && !shape.exact) note(context, "approximated", "unknownShapes");
  const radiusPx = lengthPx(context, named.has("radius") ? namedValue(named.get("radius") as SyntaxNode) : null);
  const widthPx = lengthPx(context, named.has("width") ? namedValue(named.get("width") as SyntaxNode) : null);
  const heightPx = lengthPx(context, named.has("height") ? namedValue(named.get("height") as SyntaxNode) : null);
  const kind = shape?.shape ?? (radiusPx !== null ? "circle" : "rect");
  if (kind === "circle") {
    const diameter = radiusPx !== null ? radiusPx * 2 : Math.max(widthPx ?? 0, heightPx ?? 0) || 40;
    node.w = diameter;
    node.h = diameter;
  } else {
    node.w = widthPx ?? (radiusPx !== null ? radiusPx * 2 : estimatedWidth(label.label));
    node.h = heightPx ?? (radiusPx !== null ? radiusPx * 2 : 30);
  }
  if (widthPx === null && heightPx === null && radiusPx === null) {
    note(context, "approximated", "estimatedSize");
  }

  const fill = colorOf(context, named.has("fill") ? namedValue(named.get("fill") as SyntaxNode) : null);
  if (fill) node.fill = fill.hex;
  if (fill && !fill.exact) note(context, "approximated", "colorAdjustments");
  if (!fill && named.has("fill")) note(context, "approximated", "colorExpressions");
  let strokeNone = false;
  const strokeValue = named.has("stroke") ? namedValue(named.get("stroke") as SyntaxNode) : null;
  if (strokeValue) {
    const stroke = strokeOf(context, strokeValue);
    if (stroke) {
      strokeNone = stroke.color === "";
      if (stroke.color) node.stroke = stroke.color;
      if (stroke.color && stroke.widthPx !== undefined) node.strokeWidth = Math.round(stroke.widthPx * 1000) / 1000;
      if (stroke.style && stroke.style !== "solid") node.strokeStyle = stroke.style;
      if (!stroke.exact) note(context, "approximated", "strokeStyles");
    } else note(context, "approximated", "strokeStyles");
  }
  const cornerPx = lengthPx(context, named.has("corner-radius") ? namedValue(named.get("corner-radius") as SyntaxNode) : null);

  if (kind === "rect") {
    if (strokeNone && !fill?.hex && node.label) node.shape = "text";
    else if (cornerPx !== null && cornerPx > 0) node.shape = "roundrect";
    else node.shape = "rectangle";
    if (cornerPx !== null && cornerPx > 0) node.radius = Math.round(cornerPx * 1000) / 1000;
  } else {
    node.shape = kind;
    if (kind === "roundrect") node.radius = Math.round(((cornerPx ?? node.h / 2) || 0) * 1000) / 1000;
  }
  const center =
    coordinate.kind === "abs" ? coordinate.point : { x: coordinate.point.x, y: coordinate.point.y };
  node.x = Math.round((center.x - node.w / 2) * 1000) / 1000;
  node.y = Math.round((center.y - node.h / 2) * 1000) / 1000;

  for (const [key, arg] of named) {
    if (key !== "pos" && key !== "label") sourceArgs.set(key, slice(context, arg));
  }
  const element: FletcherElement<DiagNode> = {
    read: node,
    text: slice(context, call),
    args: [],
    named: name !== null,
  };
  const argsNode = call.getChild("Args");
  const closing = argsNode?.lastChild;
  if (argsNode && closing?.name === "RightParen") {
    const before = closing.prevSibling;
    element.nameAt = closing.from - call.from;
    element.namePrefix = before && before.name !== "LeftParen" && before.name !== "Comma" ? ", " : "";
    if (before?.name === "Comma") element.namePrefix = " ";
  }
  return {
    node,
    element,
    center,
    grid: coordinate.kind === "grid" ? { u: coordinate.u, v: coordinate.v } : null,
    sourceArgs,
  };
}

function rawArgsFor(
  sourceArgs: Map<string, string>,
  writerArgs: FletcherArg[],
  keyFields: Record<string, string[]>,
  omittable: Set<string>,
): FletcherRawArg[] {
  const raw: FletcherRawArg[] = [];
  const writer = new Map(writerArgs.map((arg) => [arg.key, arg.text]));
  for (const [key, text] of sourceArgs) {
    const fields = keyFields[key];
    if (fields === undefined) {
      raw.push({ key, text, fields: [] });
      continue;
    }
    const written = writer.get(key);
    if (written !== undefined && squash(written) === squash(text)) continue;
    raw.push({ key, text, fields, geometry: key === "vertices" });
  }
  for (const arg of writerArgs) {
    if (!sourceArgs.has(arg.key) && omittable.has(arg.key)) {
      raw.push({ key: arg.key, text: "", fields: keyFields[arg.key] ?? [] });
    }
  }
  return raw;
}

interface MarksRead {
  arrow: EdgeArrow;
  style: DiagEdge["style"];
  reversed: boolean;
  exact: boolean;
}

function eat(text: string, options: readonly string[]): [string, string | null] {
  for (const option of options) if (text.startsWith(option)) return [text.slice(option.length), option];
  return [text, null];
}

function marksOf(value: string): MarksRead | null {
  let text = value;
  const marks: (string | null)[] = [];
  const lines: string[] = [];
  let mark: string | null;
  [text, mark] = eat(text, MARK_NAMES);
  [text] = eat(text, ["'"]);
  marks.push(mark);
  for (;;) {
    let line: string | null;
    [text, line] = eat(text, LINES);
    if (line === null) return null;
    lines.push(line);
    [text, mark] = eat(text, MARK_NAMES);
    [text] = eat(text, ["'"]);
    marks.push(mark);
    if (text === "") break;
    if (mark === null) return null;
  }
  if (new Set(lines).size > 1) return null;
  const line = lines[0];
  const start = marks[0];
  const end = marks.at(-1) ?? null;
  const style: DiagEdge["style"] = line === "--" ? "dashed" : line === ".." ? "dotted" : "solid";
  const exact = ["-", "--", ".."].includes(line) && marks.length === 2;
  if (start && end) return { arrow: "both", style, reversed: false, exact };
  if (end) return { arrow: "forward", style, reversed: false, exact };
  if (start) return { arrow: "forward", style, reversed: true, exact };
  return { arrow: "none", style, reversed: false, exact };
}

type VertexRef =
  | { kind: "auto" }
  | { kind: "label"; name: string }
  | { kind: "coord"; coordinate: Coordinate }
  | { kind: "relative"; step: DiagramPoint }
  | { kind: "unknown" };

const RELATIVE: Record<string, DiagramPoint> = {
  t: { x: 0, y: -1 },
  n: { x: 0, y: -1 },
  u: { x: 0, y: -1 },
  b: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  d: { x: 0, y: 1 },
  l: { x: -1, y: 0 },
  w: { x: -1, y: 0 },
  r: { x: 1, y: 0 },
  e: { x: 1, y: 0 },
};

interface ParsedEdge {
  call: SyntaxNode;
  nodeIndex: number;
  vertices: VertexRef[];
  endpoints: FletcherEndpoints;
  marks: MarksRead | null;
  marksText: string | null;
  label: SyntaxNode | null;
  labelText: string | null;
  sourceArgs: Map<string, string>;
  bend: number | null;
  flagStyle: DiagEdge["style"] | null;
}

function isCoordNode(node: SyntaxNode): boolean {
  return ["Array", "Dict", "Label", "Auto"].includes(node.name);
}

function isRelative(context: Context, node: SyntaxNode): boolean {
  if (isCoordNode(node)) return true;
  const value = stringValue(context, node);
  return value !== null && /^[utdblrnsew,]+$/.test(value);
}

function isAlignment(context: Context, node: SyntaxNode): boolean {
  return node.name === "Ident" && ["left", "right", "center"].includes(slice(context, node));
}

function maybeMarks(context: Context, node: SyntaxNode): boolean {
  const value = stringValue(context, node);
  if (value !== null) return !EDGE_FLAGS.has(value);
  return node.name === "FieldAccess" && slice(context, node).includes("arrow");
}

function maybeLabel(context: Context, node: SyntaxNode): boolean {
  return node.name !== "Str" && !maybeMarks(context, node) && !isCoordNode(node) && !isAlignment(context, node);
}

function vertexOf(context: Context, node: SyntaxNode): VertexRef[] {
  if (node.name === "Auto") return [{ kind: "auto" }];
  if (node.name === "Label") return [{ kind: "label", name: slice(context, node).slice(1, -1) }];
  const value = stringValue(context, node);
  if (value !== null) {
    return value.split(",").filter(Boolean).map((part) => {
      const step = part.split("").reduce((sum, character) => {
        const direction = RELATIVE[character];
        return { x: sum.x + direction.x, y: sum.y + direction.y };
      }, { x: 0, y: 0 });
      return { kind: "relative", step };
    });
  }
  const coordinate = coordinateOf(context, node);
  return [coordinate ? { kind: "coord", coordinate } : { kind: "unknown" }];
}

function readEdgeCall(context: Context, call: SyntaxNode, nodeIndex: number): ParsedEdge | null {
  const args = argNodes(call);
  const positional = args.filter((arg) => arg.name !== "Named");
  const named = args.filter((arg) => arg.name === "Named");
  const sourceArgs = new Map<string, string>();
  const refs: VertexRef[] = [];
  let hasFirst = false;
  let hasTail = false;
  let marksNode: SyntaxNode | null = null;
  let labelNode: SyntaxNode | null = null;
  const queue = [...positional];
  const peek = (...predicates: ((node: SyntaxNode) => boolean)[]) =>
    queue.length >= predicates.length && predicates.every((predicate, index) => predicate(queue[index]));
  if (peek((node) => isCoordNode(node))) {
    refs.push(...vertexOf(context, queue.shift() as SyntaxNode));
    hasFirst = true;
  }
  while (peek((node) => isRelative(context, node))) {
    refs.push(...vertexOf(context, queue.shift() as SyntaxNode));
    hasTail = true;
  }
  if (!hasTail && peek((node) => maybeMarks(context, node), (node) => isRelative(context, node))) {
    marksNode = queue.shift() as SyntaxNode;
    refs.push(...vertexOf(context, queue.shift() as SyntaxNode));
    hasTail = true;
  }
  const verticesNamed = named.find((arg) => namedKey(context, arg) === "vertices");
  if (verticesNamed) {
    const value = namedValue(verticesNamed);
    for (const part of value ? children(value).filter((child) => !PUNCTUATION.has(child.name)) : []) {
      refs.push(...vertexOf(context, part));
    }
    hasFirst = true;
    hasTail = true;
  }
  if (!hasTail) refs.unshift({ kind: "auto" });
  if (!hasFirst) refs.unshift({ kind: "auto" });
  const sideIndex = queue.findIndex((node) => isAlignment(context, node));
  if (sideIndex >= 0) {
    const [side] = queue.splice(sideIndex, 1);
    sourceArgs.set("label-side", slice(context, side));
  }
  if (peek((node) => maybeMarks(context, node), (node) => maybeLabel(context, node))) {
    marksNode ??= queue.shift() as SyntaxNode;
    labelNode = queue.shift() as SyntaxNode;
  } else if (peek((node) => maybeLabel(context, node), (node) => maybeMarks(context, node))) {
    labelNode = queue.shift() as SyntaxNode;
    marksNode ??= queue.shift() as SyntaxNode;
  } else if (peek((node) => maybeLabel(context, node))) {
    labelNode = queue.shift() as SyntaxNode;
  } else if (peek((node) => maybeMarks(context, node))) {
    marksNode ??= queue.shift() as SyntaxNode;
  }
  let flagStyle: DiagEdge["style"] | null = null;
  while (queue.length > 0 && EDGE_FLAGS.has(stringValue(context, queue[0]) ?? "")) {
    const flag = queue.shift() as SyntaxNode;
    const value = stringValue(context, flag) as string;
    if (value === "dashed" || value === "dotted") {
      flagStyle = value;
      sourceArgs.set("dash", slice(context, flag));
    } else {
      sourceArgs.set(`flag:${value}`, slice(context, flag));
      note(context, "kept", "edgeOption", value);
    }
  }
  if (queue.length > 0) return null;
  let bend: number | null = null;
  for (const arg of named) {
    const key = namedKey(context, arg);
    const value = namedValue(arg);
    if (key === "vertices") continue;
    if (key === "marks") marksNode = value;
    else if (key === "label") labelNode = value;
    else if (key === "bend") bend = angleDegrees(context, value);
    else if (key === "dash") {
      const dash = dashStyle(context, value);
      if (dash) flagStyle = dash.style;
      if (dash && !dash.exact) note(context, "approximated", "strokeStyles");
    }
    sourceArgs.set(key, slice(context, arg));
  }
  const marksText = marksNode ? stringValue(context, marksNode) : null;
  const marks = marksText !== null ? marksOf(marksText) : null;
  if (marksNode && !sourceArgs.has("marks")) sourceArgs.set("marks", slice(context, marksNode));
  if (labelNode && !sourceArgs.has("label")) sourceArgs.set("label", slice(context, labelNode));
  if (marksNode && !marks) note(context, "approximated", "arrowMarks");
  if (marks && !marks.exact) note(context, "approximated", "arrowMarks");
  const allLabels = refs.length >= 2 && [refs[0], refs.at(-1)].every((ref) => ref?.kind === "label");
  const implicit = refs.some((ref) => ref.kind === "auto" || ref.kind === "relative");
  let endpoints: FletcherEndpoints = "coords";
  if (allLabels) endpoints = "labels";
  else if (implicit) endpoints = "implicit";
  return {
    call,
    nodeIndex,
    vertices: refs,
    endpoints,
    marks,
    marksText,
    label: labelNode,
    labelText: labelNode ? slice(context, labelNode) : null,
    sourceArgs,
    bend,
    flagStyle,
  };
}

function nodeAtPoint(nodes: ParsedNode[], point: DiagramPoint): ParsedNode | null {
  let best: ParsedNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const parsed of nodes) {
    const distance = Math.hypot(parsed.center.x - point.x, parsed.center.y - point.y);
    const inside =
      point.x >= parsed.node.x - 1 &&
      point.x <= parsed.node.x + parsed.node.w + 1 &&
      point.y >= parsed.node.y - 1 &&
      point.y <= parsed.node.y + parsed.node.h + 1;
    if ((distance < 1 || inside) && distance < bestDistance) {
      best = parsed;
      bestDistance = distance;
    }
  }
  return best;
}

function handleToward(center: DiagramPoint, point: DiagramPoint): DiagramHandle {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.abs(dx) < 1) return dy < 0 ? "t" : "b";
  if (Math.abs(dy) < 1) return dx > 0 ? "r" : "l";
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : dy < 0 ? "t" : "b";
}

function handleAt(angle: number): DiagramHandle {
  const wrapped = ((((angle + 180) % 360) + 360) % 360) - 180;
  if (wrapped >= -45 && wrapped < 45) return "r";
  if (wrapped >= 45 && wrapped < 135) return "t";
  if (wrapped >= -135 && wrapped < -45) return "b";
  return "l";
}

function resolveEdge(
  context: Context,
  edge: ParsedEdge,
  nodes: ParsedNode[],
  byName: Map<string, ParsedNode>,
): { edge: DiagEdge; vertices: DiagramPoint[] } | null {
  const points: (DiagramPoint | null)[] = [];
  const owners: (ParsedNode | null)[] = [];
  edge.vertices.forEach((ref, index) => {
    const previous = points[index - 1] ?? null;
    if (ref.kind === "auto") {
      const neighbour = index === 0 ? nodes[edge.nodeIndex - 1] : nodes[edge.nodeIndex];
      points.push(neighbour?.center ?? null);
      owners.push(neighbour ?? null);
    } else if (ref.kind === "label") {
      const owner = byName.get(ref.name) ?? null;
      points.push(owner?.center ?? null);
      owners.push(owner);
    } else if (ref.kind === "coord") {
      points.push(ref.coordinate.point);
      owners.push(null);
    } else if (ref.kind === "relative" && previous) {
      points.push({ x: previous.x + ref.step.x * GRID_X, y: previous.y + ref.step.y * GRID_Y });
      owners.push(null);
    } else {
      points.push(null);
      owners.push(null);
    }
  });
  if (points.length < 2 || points.some((point) => point === null)) return null;
  const resolved = points as DiagramPoint[];
  const first = owners[0] ?? nodeAtPoint(nodes, resolved[0]);
  const last = owners.at(-1) ?? nodeAtPoint(nodes, resolved.at(-1) as DiagramPoint);
  if (!first || !last) return null;
  const vertices = resolved.slice(1, -1);
  const reversed = edge.marks?.reversed ?? false;
  const source = reversed ? last : first;
  const target = reversed ? first : last;
  const model: DiagEdge = {
    id: "",
    source: source.node.id,
    target: target.node.id,
    routing: "straight",
    arrow: edge.marks?.arrow ?? (edge.marksText === null && !edge.sourceArgs.has("marks") ? "none" : "forward"),
    style: edge.flagStyle ?? edge.marks?.style ?? "solid",
  };
  if (edge.label) {
    const label = contentText(context, edge.label);
    model.label = label.text;
    if (!label.plain) note(context, "approximated", "formattedLabels");
  }
  const bend = edge.bend ?? 0;
  if (source === target) {
    model.routing = "curved";
  } else if (vertices.length > 0) {
    const path = reversed ? [...vertices].reverse() : vertices;
    const chain = [source.center, ...path, target.center];
    const axisAligned = path.every((point, index) => {
      const before = chain[index];
      return Math.abs(before.x - point.x) < 1 || Math.abs(before.y - point.y) < 1;
    });
    if (axisAligned) {
      model.routing = "orthogonal";
      model.sourceHandle = handleToward(source.center, path[0]);
      model.targetHandle = handleToward(target.center, path.at(-1) as DiagramPoint);
    } else {
      note(context, "approximated", "freePoints");
    }
  } else if (bend !== 0) {
    model.routing = "curved";
    const chord =
      Math.atan2(source.center.y - target.center.y, target.center.x - source.center.x) * DEGREES;
    const signedBend = reversed ? -bend : bend;
    model.sourceHandle = handleAt(chord + signedBend);
    model.targetHandle = handleAt(chord - signedBend - 180);
  }
  if (reversed && (edge.sourceArgs.has("marks") || edge.marksText !== null)) {
    edge.sourceArgs.delete("marks");
  }
  return { edge: model, vertices };
}

function findDiagram(context: Context, top: SyntaxNode): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  top.toTree().iterate({
    from: top.from,
    to: top.to,
    enter(ref) {
      if (found) return false;
      if (ref.name === "FuncCall" && calleeName(context, ref.node) === "diagram") {
        found = ref.node;
        return false;
      }
      return true;
    },
  });
  return found;
}

function topStatement(node: SyntaxNode, top: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.parent && current.parent.from >= top.from && current.parent.name !== "Source") {
    current = current.parent;
  }
  return current;
}

function statementStart(statement: SyntaxNode): number {
  const previous = statement.prevSibling;
  return previous?.name === "Hash" && previous.to === statement.from ? previous.from : statement.from;
}

function fletcherImportStatement(context: Context, node: SyntaxNode): boolean {
  if (node.name !== "ModuleImport") return false;
  const path = stringValue(context, node.getChild("Str"));
  return path !== null && /^@preview\/fletcher:/.test(path);
}

function importIsCovered(context: Context, node: SyntaxNode): boolean {
  if (slice(context, node).includes(" as ")) return false;
  const items = node.getChild("ImportItems");
  if (!items) return false;
  return children(items)
    .filter((child) => child.name === "ImportItemPath")
    .every((item) => FLETCHER_IMPORT_NAMES.includes(slice(context, item)));
}

function backgroundBox(context: Context, wrapper: SyntaxNode, diagram: SyntaxNode): string | null {
  if (wrapper.name !== "FuncCall" || calleeName(context, wrapper) !== "box" || wrapper.firstChild?.name !== "Ident") {
    return null;
  }
  const args = argNodes(wrapper);
  if (args.length !== 3 || !args.some((arg) => arg.from === diagram.from && arg.to === diagram.to)) return null;
  let fill: string | null = null;
  let inset = false;
  for (const arg of args) {
    if (arg.from === diagram.from) continue;
    if (arg.name !== "Named") return null;
    const key = namedKey(context, arg);
    const value = namedValue(arg);
    if (key === "fill") {
      const color = colorOf(context, value);
      if (!color?.exact || !color.hex) return null;
      fill = color.hex;
    } else if (key === "inset" && value && slice(context, value) === "4pt") inset = true;
    else return null;
  }
  return fill && inset ? fill : null;
}

function cutRanges(source: string, from: number, to: number, cuts: { from: number; to: number }[]): string {
  let text = "";
  let cursor = from;
  for (const cut of [...cuts].sort((a, b) => a.from - b.from)) {
    if (cut.to <= from || cut.from >= to) continue;
    text += source.slice(cursor, Math.max(cursor, cut.from));
    cursor = Math.max(cursor, cut.to);
  }
  return text + source.slice(cursor, to);
}

function withoutMarkLines(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => !/^\s*\/\/\s*oleafly-diagram-v1:/.test(line))
    .join("\n");
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let suffix = 1; taken.has(name); suffix++) name = `${base}-${suffix}`;
  taken.add(name);
  return name;
}

const RECT_RADIUS = (node: DiagNode) => node.radius ?? (node.shape === "roundrect" ? 6 : 0);

function mergeNode(parsed: DiagNode, hint: DiagNode): DiagNode {
  const merged: DiagNode = { ...parsed };
  for (const field of NODE_FIELDS) {
    if (sameFields(parsed, hint, [field])) (merged as unknown as Record<string, unknown>)[field] = hint[field];
  }
  const rectangular = RECTANGULAR.has(parsed.shape) && RECTANGULAR.has(hint.shape);
  if (rectangular && Math.abs(RECT_RADIUS(parsed) - RECT_RADIUS(hint)) < 0.5 && (parsed.shape === "text") === (hint.shape === "text")) {
    merged.shape = hint.shape;
    if (hint.radius === undefined) delete merged.radius;
    else merged.radius = hint.radius;
  }
  for (const field of ["fill", "stroke", "strokeStyle", "strokeWidth", "textColor", "fontSize", "fontFamily", "radius"] as const) {
    if (merged[field] === undefined) delete merged[field];
  }
  return merged;
}

function mergeEdge(parsed: DiagEdge, hint: DiagEdge): DiagEdge {
  const merged: DiagEdge = { ...parsed, id: hint.id };
  if (parsed.routing === hint.routing || (parsed.source === parsed.target && hint.source === hint.target)) {
    merged.routing = hint.routing;
    if (hint.sourceHandle === undefined) delete merged.sourceHandle;
    else merged.sourceHandle = hint.sourceHandle;
    if (hint.targetHandle === undefined) delete merged.targetHandle;
    else merged.targetHandle = hint.targetHandle;
  }
  if ((parsed.label ?? "") === (hint.label ?? "") && hint.label === undefined) delete merged.label;
  return merged;
}

function hintLines(hint: DiagramModel) {
  const { byId } = typstNames(hint.nodes);
  const nodesById = new Map(hint.nodes.map((node) => [node.id, node]));
  const nodes = new Map<string, string>();
  for (const node of hint.nodes) {
    nodes.set(node.id, squash(`node(${nodeArgList(node, byId.get(node.id) ?? node.id).map((arg) => arg.text).join(", ")})`));
  }
  const edges = new Map<string, string>();
  for (const edge of hint.edges) {
    const args = edgeArgList(edge, nodesById, byId);
    if (args) edges.set(edge.id, squash(`edge(${args.map((arg) => arg.text).join(", ")})`));
  }
  return { nodes, edges };
}

export function readFletcher(parser: Parser, source: string, options: DiagramReadOptions = {}): DiagramRead<FletcherExtras> {
  const context: Context = { source, notes: [] };
  const hint = readModelMark(source, TYPST_COMMENT) ?? options.hint ?? null;
  const tree = parser.parse(source);
  const top = tree.topNode;
  const diagram = findDiagram(context, top);
  if (!diagram) {
    return { model: null, extras: null, notes: [{ kind: "dropped", code: "notDiagram" }] };
  }
  const statement = topStatement(diagram, top);
  const start = statementStart(statement);
  const cuts: { from: number; to: number }[] = [];
  const imports: string[] = [];
  for (let child = top.firstChild; child; child = child.nextSibling) {
    if (child.from >= start) break;
    if (fletcherImportStatement(context, child)) {
      const from = statementStart(child);
      let to = child.to;
      if (source[to] === "\n") to += 1;
      cuts.push({ from, to });
      if (!importIsCovered(context, child)) imports.push(source.slice(from, child.to));
    }
  }
  const before = withoutMarkLines(cutRanges(source, 0, start, cuts));
  const after = withoutMarkLines(source.slice(statement.to));
  if (before.trim() || after.trim()) note(context, "kept", "outsideCode");

  let background: string | undefined;
  let open: string | null = null;
  let close: string | null = null;
  if (statement.from !== diagram.from || statement.to !== diagram.to) {
    const wrapper = diagram.parent?.parent ?? null;
    const boxed = wrapper && wrapper.from === statement.from && wrapper.to === statement.to ? backgroundBox(context, wrapper, diagram) : null;
    if (boxed) background = boxed;
    else {
      open = source.slice(start, diagram.from);
      close = source.slice(diagram.to, statement.to);
      note(context, "kept", "wrapper");
    }
  }

  const extras: FletcherExtras = {
    imports,
    before,
    after,
    open,
    close,
    diagramArgs: [],
    omitDefaults: [],
    items: [],
    order: [],
    nodes: {},
    edges: {},
  };
  const defaults = new Map(FLETCHER_DEFAULTS.map((arg) => [arg.key, arg.text]));
  const seenDefaults = new Set<string>();
  const items = argNodes(diagram);
  const taken = new Set<string>();
  for (const item of items) {
    if (item.name !== "FuncCall" || calleeName(context, item) !== "node") continue;
    const nameArg = argNodes(item).find((arg) => arg.name === "Named" && namedKey(context, arg) === "name");
    const name = nameArg ? labelNameOf(context, namedValue(nameArg)) : null;
    if (name) taken.add(name);
  }
  const nodes: ParsedNode[] = [];
  const pendingEdges: ParsedEdge[] = [];
  const order: ({ kind: "node"; parsed: ParsedNode } | { kind: "edge"; parsed: ParsedEdge } | { kind: "item"; text: string })[] = [];
  const keepItem = (item: SyntaxNode, why: string) => {
    const text = slice(context, item);
    extras.items.push(text);
    order.push({ kind: "item", text });
    note(context, "kept", why);
  };
  for (const item of items) {
    if (item.name === "Named") {
      const key = namedKey(context, item);
      const text = slice(context, item);
      if (defaults.has(key)) {
        seenDefaults.add(key);
        if (squash(defaults.get(key) ?? "") === squash(text)) continue;
      }
      extras.diagramArgs.push({ key, text });
      if (!defaults.has(key)) note(context, "kept", "diagramSetting", key);
      continue;
    }
    if (item.name === "FuncCall" && calleeName(context, item) === "node") {
      const nameArg = argNodes(item).find((arg) => arg.name === "Named" && namedKey(context, arg) === "name");
      const name = nameArg ? labelNameOf(context, namedValue(nameArg)) : null;
      const parsed = readNodeCall(context, item, name, name ?? uniqueName("node", taken));
      if (!parsed) {
        keepItem(item, "unplacedNode");
        continue;
      }
      nodes.push(parsed);
      order.push({ kind: "node", parsed });
      continue;
    }
    if (item.name === "FuncCall" && calleeName(context, item) === "edge") {
      const parsed = readEdgeCall(context, item, nodes.length);
      if (!parsed) {
        keepItem(item, "unreadEdge");
        continue;
      }
      pendingEdges.push(parsed);
      order.push({ kind: "edge", parsed });
      continue;
    }
    if (item.name === "Equation") keepItem(item, "mathMode");
    else keepItem(item, "scripted");
  }
  for (const key of defaults.keys()) if (!seenDefaults.has(key)) extras.omitDefaults.push(key);

  const byName = new Map(nodes.map((parsed) => [parsed.node.id, parsed]));
  const lines = hint ? hintLines(hint) : null;
  const hintNodes = new Map((hint?.nodes ?? []).map((node) => [node.id, node]));
  const modelNodes: DiagNode[] = [];
  const names = fletcherNames(
    nodes.map((parsed) => parsed.node),
    new Set(nodes.filter((parsed) => parsed.element.named).map((parsed) => parsed.node.id)),
  );
  for (const parsed of nodes) {
    const hinted = hintNodes.get(parsed.node.id);
    if (hinted && lines?.nodes.get(hinted.id) === squash(parsed.element.text)) {
      parsed.node = hinted;
      parsed.element.read = hinted;
      parsed.element.args = [];
    } else {
      const node = hinted ? mergeNode(parsed.node, hinted) : parsed.node;
      const writer = nodeArgList(node, names.get(node.id) ?? node.id);
      parsed.element.args = rawArgsFor(
        parsed.sourceArgs,
        writer,
        NODE_KEY_FIELDS,
        new Set(["width", "height", "radius", "shape", "layer", "corner-radius"]),
      );
      parsed.node = node;
      parsed.element.read = node;
    }
    modelNodes.push(parsed.node);
    extras.nodes[parsed.node.id] = parsed.element;
  }

  const usedHintEdges = new Set<string>();
  const takenEdgeIds = new Set((hint?.edges ?? []).map((edge) => edge.id));
  const modelEdges: DiagEdge[] = [];
  const nodesById = new Map(modelNodes.map((node) => [node.id, node]));
  const edgeIds = new Map<ParsedEdge, string>();
  for (const parsed of pendingEdges) {
    const resolved = resolveEdge(context, parsed, nodes, byName);
    if (!resolved) {
      const text = slice(context, parsed.call);
      extras.items.push(text);
      const at = order.findIndex((entry) => entry.kind === "edge" && entry.parsed === parsed);
      if (at >= 0) order[at] = { kind: "item", text };
      note(context, "kept", "danglingEdge");
      continue;
    }
    let edge = resolved.edge;
    const candidates = (hint?.edges ?? []).filter(
      (candidate) => !usedHintEdges.has(candidate.id) && candidate.source === edge.source && candidate.target === edge.target,
    );
    const exact = candidates.find((candidate) => lines?.edges.get(candidate.id) === squash(slice(context, parsed.call)));
    const match = exact ?? candidates[0];
    let args: FletcherRawArg[] = [];
    if (match) {
      usedHintEdges.add(match.id);
      edge = exact ? match : mergeEdge(edge, match);
    } else {
      edge.id = uniqueName("edge", takenEdgeIds);
    }
    if (!exact) {
      const writer = edgeArgList(edge, nodesById, names) ?? [];
      args = rawArgsFor(
        parsed.sourceArgs,
        writer,
        EDGE_KEY_FIELDS,
        new Set(["label-side", "label-pos", "corner-radius", "dash", "bend"]),
      );
      if (resolved.vertices.length > 0 && !parsed.marks?.reversed) {
        const vertexText = argNodes(parsed.call)
          .filter((arg) => arg.name === "Array")
          .slice(parsed.vertices[0]?.kind === "coord" ? 1 : 0, parsed.vertices.at(-1)?.kind === "coord" ? -1 : undefined)
          .map((arg) => slice(context, arg))
          .join(", ");
        const written = writer.find((arg) => arg.key === "vertices")?.text ?? "";
        if (vertexText && squash(vertexText) !== squash(written)) {
          args.push({ key: "vertices", text: vertexText, fields: EDGE_KEY_FIELDS.vertices, geometry: true });
        }
      }
    }
    edgeIds.set(parsed, edge.id);
    modelEdges.push(edge);
    extras.edges[edge.id] = {
      read: edge,
      text: slice(context, parsed.call),
      args,
      endpoints: parsed.endpoints,
    };
  }
  extras.order = order.map((entry) => {
    if (entry.kind === "node") return `n:${entry.parsed.node.id}`;
    if (entry.kind === "edge") return `e:${edgeIds.get(entry.parsed) ?? ""}`;
    return `i:${entry.text}`;
  });
  if (hint && hint.background !== undefined && (background ?? "") === (hint.background ?? "")) background = hint.background;
  const model: DiagramModel = {
    version: 1,
    nodes: modelNodes,
    edges: modelEdges,
    ...(background === undefined ? {} : { background }),
  };
  for (const edge of model.edges) {
    for (const field of EDGE_FIELDS) {
      if ((edge as unknown as Record<string, unknown>)[field] === undefined) delete (edge as unknown as Record<string, unknown>)[field];
    }
  }
  return { model, extras, notes: context.notes };
}
