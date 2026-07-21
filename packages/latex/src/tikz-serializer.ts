import type { DiagramModel, DiagNode, DiagEdge, NodeShape } from "./model";
import {
  orthogonalRoute,
  type DiagramHandle,
  type DiagramPoint,
} from "./diagram-routing";

export const PX_PER_CM = 40;

const px2cm = (v: number) => +(v / PX_PER_CM).toFixed(3);
const dash = (style: "solid" | "dashed" | "dotted" | undefined) =>
  style === "dashed"
    ? "dash pattern=on 0.15cm off 0.1cm"
    : style === "dotted"
      ? "dash pattern=on 0.038cm off 0.1cm, line cap=round"
      : null;

function center(n: DiagNode): { x: number; y: number } {
  return { x: px2cm(n.x + n.w / 2), y: px2cm(-(n.y + n.h / 2)) };
}

function colorRef(hex: string | undefined): { name: string | null; def?: string } {
  if (!hex) return { name: null };
  const h = hex.replace("#", "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(h)) return { name: null };
  const name = `c${h}`;
  return { name, def: `\\definecolor{${name}}{HTML}{${h}}` };
}

const ROUNDABLE = new Set<NodeShape>(["rectangle", "roundrect", "text"]);

function nodeToTikz(n: DiagNode, defs: Set<string>): string {
  const c = center(n);
  const opts: string[] = [];
  // Shape (rectangle is TikZ's default, so it needs no keyword). "text" is a
  // rectangle with no border/fill unless the user styles it.
  if (n.shape === "circle") opts.push("circle");
  else if (n.shape === "ellipse") opts.push("ellipse");
  else if (n.shape === "diamond") opts.push("diamond");
  // Flowchart I/O box: a trapezium with equal-and-supplementary side angles is a
  // parallelogram. `trapezium stretches` lets minimum width/height set the box.
  else if (n.shape === "parallelogram") {
    const angle = +((Math.atan2(n.h, n.w * 0.22) * 180) / Math.PI).toFixed(3);
    opts.push(
      "trapezium",
      `trapezium left angle=${angle}`,
      `trapezium right angle=${180 - angle}`,
      "trapezium stretches",
    );
  }

  const stroke = colorRef(n.stroke);
  if (stroke.name) {
    if (stroke.def) defs.add(stroke.def);
    opts.push(`draw=${stroke.name}`);
    const strokeDash = dash(n.strokeStyle);
    if (strokeDash) opts.push(strokeDash);
    opts.push(`line width=${px2cm(n.strokeWidth ?? 1)}cm`);
  }
  const fill = colorRef(n.fill);
  if (fill.name) {
    if (fill.def) defs.add(fill.def);
    opts.push(`fill=${fill.name}`);
  }
  const r = n.radius ?? (n.shape === "roundrect" ? 6 : 0);
  if (r > 0 && ROUNDABLE.has(n.shape)) opts.push(`rounded corners=${px2cm(r)}cm`);

  const text = colorRef(n.textColor);
  if (text.name) {
    if (text.def) defs.add(text.def);
    opts.push(`text=${text.name}`);
  }
  const family =
    n.fontFamily === "sans"
      ? "\\sffamily"
      : n.fontFamily === "mono"
        ? "\\ttfamily"
        : "\\rmfamily";
  const size = n.fontSize ?? 10;
  opts.push(
    `font=${family}\\fontsize{${size}}{${+(size * 1.2).toFixed(1)}}\\selectfont`,
  );
  opts.push("inner sep=0pt");
  opts.push("outer sep=0pt");
  opts.push(`minimum width=${px2cm(n.w)}cm`);
  opts.push(`minimum height=${px2cm(n.h)}cm`);
  const optStr = opts.length ? `[${opts.join(", ")}] ` : "";
  return `\\node (${n.id}) at (${c.x},${c.y}) ${optStr}{${n.label}};`;
}

const ARROW_OPT: Record<DiagEdge["arrow"], string> = {
  none: "",
  forward: "->",
  both: "<->",
};

function handlePoint(node: DiagNode, handle: DiagramHandle): DiagramPoint {
  if (handle === "t") return { x: node.x + node.w / 2, y: node.y };
  if (handle === "r") return { x: node.x + node.w, y: node.y + node.h / 2 };
  if (handle === "b") return { x: node.x + node.w / 2, y: node.y + node.h };
  return { x: node.x, y: node.y + node.h / 2 };
}

function pointToTikz(point: DiagramPoint): string {
  return `(${px2cm(point.x)},${px2cm(-point.y)})`;
}

function edgeToTikz(e: DiagEdge, nodes: Map<string, DiagNode>): string {
  const opts: string[] = [];
  const a = ARROW_OPT[e.arrow];
  if (a) opts.push(a);
  const edgeDash = dash(e.style);
  if (edgeDash) opts.push(edgeDash);
  opts.push(`line width=${px2cm(1)}cm`);
  const sourceHandle = (e.sourceHandle ?? "b") as DiagramHandle;
  const targetHandle = (e.targetHandle ?? "t") as DiagramHandle;
  if (e.routing === "orthogonal") opts.push(`rounded corners=${px2cm(5)}cm`);
  const optStr = opts.length ? `[${opts.join(", ")}]` : "";
  const anchor: Record<string, string> = {
    t: "north",
    r: "east",
    b: "south",
    l: "west",
  };
  const sourceAnchor = anchor[sourceHandle];
  const targetAnchor = anchor[targetHandle];
  const source = `${e.source}.${sourceAnchor}`;
  const target = `${e.target}.${targetAnchor}`;
  const angle: Record<string, number> = { t: 90, r: 0, b: -90, l: 180 };
  if (e.routing === "orthogonal") {
    const sourceNode = nodes.get(e.source);
    const targetNode = nodes.get(e.target);
    if (sourceNode && targetNode) {
      const route = orthogonalRoute(
        handlePoint(sourceNode, sourceHandle),
        handlePoint(targetNode, targetHandle),
        sourceHandle,
        targetHandle,
      );
      const path = route.points.map(pointToTikz).join(" -- ");
      const label = e.label
        ? `\n    \\node[fill=white, font=\\small] at ${pointToTikz(route.label)} {${e.label}};`
        : "";
      return `\\draw${optStr} ${path};${label}`;
    }
  }
  const connector =
    e.routing === "curved"
      ? `to[out=${angle[sourceHandle]}, in=${angle[targetHandle]}]`
      : "--";
  const mid = e.label ? ` node[midway, fill=white, font=\\small] {${e.label}}` : "";
  return `\\draw${optStr} (${source}) ${connector}${mid} (${target});`;
}

export const DIAGRAM_LIBS = [
  "shapes.geometric",
  "arrows.meta",
  "positioning",
  "calc",
  "backgrounds",
];

// Color defs are emitted before the tikzpicture block: \definecolor is legal
// in the surrounding body, but \node/\draw only exist inside tikzpicture.
export function modelToTikz(model: DiagramModel): string {
  const defs = new Set<string>();
  const nodes = model.nodes.map((n) => nodeToTikz(n, defs));
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const edges = model.edges.map((edge) => edgeToTikz(edge, nodesById));
  const defLines = [...defs].sort();
  const nodeBody = nodes.map((l) => `  ${l}`).join("\n");
  // Nodes must be declared before edges reference them, but edges should render
  // BEHIND the shapes (as they do on the canvas) so an arrow crossing a node is
  // hidden by it. The background layer achieves both: declare on top, draw below.
  const edgeBody = edges.length
    ? `\n  \\begin{scope}[on background layer]\n${edges.map((l) => `    ${l}`).join("\n")}\n  \\end{scope}`
    : "";
  const pre = defLines.length ? `${defLines.join("\n")}\n` : "";
  return `${pre}\\begin{tikzpicture}[>={Triangle[length=0.313cm,width=0.313cm]}]\n${nodeBody}${edgeBody}\n\\end{tikzpicture}`;
}

const MARK = "% oleafly-diagram-v1:";

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

export function serializeDiagram(model: DiagramModel): string {
  return `${modelToTikz(model)}\n${MARK} ${b64encode(model)}`;
}

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
