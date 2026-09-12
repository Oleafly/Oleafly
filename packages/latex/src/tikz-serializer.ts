import type { DiagramModel, DiagNode, DiagEdge, NodeShape } from "./model";
import {
  orthogonalRoute,
  type DiagramHandle,
  type DiagramPoint,
} from "./diagram-routing";

export const PX_PER_CM = 40;

const px2cm = (v: number) => +(v / PX_PER_CM).toFixed(3);
const DASH_PATTERNS = {
  dashed: "dash pattern=on 0.15cm off 0.1cm",
  dotted: "dash pattern=on 0.038cm off 0.1cm, line cap=round",
} as const;
const dash = (style: "solid" | "dashed" | "dotted" | undefined) =>
  style === "dashed" || style === "dotted" ? DASH_PATTERNS[style] : null;

function escapeLatex(text: string): string {
  return text.replace(/[&%#]/g, (ch) => `\\${ch}`);
}

function center(n: DiagNode): { x: number; y: number } {
  return { x: px2cm(n.x + n.w / 2), y: px2cm(-(n.y + n.h / 2)) };
}

function colorRef(hex: string | undefined): { name: string | null; def?: string } {
  if (!hex) return { name: null };
  const h = hex.replace("#", "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(h)) return { name: null };
  const name = `c${h}`;
  return { name, def: String.raw`\definecolor{${name}}{HTML}{${h}}` };
}

const ROUNDABLE = new Set<NodeShape>(["rectangle", "roundrect", "text"]);

// Shape (rectangle is TikZ's default, so it needs no keyword). "text" is a
// rectangle with no border/fill unless the user styles it.
function shapeOptions(n: DiagNode): string[] {
  if (n.shape === "circle") return ["circle"];
  if (n.shape === "ellipse") return ["ellipse"];
  if (n.shape === "diamond") return ["diamond"];
  // Flowchart I/O box: a trapezium with equal-and-supplementary side angles is a
  // parallelogram. `trapezium stretches` lets minimum width/height set the box.
  if (n.shape === "parallelogram") {
    const angle = +((Math.atan2(n.h, n.w * 0.22) * 180) / Math.PI).toFixed(3);
    return [
      "trapezium",
      `trapezium left angle=${angle}`,
      `trapezium right angle=${180 - angle}`,
      "trapezium stretches",
    ];
  }
  return [];
}

function fontFamilyMacro(fontFamily: DiagNode["fontFamily"]): string {
  if (fontFamily === "sans") return String.raw`\sffamily`;
  if (fontFamily === "mono") return String.raw`\ttfamily`;
  return String.raw`\rmfamily`;
}

function applyColor(
  opts: string[],
  defs: Set<string>,
  ref: { name: string | null; def?: string },
  option: string,
): boolean {
  if (!ref.name) return false;
  if (ref.def) defs.add(ref.def);
  opts.push(`${option}=${ref.name}`);
  return true;
}

function nodeToTikz(n: DiagNode, defs: Set<string>): string {
  const c = center(n);
  const opts: string[] = shapeOptions(n);

  if (applyColor(opts, defs, colorRef(n.stroke), "draw")) {
    const strokeDash = dash(n.strokeStyle);
    if (strokeDash) opts.push(strokeDash);
    opts.push(`line width=${px2cm(n.strokeWidth ?? 1)}cm`);
  }
  applyColor(opts, defs, colorRef(n.fill), "fill");
  const r = n.radius ?? (n.shape === "roundrect" ? 6 : 0);
  if (r > 0 && ROUNDABLE.has(n.shape)) opts.push(`rounded corners=${px2cm(r)}cm`);

  applyColor(opts, defs, colorRef(n.textColor), "text");
  const family = fontFamilyMacro(n.fontFamily);
  const size = n.fontSize ?? 10;
  opts.push(
    String.raw`font=${family}\fontsize{${size}}{${+(size * 1.2).toFixed(1)}}\selectfont`,
    "inner sep=0pt",
    "outer sep=0pt",
    `minimum width=${px2cm(n.w)}cm`,
    `minimum height=${px2cm(n.h)}cm`,
  );
  const optStr = opts.length ? `[${opts.join(", ")}] ` : "";
  return String.raw`\node (${n.id}) at (${c.x},${c.y}) ${optStr}{${escapeLatex(n.label)}};`;
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

function orthogonalPointsToTikz(points: DiagramPoint[], source: string, target: string, legacyCoordinates: boolean): string[] {
  const coordinates = points.map(pointToTikz);
  if (!legacyCoordinates) {
    coordinates[0] = `(${source})`;
    coordinates[coordinates.length - 1] = `(${target})`;
  }
  return coordinates;
}

function edgeToTikz(e: DiagEdge, nodes: Map<string, DiagNode>, sourceVersion: DiagramSourceVersion): string {
  const opts: string[] = [];
  const a = ARROW_OPT[e.arrow];
  if (a) opts.push(a);
  const edgeDash = dash(e.style);
  if (edgeDash) opts.push(edgeDash);
  opts.push(`line width=${px2cm(sourceVersion === "0.2.6" ? 1 : 2)}cm`);
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
      const points = orthogonalPointsToTikz(route.points, source, target, sourceVersion !== "current");
      const path = points.join(" -- ");
      const label = e.label
        ? `\n    \\node[fill=white, font=\\small] at ${pointToTikz(route.label)} {${escapeLatex(e.label)}};`
        : "";
      return String.raw`\draw${optStr} ${path};${label}`;
    }
  }
  const connector =
    e.routing === "curved"
      ? `to[out=${angle[sourceHandle]}, in=${angle[targetHandle]}]`
      : "--";
  const mid = e.label ? String.raw` node[midway, fill=white, font=\small] {${escapeLatex(e.label)}}` : "";
  return String.raw`\draw${optStr} (${source}) ${connector}${mid} (${target});`;
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
// An unlabeled roundrect is the "group container" convention (drawn behind a
// cluster of other shapes), so it belongs under the edges too: otherwise a
// connector that terminates inside the group renders hidden under the
// container's own fill right where it should meet its target.
function isGroupContainer(n: DiagNode): boolean {
  return n.shape === "roundrect" && !n.label;
}

export type DiagramSourceVersion = "current" | "0.3.13" | "0.2.6";

export function modelToTikz(model: DiagramModel, sourceVersion: DiagramSourceVersion = "current"): string {
  const defs = new Set<string>();
  const containerNodes = sourceVersion === "0.2.6" ? [] : model.nodes.filter(isGroupContainer);
  const regularNodes = sourceVersion === "0.2.6" ? model.nodes : model.nodes.filter((n) => !isGroupContainer(n));
  const nodes = regularNodes.map((n) => nodeToTikz(n, defs));
  const containers = containerNodes.map((n) => nodeToTikz(n, defs));
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const edges = model.edges.map((edge) => edgeToTikz(edge, nodesById, sourceVersion));
  const defLines = [...defs].sort((a, b) => Number(a > b) - Number(a < b));
  const nodeBody = nodes.map((l) => `  ${l}`).join("\n");
  const backgroundLines = [...containers, ...edges];
  const backgroundBody = backgroundLines.map((l) => `    ${l}`).join("\n");
  const edgeBody = backgroundLines.length
    ? `\n  \\begin{scope}[on background layer]\n${backgroundBody}\n  \\end{scope}`
    : "";
  const pre = defLines.length ? `${defLines.join("\n")}\n` : "";
  return `${pre}\\begin{tikzpicture}[>={Triangle[length=0.313cm,width=0.313cm]}]\n${nodeBody}${edgeBody}\n\\end{tikzpicture}`;
}

const MARK = "% oleafly-diagram-v1:";

function b64encode(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCodePoint(b);
  return btoa(bin);
}

function b64decode(b64: string): unknown {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.codePointAt(0) ?? 0);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function serializeDiagram(model: DiagramModel, sourceVersion: DiagramSourceVersion = "current"): string {
  return `${modelToTikz(model, sourceVersion)}\n${MARK} ${b64encode(model)}`;
}

export function parseEmbeddedModel(tikz: string): DiagramModel | null {
  const line = tikz.split("\n").find((l) => l.trimStart().startsWith(MARK));
  if (!line) return null;
  try {
    const b64 = line.slice(line.indexOf(MARK) + MARK.length).trim();
    const model = b64decode(b64) as DiagramModel;
    if (model?.version === 1 && Array.isArray(model.nodes)) return model;
    return null;
  } catch {
    return null;
  }
}
