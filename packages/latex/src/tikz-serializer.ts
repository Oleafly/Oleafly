import type { DiagramModel, DiagNode, DiagEdge, NodeShape } from "./model";

export const PX_PER_CM = 40;

const px2cm = (v: number) => +(v / PX_PER_CM).toFixed(3);

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
    opts.push("trapezium", "trapezium left angle=70", "trapezium right angle=110", "trapezium stretches");
  }

  const stroke = colorRef(n.stroke);
  if (stroke.name) {
    if (stroke.def) defs.add(stroke.def);
    opts.push(`draw=${stroke.name}`);
    if (n.strokeStyle === "dashed") opts.push("dashed");
    else if (n.strokeStyle === "dotted") opts.push("dotted");
    if (n.strokeWidth && n.strokeWidth !== 1) opts.push(`line width=${px2cm(n.strokeWidth)}cm`);
  }
  const fill = colorRef(n.fill);
  if (fill.name) {
    if (fill.def) defs.add(fill.def);
    opts.push(`fill=${fill.name}`);
  }
  const r = n.radius ?? (n.shape === "roundrect" ? 6 : 0);
  if (r > 0 && ROUNDABLE.has(n.shape)) opts.push(`rounded corners=${r}pt`);

  const text = colorRef(n.textColor);
  if (text.name) {
    if (text.def) defs.add(text.def);
    opts.push(`text=${text.name}`);
  }
  if (n.fontSize) {
    opts.push(`font=\\fontsize{${n.fontSize}}{${+(n.fontSize * 1.2).toFixed(1)}}\\selectfont`);
  }
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

export const DIAGRAM_LIBS = ["shapes.geometric", "arrows.meta", "positioning", "calc"];

// Color defs are emitted before the tikzpicture block: \definecolor is legal
// in the surrounding body, but \node/\draw only exist inside tikzpicture.
export function modelToTikz(model: DiagramModel): string {
  const defs = new Set<string>();
  const nodes = model.nodes.map((n) => nodeToTikz(n, defs));
  const edges = model.edges.map(edgeToTikz);
  const defLines = [...defs].sort();
  const body = [...nodes, ...edges].map((l) => `  ${l}`).join("\n");
  const pre = defLines.length ? `${defLines.join("\n")}\n` : "";
  return `${pre}\\begin{tikzpicture}[>=Stealth]\n${body}\n\\end{tikzpicture}`;
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
