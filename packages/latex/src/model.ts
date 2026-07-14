export type NodeShape = "rectangle" | "roundrect" | "circle" | "ellipse" | "diamond" | "text";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type EdgeRouting = "straight" | "orthogonal" | "curved";
export type EdgeArrow = "none" | "forward" | "both";
export type EdgeStyle = "solid" | "dashed";

export interface DiagNode {
  id: string;
  shape: NodeShape;
  x: number;
  y: number; // top-left in model px
  w: number;
  h: number;
  label: string;
  fill?: string; // hex "#RRGGBB" or "" for none
  stroke?: string; // hex
  strokeStyle?: StrokeStyle;
  strokeWidth?: number; // px
  textColor?: string; // hex
  fontSize?: number; // pt
  radius?: number; // corner radius in pt (rectangle/roundrect/text)
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

// Runs in the app (not a workflow), so Math.random is fine here.
let counter = 0;
export function newId(prefix = "n"): string {
  counter += 1;
  return `${prefix}${counter}_${Math.random().toString(36).slice(2, 7)}`;
}
