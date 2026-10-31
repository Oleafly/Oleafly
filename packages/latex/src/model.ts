export type NodeShape =
  | "rectangle"
  | "roundrect"
  | "circle"
  | "ellipse"
  | "diamond"
  | "parallelogram"
  | "text";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type EdgeRouting = "straight" | "orthogonal" | "curved";
export type EdgeArrow = "none" | "forward" | "both";
export type EdgeStyle = "solid" | "dashed" | "dotted";
export type DiagramFontFamily = "serif" | "sans" | "mono";

export interface DiagNode {
  id: string;
  shape: NodeShape;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  fill?: string;
  stroke?: string;
  strokeStyle?: StrokeStyle;
  strokeWidth?: number;
  textColor?: string;
  fontSize?: number;
  fontFamily?: DiagramFontFamily;
  radius?: number;
}

export interface DiagEdge {
  id: string;
  source: string;
  target: string;
  routing: EdgeRouting;
  arrow: EdgeArrow;
  style: EdgeStyle;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface DiagramModel {
  version: 1;
  nodes: DiagNode[];
  edges: DiagEdge[];
  background?: string;
}

export function emptyModel(): DiagramModel {
  return { version: 1, nodes: [], edges: [] };
}

let counter = 0;
export function newId(prefix = "n"): string {
  counter += 1;
  return `${prefix}${counter}_${crypto.randomUUID().slice(0, 5)}`;
}
