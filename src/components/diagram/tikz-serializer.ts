import type { DiagramModel, DiagNode, DiagEdge, NodeShape } from "./model";

export const PX_PER_CM = 40;

const px2cm = (v: number) => +(v / PX_PER_CM).toFixed(3);

/** Center of a node in tikz coordinates (y flipped: screen down -> tikz up). */
function center(n: DiagNode): { x: number; y: number } {
  return { x: px2cm(n.x + n.w / 2), y: px2cm(-(n.y + n.h / 2)) };
}

/** A tikz-safe color name + its \definecolor line, for a hex color. Returns
 *  name=null for empty/invalid input. */
function colorRef(hex: string | undefined): { name: string | null; def?: string } {
  if (!hex) return { name: null };
  const h = hex.replace("#", "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(h)) return { name: null };
  const name = `c${h}`;
  return { name, def: `\\definecolor{${name}}{HTML}{${h}}` };
}

const SHAPE_OPT: Record<NodeShape, string> = {
  rectangle: "rectangle",
  roundrect: "rectangle, rounded corners",
  circle: "circle",
  ellipse: "ellipse",
  diamond: "diamond",
  text: "",
};

function nodeToTikz(n: DiagNode, defs: Set<string>): string {
  const c = center(n);
  const isText = n.shape === "text";
  const opts: string[] = [];
  if (!isText) {
    opts.push("draw");
    const shape = SHAPE_OPT[n.shape];
    if (shape) opts.push(shape);
  }
  const stroke = colorRef(n.stroke);
  if (stroke.name && !isText) {
    if (stroke.def) defs.add(stroke.def);
    const i = opts.indexOf("draw");
    if (i >= 0) opts[i] = `draw=${stroke.name}`;
  }
  const fill = colorRef(n.fill);
  if (fill.name && !isText) {
    if (fill.def) defs.add(fill.def);
    opts.push(`fill=${fill.name}`);
  }
  if (n.strokeStyle === "dashed") opts.push("dashed");
  if (n.strokeStyle === "dotted") opts.push("dotted");
  if (n.strokeWidth && n.strokeWidth !== 1) opts.push(`line width=${px2cm(n.strokeWidth)}cm`);
  const text = colorRef(n.textColor);
  if (text.name) {
    if (text.def) defs.add(text.def);
    opts.push(`text=${text.name}`);
  }
  if (!isText) {
    opts.push(`minimum width=${px2cm(n.w)}cm`);
    opts.push(`minimum height=${px2cm(n.h)}cm`);
  }
  const optStr = opts.length ? `[${opts.join(", ")}] ` : "";
  return `\\node (${n.id}) at (${c.x},${c.y}) ${optStr}{${n.label}};`;
}

const ARROW_OPT: Record<DiagEdge["arrow"], string> = {
  none: "",
  forward: "->",
  both: "<->",
};

function edgeToTikz(e: DiagEdge): string {
  const opts: string[] = [];
  const a = ARROW_OPT[e.arrow];
  if (a) opts.push(a);
  if (e.style === "dashed") opts.push("dashed");
  const optStr = opts.length ? `[${opts.join(", ")}]` : "";
  const connector =
    e.routing === "orthogonal" ? "-|" : e.routing === "curved" ? "to[out=0, in=180]" : "--";
  const mid = e.label ? ` node[midway, fill=white, font=\\small] {${e.label}}` : "";
  return `\\draw${optStr} (${e.source}) ${connector}${mid} (${e.target});`;
}

/** Generate the TikZ body (definecolors + nodes + edges), no preamble. */
export function modelToTikz(model: DiagramModel): string {
  const defs = new Set<string>();
  const nodes = model.nodes.map((n) => nodeToTikz(n, defs));
  const edges = model.edges.map(edgeToTikz);
  const defLines = [...defs].sort();
  return [...defLines, ...nodes, ...edges].join("\n");
}

const MARK = "% openleaf-diagram-v1:";

function b64encode(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(b64: string): unknown {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** TikZ body + an embedded model comment for full round-trip editing. */
export function serializeDiagram(model: DiagramModel): string {
  return `${modelToTikz(model)}\n${MARK} ${b64encode(model)}`;
}

/** Read the embedded model back, or null if this TikZ was not made by us. */
export function parseEmbeddedModel(tikz: string): DiagramModel | null {
  const line = tikz.split("\n").find((l) => l.trimStart().startsWith(MARK));
  if (!line) return null;
  try {
    const b64 = line.slice(line.indexOf(MARK) + MARK.length).trim();
    const model = b64decode(b64) as DiagramModel;
    if (model && model.version === 1 && Array.isArray(model.nodes)) return model;
    return null;
  } catch {
    return null;
  }
}
