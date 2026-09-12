type Direction = "TD" | "TB" | "BT" | "LR" | "RL";
type NodeShape = "box" | "rounded" | "diamond" | "circle" | "stadium";

interface MermaidNode {
  id: string;
  label: string;
  shape: NodeShape;
  order: number;
}

interface MermaidEdge {
  from: string;
  to: string;
  label: string;
  style: "solid" | "dashed" | "heavy" | "plain";
}

const EDGE_ARROWS = ["-.->", "==>", "-->", "---"] as const;
type EdgeArrow = (typeof EDGE_ARROWS)[number];

function findEdgeArrows(line: string): Array<{ index: number; value: EdgeArrow }> {
  const matches: Array<{ index: number; value: EdgeArrow }> = [];
  let cursor = 0;
  while (cursor < line.length) {
    let next: { index: number; value: EdgeArrow } | null = null;
    for (const value of EDGE_ARROWS) {
      const index = line.indexOf(value, cursor);
      if (index >= 0 && (!next || index < next.index)) next = { index, value };
    }
    if (!next) break;
    matches.push(next);
    cursor = next.index + next.value.length;
  }
  return matches;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function latexEscape(value: string): string {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "$": "\\$",
    "&": "\\&",
    "%": "\\%",
    "#": "\\#",
    "_": "\\_",
    "^": "\\textasciicircum{}",
    "~": "\\textasciitilde{}",
  };
  return Array.from(value, (character) => replacements[character] ?? character).join("");
}

function parseNode(raw: string): { id: string; label: string; shape: NodeShape } | null {
  const value = raw.trim().replace(/;$/, "");
  const idMatch = /^([A-Za-z_][\w-]*)/.exec(value);
  if (!idMatch) return null;
  const id = idMatch[1];
  const suffix = value.slice(id.length).trim();
  // Cylinders, subroutines, trapezoids, and parallelograms need Mermaid's
  // renderer. Treating them as plain boxes would silently change the diagram.
  if (/^\[(?:[/\\(]|\[)/.test(suffix) || /^\{\{/.test(suffix)) return null;
  const shapes: Array<[RegExp, NodeShape]> = [
    [/^\(\((.*)\)\)$/s, "circle"],
    [/^\{(.*)\}$/s, "diamond"],
    [/^\(\[(.*)\]\)$/s, "stadium"],
    [/^\((.*)\)$/s, "rounded"],
    [/^\[(.*)\]$/s, "box"],
  ];
  for (const [pattern, shape] of shapes) {
    const match = pattern.exec(suffix);
    if (match) return { id, label: unquote(match[1]), shape };
  }
  return suffix ? null : { id, label: id, shape: "box" };
}

function splitEdge(
  line: string,
  arrow: { index: number; value: EdgeArrow } | undefined,
): {
  left: string;
  right: string;
  label: string;
  style: MermaidEdge["style"];
} | null {
  if (!arrow) return null;
  const left = line.slice(0, arrow.index).trim();
  let right = line.slice(arrow.index + arrow.value.length).trim();
  let label = "";
  const pipeLabel = /^\|([^|]*)\|\s*(.*)$/s.exec(right);
  if (pipeLabel) {
    label = pipeLabel[1].trim();
    right = pipeLabel[2].trim();
  }
  const style =
    arrow.value === "-.->"
      ? "dashed"
      : arrow.value === "==>"
        ? "heavy"
        : arrow.value === "---"
          ? "plain"
          : "solid";
  return { left, right, label, style };
}

function coordinates(
  nodes: MermaidNode[],
  edges: MermaidEdge[],
  direction: Direction,
): Map<string, [number, number]> {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const rank = new Map<string, number>();
  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  if (queue.length === 0 && nodes[0]) queue.push(nodes[0].id);
  for (const id of queue) rank.set(id, 0);
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index];
    const nextRank = (rank.get(from) ?? 0) + 1;
    for (const to of outgoing.get(from) ?? []) {
      if (!rank.has(to)) {
        rank.set(to, nextRank);
        queue.push(to);
      }
    }
  }
  let lastRank = Math.max(0, ...rank.values());
  for (const node of nodes) {
    if (!rank.has(node.id)) rank.set(node.id, ++lastRank);
  }

  const levels = new Map<number, MermaidNode[]>();
  for (const node of nodes) {
    const level = rank.get(node.id) ?? 0;
    levels.set(level, [...(levels.get(level) ?? []), node]);
  }
  const result = new Map<string, [number, number]>();
  for (const [level, members] of levels) {
    members.sort((left, right) => left.order - right.order);
    members.forEach((node, index) => {
      const offset = index - (members.length - 1) / 2;
      if (direction === "LR" || direction === "RL") {
        const sign = direction === "RL" ? -1 : 1;
        result.set(node.id, [sign * level * 4.2, -offset * 2.4]);
      } else {
        const sign = direction === "BT" ? 1 : -1;
        result.set(node.id, [offset * 4.2, sign * level * 2.4]);
      }
    });
  }
  return result;
}

/** Convert the common Mermaid flowchart grammar into dependency-free TikZ. */
export function mermaidToTikz(source: string): string {
  if (source.length > 50_000) {
    throw new Error("This Mermaid diagram is larger than the 50,000-character limit.");
  }
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/%%.*$/, "").trim())
    .filter(Boolean);
  const header = /^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\s*;?$/i.exec(lines[0] ?? "");
  if (!header) throw new Error("Start the diagram with flowchart TD, LR, BT, or RL.");
  const direction = header[1].toUpperCase() as Direction;
  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  const addNode = (parsed: ReturnType<typeof parseNode>) => {
    if (!parsed) throw new Error("A Mermaid node could not be read.");
    const current = nodes.get(parsed.id);
    if (!current || parsed.label !== parsed.id || parsed.shape !== "box") {
      nodes.set(parsed.id, { ...parsed, order: current?.order ?? nodes.size });
    }
    return parsed.id;
  };

  for (const line of lines.slice(1)) {
    if (/^(?:subgraph|end\b|direction\b|classDef\b|class\b|style\b|linkStyle\b)/i.test(line)) {
      throw new Error("This Mermaid feature needs rendered output.");
    }
    const arrows = findEdgeArrows(line);
    if (arrows.length > 1) throw new Error("Chained Mermaid edges need rendered output.");
    const edge = splitEdge(line, arrows[0]);
    if (!edge) {
      addNode(parseNode(line));
      continue;
    }
    const from = addNode(parseNode(edge.left));
    const to = addNode(parseNode(edge.right));
    edges.push({ from, to, label: edge.label, style: edge.style });
  }
  if (nodes.size === 0) throw new Error("Add at least one node to the Mermaid flowchart.");
  if (nodes.size > 500 || edges.length > 1_000) {
    throw new Error("This flowchart is too large for editable TikZ output.");
  }

  const ordered = [...nodes.values()].sort((left, right) => left.order - right.order);
  const positions = coordinates(ordered, edges, direction);
  const names = new Map(ordered.map((node, index) => [node.id, `n${index + 1}`]));
  const nodeLines = ordered.map((node) => {
    const [x, y] = positions.get(node.id) ?? [0, 0];
    const shape =
      node.shape === "diamond"
        ? ", diamond, aspect=2"
        : node.shape === "circle"
          ? ", circle"
          : node.shape === "stadium"
            ? ", rounded rectangle, rounded rectangle arc length=180"
            : node.shape === "rounded"
              ? ", rounded corners=3pt"
              : "";
    return `  \\node[draw, align=center, inner sep=6pt${shape}] (${names.get(node.id)}) at (${x.toFixed(2)},${y.toFixed(2)}) {${latexEscape(node.label)}};`;
  });
  const edgeLines = edges.map((edge) => {
    const options =
      edge.style === "dashed"
        ? "->, dashed"
        : edge.style === "heavy"
          ? "->, very thick"
          : edge.style === "plain"
            ? "-"
            : "->";
    const label = edge.label ? ` node[midway, fill=white, inner sep=2pt] {${latexEscape(edge.label)}}` : "";
    return `  \\draw[${options}] (${names.get(edge.from)}) --${label} (${names.get(edge.to)});`;
  });

  return [
    "% Requires: \\usepackage{tikz}",
    "% The rounded-rectangle shape uses the shapes.misc library.",
    "\\usetikzlibrary{arrows.meta,shapes.geometric,shapes.misc}",
    "\\begin{tikzpicture}[>=Latex, every node/.style={font=\\small}]",
    ...nodeLines,
    ...edgeLines,
    "\\end{tikzpicture}",
  ].join("\n");
}
