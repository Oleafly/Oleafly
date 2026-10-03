import {
  type DiagEdge,
  type DiagNode,
  type DiagramHandle,
  type DiagramModel,
  type DiagramPoint,
  type NodeShape,
  orthogonalRoute,
  PX_PER_CM,
} from "@oleafly/latex";

export interface FletcherArg {
  key: string;
  text: string;
}

export interface FletcherRawArg {
  key: string;
  text: string;
  fields: string[];
  geometry?: boolean;
}

export type FletcherEndpoints = "labels" | "coords" | "implicit";

export interface FletcherElement<T> {
  read: T;
  text: string;
  args: FletcherRawArg[];
  named?: boolean;
  nameAt?: number;
  namePrefix?: string;
  endpoints?: FletcherEndpoints;
}

export interface FletcherExtras {
  imports: string[];
  before: string;
  after: string;
  open: string | null;
  close: string | null;
  diagramArgs: FletcherArg[];
  omitDefaults: string[];
  items: string[];
  order: string[];
  nodes: Record<string, FletcherElement<DiagNode>>;
  edges: Record<string, FletcherElement<DiagEdge>>;
}

export interface FletcherOptions {
  typstVersion?: string | null;
  extras?: FletcherExtras | null;
}

const LATEST_FLETCHER = "0.5.8";

export function fletcherVersionFor(typstVersion: string | null | undefined): string {
  const match = /^\s*v?(\d{1,6})\.(\d{1,6})/.exec(typstVersion ?? "");
  if (!match) return LATEST_FLETCHER;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major > 0 || minor >= 13) return LATEST_FLETCHER;
  return minor === 12 ? "0.5.5" : "0.5.1";
}

export const FLETCHER_IMPORT_NAMES = ["diagram", "node", "edge", "shapes"];

export function fletcherImport(version: string): string {
  return `#import "@preview/fletcher:${version}": ${FLETCHER_IMPORT_NAMES.join(", ")}`;
}

const DEGREES = 180 / Math.PI;
const round = (value: number, digits: number) => +value.toFixed(digits);
const cm = (px: number) => `${round(px / PX_PER_CM, 3)}cm`;
const position = (point: DiagramPoint) => `(${cm(point.x)}, ${cm(-point.y)})`;

function typstColor(hex: string | undefined): string | null {
  const value = (hex ?? "").replace("#", "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(value) ? `rgb("#${value}")` : null;
}

const ESCAPED = new Set(["\\", "[", "]", "#", "$", "@", "*", "_", "`", "<", ">", '"', "~"]);

const isSpace = (character: string | undefined) => character?.trim() === "";

function leadingMarkerIndex(text: string): number {
  let start = 0;
  while (isSpace(text[start])) start += 1;
  const first = text[start];
  if (first === "-" || first === "+" || first === "/") {
    return isSpace(text[start + 1]) ? start : -1;
  }
  let end = start;
  if (first === "=") {
    while (text[end] === "=") end += 1;
    return isSpace(text[end]) ? start : -1;
  }
  while (text[end] >= "0" && text[end] <= "9") end += 1;
  return end > start && text[end] === "." && isSpace(text[end + 1]) ? end : -1;
}

function escapeMarkup(value: string): string {
  const lines = value.split(/\r\n|\r|\n/);
  const text = lines.length === 1 ? value : lines.map((line) => line.trim()).join(" ");
  const marker = leadingMarkerIndex(text);
  let out = "";
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const opensComment = character === "/" && (text[index + 1] === "/" || text[index + 1] === "*");
    out += index === marker || opensComment || ESCAPED.has(character) ? `\\${character}` : character;
  }
  return out;
}

function wholeSpan(value: string, delimiter: string): boolean {
  if (value.length < 3 || !value.startsWith(delimiter) || !value.endsWith(delimiter)) return false;
  const inner = value.slice(1, -1);
  return inner.trim() !== "" && !inner.includes(delimiter) && !/[\r\n]/.test(inner);
}

export function labelMarkup(label: string): string {
  if (wholeSpan(label, "$") || wholeSpan(label, "`")) return label;
  return escapeMarkup(label);
}

function trimDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") start++;
  while (end > start && value[end - 1] === "-") end--;
  return value.slice(start, end);
}

function labelBase(id: string): string {
  const base = trimDashes(id.replace(/[^A-Za-z0-9_-]+/g, "-"));
  if (!base) return "node";
  return /^[A-Za-z]/.test(base) ? base : `n-${base}`;
}

export function typstNames(nodes: DiagNode[]): { byIndex: string[]; byId: Map<string, string> } {
  const used = new Set<string>();
  const byId = new Map<string, string>();
  const byIndex = nodes.map((n) => {
    const base = labelBase(n.id);
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      name = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(name);
    if (!byId.has(n.id)) byId.set(n.id, name);
    return name;
  });
  return { byIndex, byId };
}

export function fletcherNames(nodes: DiagNode[], named: ReadonlySet<string>): Map<string, string> {
  const { byId } = typstNames(nodes);
  for (const id of named) byId.set(id, id);
  return byId;
}

export const FLETCHER_FONTS: Record<NonNullable<DiagNode["fontFamily"]>, string | null> = {
  serif: null,
  sans: "Arial",
  mono: "DejaVu Sans Mono",
};

function nodeLabel(n: DiagNode): string | null {
  if (!n.label) return null;
  const style = [`size: ${n.fontSize ?? 10}pt`];
  const color = typstColor(n.textColor);
  if (color) style.push(`fill: ${color}`);
  const font = n.fontFamily ? FLETCHER_FONTS[n.fontFamily] : null;
  if (font) style.push(`font: "${font}"`);
  return `text(${style.join(", ")})[${labelMarkup(n.label)}]`;
}

function parallelogramAngle(n: DiagNode): number {
  if (n.h <= 0) return 20;
  return round(Math.atan((0.44 * n.w) / n.h) * DEGREES, 3);
}

function shapeArgs(n: DiagNode): FletcherArg[] {
  if (n.shape === "circle") {
    return [
      { key: "radius", text: `radius: ${cm(Math.max(n.w, n.h) / 2)}` },
      { key: "shape", text: "shape: circle" },
    ];
  }
  const size = [
    { key: "width", text: `width: ${cm(n.w)}` },
    { key: "height", text: `height: ${cm(n.h)}` },
  ];
  if (n.shape === "ellipse") return [...size, { key: "shape", text: "shape: shapes.ellipse" }];
  if (n.shape === "diamond") return [...size, { key: "shape", text: "shape: shapes.diamond.with(fit: 0)" }];
  if (n.shape === "parallelogram") {
    return [
      ...size,
      { key: "shape", text: `shape: shapes.parallelogram.with(angle: ${parallelogramAngle(n)}deg, fit: 0)` },
    ];
  }
  return [...size, { key: "shape", text: "shape: rect" }];
}

function strokeArg(n: DiagNode): string | null {
  const paint = typstColor(n.stroke);
  if (!paint) return n.shape === "text" ? "stroke: none" : null;
  const parts = [`paint: ${paint}`, `thickness: ${cm(n.strokeWidth ?? 1)}`];
  if (n.strokeStyle === "dashed") parts.push('dash: "dashed"');
  if (n.strokeStyle === "dotted") parts.push('dash: "dotted"', 'cap: "round"');
  return `stroke: (${parts.join(", ")})`;
}

const ROUNDABLE = new Set<NodeShape>(["rectangle", "roundrect", "text"]);

export const isGroupContainer = (n: DiagNode) => n.shape === "roundrect" && !n.label;

const center = (n: DiagNode): DiagramPoint => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

export function nodeArgList(n: DiagNode, name: string): FletcherArg[] {
  const args: FletcherArg[] = [{ key: "pos", text: position(center(n)) }];
  const label = nodeLabel(n);
  if (label) args.push({ key: "label", text: label });
  args.push({ key: "name", text: `name: <${name}>` }, ...shapeArgs(n));
  const fill = typstColor(n.fill);
  if (fill) args.push({ key: "fill", text: `fill: ${fill}` });
  const stroke = strokeArg(n);
  if (stroke) args.push({ key: "stroke", text: stroke });
  const radius = n.radius ?? (n.shape === "roundrect" ? 6 : 0);
  if (radius > 0 && ROUNDABLE.has(n.shape)) args.push({ key: "corner-radius", text: `corner-radius: ${cm(radius)}` });
  if (isGroupContainer(n)) args.push({ key: "layer", text: "layer: -1" });
  return args;
}

export const FLETCHER_MARKS: Record<DiagEdge["arrow"], string> = {
  none: '"-"',
  forward: '"-|>"',
  both: '"<|-|>"',
};

const HANDLE_ANGLE: Record<DiagramHandle, number> = { t: 90, r: 0, b: -90, l: 180 };

function handle(value: string | undefined, fallback: DiagramHandle): DiagramHandle {
  return value === "t" || value === "r" || value === "b" || value === "l" ? value : fallback;
}

function handlePoint(n: DiagNode, side: DiagramHandle): DiagramPoint {
  if (side === "t") return { x: n.x + n.w / 2, y: n.y };
  if (side === "r") return { x: n.x + n.w, y: n.y + n.h / 2 };
  if (side === "b") return { x: n.x + n.w / 2, y: n.y + n.h };
  return { x: n.x, y: n.y + n.h / 2 };
}

const wrapDegrees = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180;

const TIKZ_CURVE_CONTROL = 0.3915;

export function curvedBend(source: DiagNode, target: DiagNode, edge: Pick<DiagEdge, "sourceHandle" | "targetHandle">): number {
  const from = center(source);
  const to = center(target);
  const chord = Math.atan2(from.y - to.y, to.x - from.x) * DEGREES;
  const leave = wrapDegrees(HANDLE_ANGLE[handle(edge.sourceHandle, "b")] - chord);
  const arrive = wrapDegrees(chord - HANDLE_ANGLE[handle(edge.targetHandle, "t")] - 180);
  const tangent = (leave + arrive) / 2 / DEGREES;
  return Math.round(2 * Math.atan(1.5 * TIKZ_CURVE_CONTROL * Math.sin(tangent)) * DEGREES);
}

function withoutStraightRuns(points: DiagramPoint[]): DiagramPoint[] {
  const kept: DiagramPoint[] = [];
  points.forEach((point, index) => {
    const previous = kept.at(-1);
    const next = points[index + 1];
    const straight =
      previous !== undefined &&
      next !== undefined &&
      ((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
    if (!straight) kept.push(point);
  });
  return kept;
}

function labelPosition(points: DiagramPoint[], label: DiagramPoint): number {
  const segments = points.length - 1;
  let best = { distance: Number.POSITIVE_INFINITY, at: 0.5 };
  for (let index = 0; index < segments; index++) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const along = Math.min(1, Math.max(0, ((label.x - a.x) * dx + (label.y - a.y) * dy) / (dx * dx + dy * dy)));
    const distance = Math.hypot(a.x + along * dx - label.x, a.y + along * dy - label.y);
    if (distance < best.distance) best = { distance, at: (index + along) / segments };
  }
  return round(best.at, 4);
}

function orthogonalPath(source: DiagNode, target: DiagNode, edge: DiagEdge) {
  const sourceHandle = handle(edge.sourceHandle, "b");
  const targetHandle = handle(edge.targetHandle, "t");
  const route = orthogonalRoute(
    handlePoint(source, sourceHandle),
    handlePoint(target, targetHandle),
    sourceHandle,
    targetHandle,
  );
  const points = withoutStraightRuns(route.points);
  const vertices = points.slice(1, -1);
  return { vertices, labelPos: vertices.length > 0 ? labelPosition(points, route.label) : null };
}

export const EDGE_CORNER_RADIUS = `corner-radius: ${cm(5)}`;

export function edgeArgList(
  edge: DiagEdge,
  nodes: Map<string, DiagNode>,
  names: Map<string, string>,
): FletcherArg[] | null {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target) return null;
  let vertices: DiagramPoint[] = [];
  let labelPos: number | null = null;
  let bend = 0;
  if (edge.source === edge.target) {
    bend = 130;
  } else if (edge.routing === "orthogonal") {
    ({ vertices, labelPos } = orthogonalPath(source, target, edge));
  } else if (edge.routing === "curved") {
    bend = curvedBend(source, target, edge);
  }
  const args: FletcherArg[] = [{ key: "from", text: `<${names.get(edge.source)}>` }];
  if (vertices.length > 0) args.push({ key: "vertices", text: vertices.map(position).join(", ") });
  args.push(
    { key: "to", text: `<${names.get(edge.target)}>` },
    { key: "marks", text: FLETCHER_MARKS[edge.arrow] ?? FLETCHER_MARKS.forward },
  );
  if (edge.label) {
    args.push({ key: "label", text: `[${labelMarkup(edge.label)}]` }, { key: "label-side", text: "label-side: center" });
    if (labelPos !== null) args.push({ key: "label-pos", text: `label-pos: ${labelPos}` });
  }
  if (edge.style === "dashed" || edge.style === "dotted") args.push({ key: "dash", text: `dash: "${edge.style}"` });
  if (bend) args.push({ key: "bend", text: `bend: ${bend}deg` });
  if (vertices.length > 0) args.push({ key: "corner-radius", text: EDGE_CORNER_RADIUS });
  return args;
}

export const FLETCHER_DEFAULTS: FletcherArg[] = [
  { key: "node-inset", text: "node-inset: 0pt" },
  { key: "node-defocus", text: "node-defocus: 0" },
  { key: "edge-stroke", text: `edge-stroke: ${cm(2)}` },
  { key: "label-size", text: "label-size: 9pt" },
];

type Fields = Record<string, unknown>;

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.5;
  return (a ?? "") === (b ?? "");
}

export function sameFields(a: object, b: object, fields: readonly string[]): boolean {
  return fields.every((field) => sameValue((a as Fields)[field], (b as Fields)[field]));
}

export const NODE_FIELDS = [
  "shape",
  "x",
  "y",
  "w",
  "h",
  "label",
  "fill",
  "stroke",
  "strokeStyle",
  "strokeWidth",
  "textColor",
  "fontSize",
  "fontFamily",
  "radius",
] as const;

export const EDGE_FIELDS = [
  "source",
  "target",
  "routing",
  "arrow",
  "style",
  "label",
  "sourceHandle",
  "targetHandle",
] as const;

const GEOMETRY_FIELDS = ["x", "y", "w", "h"];

function mergeArgs(
  args: FletcherArg[],
  raw: FletcherRawArg[],
  read: object,
  current: object,
  geometryUnchanged: boolean,
): FletcherArg[] {
  let merged = [...args];
  for (const extra of raw) {
    if (!sameFields(read, current, extra.fields)) continue;
    if (extra.geometry && !geometryUnchanged) continue;
    const index = merged.findIndex((arg) => arg.key === extra.key);
    if (index >= 0) {
      merged = extra.text
        ? merged.map((arg, at) => (at === index ? { key: arg.key, text: extra.text } : arg))
        : merged.filter((_, at) => at !== index);
    } else if (extra.text) {
      merged.push({ key: extra.key, text: extra.text });
    }
  }
  return merged;
}

const call = (name: string, args: FletcherArg[]) => `${name}(${args.map((arg) => arg.text).join(", ")})`;

interface Emission {
  model: DiagramModel;
  extras: FletcherExtras | null;
  nodesById: Map<string, DiagNode>;
  names: Map<string, string>;
  nameOf: (id: string) => string;
}

function nodeUnchanged(emission: Emission, id: string): boolean {
  const known = emission.extras?.nodes[id];
  const node = emission.nodesById.get(id);
  return Boolean(known && node && sameFields(known.read, node, NODE_FIELDS));
}

function geometryUnchanged(emission: Emission, edge: DiagEdge): boolean {
  return [edge.source, edge.target].every((id) => {
    const known = emission.extras?.nodes[id];
    const node = emission.nodesById.get(id);
    return !known || (node !== undefined && sameFields(known.read, node, GEOMETRY_FIELDS));
  });
}

function edgeVerbatim(emission: Emission, edge: DiagEdge, previousNode: string | null, nextNode: string | null): boolean {
  const known = emission.extras?.edges[edge.id];
  if (!known || !sameFields(known.read, edge, EDGE_FIELDS)) return false;
  if (known.endpoints === "labels") return true;
  if (known.endpoints === "coords") return geometryUnchanged(emission, edge) && nodeUnchanged(emission, edge.source) && nodeUnchanged(emission, edge.target);
  return previousNode === edge.source && nextNode === edge.target && nodeUnchanged(emission, edge.source) && nodeUnchanged(emission, edge.target);
}

function nodeText(emission: Emission, node: DiagNode, needsName: boolean): string {
  const known = emission.extras?.nodes[node.id];
  const name = emission.nameOf(node.id);
  if (known && sameFields(known.read, node, NODE_FIELDS)) {
    if (known.named || !needsName || known.nameAt === undefined) return known.text;
    return `${known.text.slice(0, known.nameAt)}${known.namePrefix ?? ", "}name: <${name}>${known.text.slice(known.nameAt)}`;
  }
  const args = nodeArgList(node, name);
  return call("node", known ? mergeArgs(args, known.args, known.read, node, sameFields(known.read, node, GEOMETRY_FIELDS)) : args);
}

function edgeText(emission: Emission, edge: DiagEdge): string | null {
  const args = edgeArgList(edge, emission.nodesById, emission.names);
  if (!args) return null;
  const known = emission.extras?.edges[edge.id];
  return call("edge", known ? mergeArgs(args, known.args, known.read, edge, geometryUnchanged(emission, edge)) : args);
}

type Slot = { kind: "node"; node: DiagNode } | { kind: "edge"; edge: DiagEdge } | { kind: "item"; text: string };

function slotKey(slot: Slot): string {
  if (slot.kind === "node") return `n:${slot.node.id}`;
  if (slot.kind === "edge") return `e:${slot.edge.id}`;
  return `i:${slot.text}`;
}

function sourceOrderHolds(model: DiagramModel, extras: FletcherExtras): boolean {
  const ranks = new Map(extras.order.map((key, index) => [key, index]));
  let last = -1;
  for (const node of model.nodes) {
    const rank = ranks.get(`n:${node.id}`);
    if (rank === undefined) continue;
    if (rank < last) return false;
    last = rank;
  }
  return true;
}

function orderedSlots(model: DiagramModel, extras: FletcherExtras | null): Slot[] {
  const slots: Slot[] = [
    ...model.nodes.map((node): Slot => ({ kind: "node", node })),
    ...model.edges.map((edge): Slot => ({ kind: "edge", edge })),
    ...(extras?.items ?? []).map((text): Slot => ({ kind: "item", text })),
  ];
  if (!extras || extras.order.length === 0 || !sourceOrderHolds(model, extras)) return slots;
  const ranks = new Map(extras.order.map((key, index) => [key, index]));
  const known = slots.filter((slot) => ranks.has(slotKey(slot)));
  known.sort((a, b) => (ranks.get(slotKey(a)) ?? 0) - (ranks.get(slotKey(b)) ?? 0));
  const fresh = slots.filter((slot) => !ranks.has(slotKey(slot)));
  return [
    ...known,
    ...fresh.filter((slot) => slot.kind === "node"),
    ...fresh.filter((slot) => slot.kind !== "node"),
  ];
}

function bodyLines(emission: Emission): string[] {
  const slots = orderedSlots(emission.model, emission.extras);
  const lines: string[] = [];
  const verbatimEdges = new Set<string>();
  slots.forEach((slot, index) => {
    if (slot.kind !== "edge") return;
    let previous: string | null = null;
    for (let at = index - 1; at >= 0 && previous === null; at--) {
      const candidate = slots[at];
      if (candidate.kind === "node") previous = candidate.node.id;
    }
    let next: string | null = null;
    for (let at = index + 1; at < slots.length && next === null; at++) {
      const candidate = slots[at];
      if (candidate.kind === "node") next = candidate.node.id;
    }
    if (edgeVerbatim(emission, slot.edge, previous, next)) verbatimEdges.add(slot.edge.id);
  });
  const needsName = new Set<string>();
  for (const edge of emission.model.edges) {
    if (verbatimEdges.has(edge.id)) continue;
    needsName.add(edge.source);
    needsName.add(edge.target);
  }
  for (const slot of slots) {
    if (slot.kind === "node") lines.push(nodeText(emission, slot.node, needsName.has(slot.node.id)));
    else if (slot.kind === "item") lines.push(slot.text);
    else if (verbatimEdges.has(slot.edge.id)) lines.push(emission.extras?.edges[slot.edge.id]?.text ?? "");
    else {
      const text = edgeText(emission, slot.edge);
      if (text !== null) lines.push(text);
    }
  }
  return lines.filter(Boolean);
}

function diagramArgs(extras: FletcherExtras | null): string[] {
  const own = new Set([...(extras?.omitDefaults ?? []), ...(extras?.diagramArgs ?? []).map((arg) => arg.key)]);
  return [
    ...FLETCHER_DEFAULTS.filter((arg) => !own.has(arg.key)).map((arg) => arg.text),
    ...(extras?.diagramArgs ?? []).map((arg) => arg.text),
  ];
}

export function modelToFletcher(model: DiagramModel, options: FletcherOptions = {}): string {
  const extras = options.extras ?? null;
  const named = new Set(Object.entries(extras?.nodes ?? {}).filter(([, element]) => element.named).map(([id]) => id));
  const byId = fletcherNames(model.nodes, named);
  const nodesById = new Map<string, DiagNode>();
  for (const n of model.nodes) if (!nodesById.has(n.id)) nodesById.set(n.id, n);
  const emission: Emission = {
    model,
    extras,
    nodesById,
    names: byId,
    nameOf: (id) => byId.get(id) ?? labelBase(id),
  };
  const body = [...diagramArgs(extras), ...bodyLines(emission)].map((line) => `  ${line},`);
  const background = typstColor(model.background);
  const wrapped = extras?.open != null && extras.close != null;
  let open = "#diagram(";
  let close = ")";
  if (wrapped) {
    open = `${extras.open}diagram(`;
    close = `)${extras.close}`;
  } else if (background) {
    open = `#box(fill: ${background}, inset: 4pt, diagram(`;
    close = "))";
  }
  const head = [fletcherImport(fletcherVersionFor(options.typstVersion)), ...(extras?.imports ?? [])];
  const before = extras?.before.trim() ? [extras.before.trim()] : [];
  const after = extras?.after.trim() ? [extras.after.trim()] : [];
  return [...head, ...before, open, ...body, close, ...after].join("\n");
}
