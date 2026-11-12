import { forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { readJson, writeJson } from "@/lib/local-storage";
import type { NoteLinkRecord } from "@/lib/tauri";

export type GraphNodeKind = "note" | "project";

export interface GraphNode {
  key: string;
  kind: GraphNodeKind;
  id: string;
  title: string;
  color: string;
  icon?: string;
  tags: readonly string[];
  degree: number;
}

export interface GraphEdge {
  source: number;
  target: number;
}

export interface GraphData {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

export interface GraphNoteInput {
  id: string;
  title: string;
  color: string;
  icon?: string;
  tags?: readonly string[];
}

export interface GraphInput {
  notes: readonly GraphNoteInput[];
  records: readonly NoteLinkRecord[] | null;
  projects: readonly { id: string; name: string }[];
}

export interface GraphFilter {
  tag: string | null;
  orphans: boolean;
}

export interface View {
  x: number;
  y: number;
  k: number;
}

export type LayoutRequest =
  | {
      type: "start";
      generation: number;
      count: number;
      edges: Uint32Array;
      positions: Float32Array | null;
      animate: boolean;
    }
  | { type: "pin"; generation: number; index: number; x: number; y: number }
  | { type: "unpin"; generation: number; index: number | null }
  | { type: "drag"; generation: number; active: boolean }
  | { type: "stop" };

export interface LayoutUpdate {
  type: "positions";
  generation: number;
  positions: Float32Array;
  settled: boolean;
}

export interface LayoutTimer {
  set(callback: () => void): unknown;
  clear(handle: unknown): void;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
const MAX_TICKS = 600;
const SLICE_MS = 12;
const SLICE_TICKS = 4;
export const FRAME_MS = 16;
const DRAG_ALPHA = 0.3;
export const GRAPH_LAYOUT_KEY = "oleafly.notes.graph.layout";
const SAVED_LIMIT = 20_000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const LINK_DISTANCE = 46;
const ALPHA_MIN = 0.002;

export function noteKey(projectId: string): string {
  return `note:${projectId}`;
}

export function projectKey(projectId: string): string {
  return `project:${projectId}`;
}

type GraphLink = NoteLinkRecord["links"][number];

interface GraphParts {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pairs: Set<string>;
}

function linkTarget(
  link: GraphLink,
  index: ReadonlyMap<string, number>,
  byNoteId: ReadonlyMap<string, string>,
  projectNode: (id: string) => number | undefined,
): number | undefined {
  if (link.kind !== "note") return index.get(noteKey(link.id)) ?? projectNode(link.id);
  const projectId = byNoteId.get(link.id);
  return projectId === undefined ? undefined : index.get(noteKey(projectId));
}

function addEdge(parts: GraphParts, from: number, target: number): void {
  const pair = from < target ? `${from}:${target}` : `${target}:${from}`;
  if (parts.pairs.has(pair)) return;
  parts.pairs.add(pair);
  parts.edges.push({ source: from, target });
  parts.nodes[from].degree += 1;
  parts.nodes[target].degree += 1;
}

export function buildGraph(input: GraphInput, options: { projects: boolean; projectColor: string }): GraphData {
  const nodes = input.notes.map(
    (note): GraphNode => ({
      key: noteKey(note.id),
      kind: "note",
      id: note.id,
      title: note.title,
      color: note.color,
      icon: note.icon,
      tags: note.tags ?? [],
      degree: 0,
    }),
  );
  const index = new Map(nodes.map((node, at) => [node.key, at]));
  const byNoteId = new Map<string, string>();
  for (const record of input.records ?? []) if (record.noteId) byNoteId.set(record.noteId, record.projectId);
  const names = new Map(input.projects.map((project) => [project.id, project.name]));
  const parts: GraphParts = { nodes, edges: [], pairs: new Set() };
  const projectNode = (id: string): number | undefined => {
    const existing = index.get(projectKey(id));
    if (existing !== undefined) return existing;
    const title = names.get(id);
    if (!options.projects || title === undefined) return undefined;
    index.set(projectKey(id), nodes.length);
    nodes.push({ key: projectKey(id), kind: "project", id, title, color: options.projectColor, tags: [], degree: 0 });
    return nodes.length - 1;
  };
  for (const record of input.records ?? []) {
    const from = index.get(noteKey(record.projectId));
    if (from === undefined) continue;
    for (const link of record.links) {
      const target = linkTarget(link, index, byNoteId, projectNode);
      if (target !== undefined && target !== from) addEdge(parts, from, target);
    }
  }
  return { nodes, edges: parts.edges };
}

function subgraph(data: GraphData, keep: (index: number) => boolean): GraphData {
  const remap = new Int32Array(data.nodes.length).fill(-1);
  const nodes: GraphNode[] = [];
  data.nodes.forEach((node, index) => {
    if (!keep(index)) return;
    remap[index] = nodes.length;
    nodes.push({ ...node, degree: 0 });
  });
  const edges: GraphEdge[] = [];
  for (const edge of data.edges) {
    const source = remap[edge.source];
    const target = remap[edge.target];
    if (source < 0 || target < 0) continue;
    edges.push({ source, target });
    nodes[source].degree += 1;
    nodes[target].degree += 1;
  }
  return { nodes, edges };
}

function hasTag(node: GraphNode, tag: string): boolean {
  return node.tags.some((candidate) => candidate === tag || candidate.startsWith(`${tag}/`));
}

export function filterGraph(data: GraphData, filter: GraphFilter): GraphData {
  let result = data;
  if (filter.tag) {
    const tag = filter.tag.toLowerCase();
    const tagged = new Set<number>();
    data.nodes.forEach((node, index) => {
      if (node.kind === "note" && hasTag(node, tag)) tagged.add(index);
    });
    const linkedProjects = new Set<number>();
    for (const edge of data.edges) {
      for (const [from, to] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ]) {
        if (tagged.has(from) && data.nodes[to].kind === "project") linkedProjects.add(to);
      }
    }
    result = subgraph(data, (index) => tagged.has(index) || linkedProjects.has(index));
  }
  if (!filter.orphans) {
    const current = result;
    result = subgraph(current, (index) => current.nodes[index].degree > 0);
  }
  return result;
}

export function adjacency(data: GraphData): number[][] {
  const neighbours: number[][] = data.nodes.map(() => []);
  for (const edge of data.edges) {
    neighbours[edge.source].push(edge.target);
    neighbours[edge.target].push(edge.source);
  }
  return neighbours;
}

export function localGraph(data: GraphData, centerKey: string, depth: number): GraphData {
  const center = data.nodes.findIndex((node) => node.key === centerKey);
  if (center < 0) return { nodes: [], edges: [] };
  const neighbours = adjacency(data);
  const distance = new Map<number, number>([[center, 0]]);
  let frontier = [center];
  for (let step = 1; step <= depth && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const index of frontier) {
      for (const neighbour of neighbours[index]) {
        if (distance.has(neighbour)) continue;
        distance.set(neighbour, step);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return subgraph(data, (index) => distance.has(index));
}

export function graphSignature(data: GraphData): string {
  const keys = data.nodes.map((node) => node.key).join("\n");
  const edges = data.edges.map((edge) => `${edge.source}-${edge.target}`).join(",");
  return `${keys}\u0000${edges}`;
}

export function matchesQuery(node: GraphNode, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return node.title.toLocaleLowerCase().includes(needle) || node.tags.some((tag) => tag.includes(needle));
}

export function nodeRadius(node: Pick<GraphNode, "degree" | "kind">): number {
  const base = 4 + Math.sqrt(node.degree) * 2.2;
  return Math.min(node.kind === "project" ? 12 : 18, base);
}

export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

export function toWorld(view: View, px: number, py: number): [number, number] {
  return [(px - view.x) / view.k, (py - view.y) / view.k];
}

export function fitView(
  positions: Float32Array | null,
  nodes: readonly Pick<GraphNode, "degree" | "kind">[],
  width: number,
  height: number,
  padding = 48,
): View {
  const count = Math.min(nodes.length, positions ? positions.length / 2 : 0);
  if (!positions || count === 0 || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, k: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < count; index++) {
    const r = nodeRadius(nodes[index]);
    const x = positions[index * 2];
    const y = positions[index * 2 + 1];
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const k = clampZoom(Math.min(2, (width - padding * 2) / spanX, (height - padding * 2) / spanY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
}

export function hitTest(
  positions: Float32Array | null,
  nodes: readonly Pick<GraphNode, "degree" | "kind">[],
  view: View,
  px: number,
  py: number,
  slop = 4,
): number {
  if (!positions) return -1;
  const [wx, wy] = toWorld(view, px, py);
  const count = Math.min(nodes.length, positions.length / 2);
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < count; index++) {
    const dx = positions[index * 2] - wx;
    const dy = positions[index * 2 + 1] - wy;
    const reach = Math.max(nodeRadius(nodes[index]), 3 / view.k) + slop / view.k;
    const distance = dx * dx + dy * dy;
    if (distance <= reach * reach && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function savedPositions(value: unknown): Map<string, [number, number]> {
  const saved = new Map<string, [number, number]>();
  if (typeof value !== "object" || value === null) return saved;
  const { version, positions } = value as { version?: unknown; positions?: unknown };
  if (version !== 1 || typeof positions !== "object" || positions === null) return saved;
  for (const [key, point] of Object.entries(positions)) {
    if (Array.isArray(point) && point.length === 2 && point.every((part) => typeof part === "number" && Number.isFinite(part))) {
      saved.set(key, [point[0] as number, point[1] as number]);
    }
  }
  return saved;
}

export function readSavedPositions(): Map<string, [number, number]> {
  return readJson(GRAPH_LAYOUT_KEY, new Map<string, [number, number]>(), savedPositions);
}

export function savePositions(
  nodes: readonly Pick<GraphNode, "key">[],
  positions: Float32Array,
  previous: ReadonlyMap<string, [number, number]>,
): Map<string, [number, number]> {
  const merged = new Map(previous);
  const count = Math.min(nodes.length, positions.length / 2);
  for (let index = 0; index < count; index++) {
    merged.delete(nodes[index].key);
    merged.set(nodes[index].key, [Math.round(positions[index * 2] * 10) / 10, Math.round(positions[index * 2 + 1] * 10) / 10]);
  }
  const entries = [...merged.entries()].slice(-SAVED_LIMIT);
  writeJson(GRAPH_LAYOUT_KEY, { version: 1, positions: Object.fromEntries(entries) });
  return new Map(entries);
}

export function initialPositions(
  nodes: readonly Pick<GraphNode, "key">[],
  known: ReadonlyMap<string, readonly [number, number]>,
): Float32Array | null {
  const positions = new Float32Array(nodes.length * 2).fill(Number.NaN);
  let found = false;
  nodes.forEach((node, index) => {
    const position = known.get(node.key);
    if (!position) return;
    positions[index * 2] = position[0];
    positions[index * 2 + 1] = position[1];
    found = true;
  });
  return found ? positions : null;
}

export function edgeArray(edges: readonly GraphEdge[]): Uint32Array {
  const flat = new Uint32Array(edges.length * 2);
  edges.forEach((edge, index) => {
    flat[index * 2] = edge.source;
    flat[index * 2 + 1] = edge.target;
  });
  return flat;
}

interface LayoutNode extends SimulationNodeDatum {
  x: number;
  y: number;
}

interface LayoutLink {
  source: number;
  target: number;
}

interface Layout {
  simulation: Simulation<LayoutNode, undefined>;
  nodes: LayoutNode[];
}

function layoutLinks(count: number, edges: Uint32Array): LayoutLink[] {
  const links: LayoutLink[] = [];
  for (let link = 0; link + 1 < edges.length; link += 2) {
    const source = edges[link];
    const target = edges[link + 1];
    if (source < count && target < count && source !== target) links.push({ source, target });
  }
  return links;
}

function placeNodes(count: number, links: readonly LayoutLink[], initial: Float32Array | null): { nodes: LayoutNode[]; known: number } {
  const nodes: LayoutNode[] = [];
  let known = 0;
  for (let index = 0; index < count; index++) {
    const x = initial?.[index * 2] ?? Number.NaN;
    const y = initial?.[index * 2 + 1] ?? Number.NaN;
    const placed = Number.isFinite(x) && Number.isFinite(y);
    if (placed) known += 1;
    nodes.push({ x: placed ? x : Number.NaN, y: placed ? y : Number.NaN });
  }
  if (known === 0) return { nodes, known };
  const sums = new Map<number, [number, number, number]>();
  const add = (to: number, from: number) => {
    if (Number.isNaN(nodes[to].x) && !Number.isNaN(nodes[from].x)) {
      const sum = sums.get(to) ?? [0, 0, 0];
      sums.set(to, [sum[0] + nodes[from].x, sum[1] + nodes[from].y, sum[2] + 1]);
    }
  };
  for (const link of links) {
    add(link.target, link.source);
    add(link.source, link.target);
  }
  for (const [index, [sumX, sumY, seen]] of sums) {
    const angle = index * GOLDEN_ANGLE;
    nodes[index].x = sumX / seen + Math.cos(angle) * LINK_DISTANCE * 0.5;
    nodes[index].y = sumY / seen + Math.sin(angle) * LINK_DISTANCE * 0.5;
  }
  return { nodes, known };
}

function startAlpha(count: number, known: number): number {
  if (count === 0) return 0;
  if (known === count) return 0.25;
  return known > 0 ? 0.6 : 1;
}

function createLayout(count: number, edges: Uint32Array, initial: Float32Array | null): Layout {
  const links = layoutLinks(count, edges);
  const { nodes, known } = placeNodes(count, links, initial);
  const simulation = forceSimulation<LayoutNode>(nodes)
    .stop()
    .alpha(startAlpha(count, known))
    .alphaMin(ALPHA_MIN)
    .alphaDecay(1 - ALPHA_MIN ** (1 / 300))
    .force("link", forceLink<LayoutNode, SimulationLinkDatum<LayoutNode>>(links).distance(LINK_DISTANCE))
    .force("charge", forceManyBody<LayoutNode>().strength(-70).theta(0.9).distanceMax(1600))
    .force("x", forceX<LayoutNode>().strength(0.045))
    .force("y", forceY<LayoutNode>().strength(0.045));
  return { simulation, nodes };
}

function settledLayout({ simulation }: Layout): boolean {
  return simulation.alpha() < ALPHA_MIN && simulation.alphaTarget() === 0;
}

function layoutPositions({ nodes }: Layout): Float32Array {
  const out = new Float32Array(nodes.length * 2);
  nodes.forEach((node, index) => {
    out[index * 2] = node.x;
    out[index * 2 + 1] = node.y;
  });
  return out;
}

function nodeAt(nodes: LayoutNode[], index: number): LayoutNode | undefined {
  return Number.isInteger(index) && index >= 0 ? nodes.at(index) : undefined;
}

function pinNode({ nodes }: Layout, index: number, x: number, y: number): boolean {
  const node = nodeAt(nodes, index);
  if (!node) return false;
  Object.assign(node, { fx: x, fy: y, x, y, vx: 0, vy: 0 });
  return true;
}

function unpinNodes({ nodes }: Layout, index: number | null): void {
  for (const node of index === null ? nodes : [nodeAt(nodes, index)]) {
    if (!node) continue;
    node.fx = null;
    node.fy = null;
  }
}

export interface LayoutEngine {
  handle(request: LayoutRequest): void;
}

export function createLayoutEngine(
  post: (update: LayoutUpdate) => void,
  timer: LayoutTimer,
  now: () => number = () => performance.now(),
): LayoutEngine {
  let layout: Layout | null = null;
  let generation = 0;
  let animate = true;
  let handle: unknown = null;
  let ticks = 0;

  const cancel = () => {
    if (handle === null) return;
    timer.clear(handle);
    handle = null;
  };
  const emit = (current: Layout, settled: boolean) => {
    post({ type: "positions", generation, positions: layoutPositions(current), settled });
  };
  const run = () => {
    handle = null;
    const current = layout;
    if (!current) return;
    const started = now();
    let slice = 0;
    do {
      current.simulation.tick();
      ticks += 1;
      slice += 1;
    } while (!settledLayout(current) && ticks < MAX_TICKS && (!animate || (slice < SLICE_TICKS && now() - started < SLICE_MS)));
    const settled = settledLayout(current) || ticks >= MAX_TICKS;
    emit(current, settled);
    if (!settled) handle = timer.set(run);
  };
  const schedule = () => {
    if (handle === null) handle = timer.set(run);
  };

  return {
    handle(request) {
      if (request.type === "stop") {
        cancel();
        layout = null;
        return;
      }
      if (request.type === "start") {
        cancel();
        generation = request.generation;
        animate = request.animate;
        ticks = 0;
        layout = createLayout(request.count, request.edges, request.positions);
        emit(layout, request.count === 0);
        if (request.count > 0) schedule();
        return;
      }
      const current = layout;
      if (!current || request.generation !== generation) return;
      if (request.type === "pin") {
        if (!pinNode(current, request.index, request.x, request.y)) return;
        if (!animate) {
          emit(current, true);
          return;
        }
        ticks = 0;
        current.simulation.alpha(Math.max(current.simulation.alpha(), 0.05));
        schedule();
        return;
      }
      if (request.type === "unpin") {
        unpinNodes(current, request.index);
        if (!animate) return;
        ticks = 0;
        current.simulation.alpha(Math.max(current.simulation.alpha(), DRAG_ALPHA));
        schedule();
        return;
      }
      if (!animate) return;
      current.simulation.alphaTarget(request.active ? DRAG_ALPHA : 0);
      ticks = 0;
      schedule();
    },
  };
}
