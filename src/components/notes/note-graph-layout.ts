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

export interface ForceOptions {
  linkDistance: number;
  charge: number;
  gravity: number;
  theta: number;
  velocityDecay: number;
  alphaMin: number;
  alphaDecay: number;
  distanceMax: number;
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
export const MAX_TICKS = 600;
export const SLICE_MS = 12;
export const SLICE_TICKS = 4;
export const FRAME_MS = 16;
export const DRAG_ALPHA = 0.3;
export const GRAPH_LAYOUT_KEY = "oleafly.notes.graph.layout";
const SAVED_LIMIT = 20_000;
const MAX_DEPTH = 24;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const DEFAULT_FORCES: ForceOptions = {
  linkDistance: 46,
  charge: -70,
  gravity: 0.045,
  theta: 0.9,
  velocityDecay: 0.4,
  alphaMin: 0.002,
  alphaDecay: 1 - 0.002 ** (1 / 300),
  distanceMax: 1600,
};

export function noteKey(projectId: string): string {
  return `note:${projectId}`;
}

export function projectKey(projectId: string): string {
  return `project:${projectId}`;
}

export function buildGraph(input: GraphInput, options: { projects: boolean; projectColor: string }): GraphData {
  const nodes: GraphNode[] = [];
  const index = new Map<string, number>();
  for (const note of input.notes) {
    index.set(noteKey(note.id), nodes.length);
    nodes.push({
      key: noteKey(note.id),
      kind: "note",
      id: note.id,
      title: note.title,
      color: note.color,
      icon: note.icon,
      tags: note.tags ?? [],
      degree: 0,
    });
  }
  const byNoteId = new Map<string, string>();
  for (const record of input.records ?? []) if (record.noteId) byNoteId.set(record.noteId, record.projectId);
  const names = new Map(input.projects.map((project) => [project.id, project.name]));
  const pairs = new Set<string>();
  const edges: GraphEdge[] = [];
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
      let target: number | undefined;
      if (link.kind === "note") {
        const projectId = byNoteId.get(link.id);
        target = projectId === undefined ? undefined : index.get(noteKey(projectId));
      } else {
        target = index.get(noteKey(link.id)) ?? projectNode(link.id);
      }
      if (target === undefined || target === from) continue;
      const pair = from < target ? `${from}:${target}` : `${target}:${from}`;
      if (pairs.has(pair)) continue;
      pairs.add(pair);
      edges.push({ source: from, target });
      nodes[from].degree += 1;
      nodes[target].degree += 1;
    }
  }
  return { nodes, edges };
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

export function toScreen(view: View, wx: number, wy: number): [number, number] {
  return [wx * view.k + view.x, wy * view.k + view.y];
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

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storageOf(storage: Storage | undefined): Storage | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSavedPositions(storage?: Storage): Map<string, [number, number]> {
  const saved = new Map<string, [number, number]>();
  try {
    const raw = storageOf(storage)?.getItem(GRAPH_LAYOUT_KEY);
    const parsed = raw ? (JSON.parse(raw) as { version?: number; positions?: Record<string, unknown> }) : null;
    if (parsed?.version !== 1 || typeof parsed.positions !== "object" || parsed.positions === null) return saved;
    for (const [key, value] of Object.entries(parsed.positions)) {
      if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "number" && Number.isFinite(part))) {
        saved.set(key, [value[0] as number, value[1] as number]);
      }
    }
  } catch {
    return saved;
  }
  return saved;
}

export function savePositions(
  nodes: readonly Pick<GraphNode, "key">[],
  positions: Float32Array,
  previous: ReadonlyMap<string, [number, number]>,
  storage?: Storage,
): Map<string, [number, number]> {
  const merged = new Map(previous);
  const count = Math.min(nodes.length, positions.length / 2);
  for (let index = 0; index < count; index++) {
    merged.delete(nodes[index].key);
    merged.set(nodes[index].key, [Math.round(positions[index * 2] * 10) / 10, Math.round(positions[index * 2 + 1] * 10) / 10]);
  }
  const entries = [...merged.entries()].slice(-SAVED_LIMIT);
  try {
    storageOf(storage)?.setItem(GRAPH_LAYOUT_KEY, JSON.stringify({ version: 1, positions: Object.fromEntries(entries) }));
  } catch {
    return new Map(entries);
  }
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

class QuadTree {
  private capacity = 0;
  child = new Int32Array(0);
  point = new Int32Array(0);
  internal = new Uint8Array(0);
  mass = new Float64Array(0);
  sumX = new Float64Array(0);
  sumY = new Float64Array(0);
  size = new Float64Array(0);
  next: Int32Array;
  cells = 0;
  private x0 = 0;
  private y0 = 0;
  private width = 1;

  constructor(points: number) {
    this.next = new Int32Array(points);
    this.grow(Math.max(16, points * 4));
  }

  private grow(capacity: number): void {
    const copy = <T extends Int32Array | Uint8Array | Float64Array>(source: T, make: (length: number) => T, length: number): T => {
      const target = make(length);
      target.set(source.subarray(0, Math.min(source.length, length)));
      return target;
    };
    this.child = copy(this.child, (length) => new Int32Array(length), capacity * 4);
    this.point = copy(this.point, (length) => new Int32Array(length), capacity);
    this.internal = copy(this.internal, (length) => new Uint8Array(length), capacity);
    this.mass = copy(this.mass, (length) => new Float64Array(length), capacity);
    this.sumX = copy(this.sumX, (length) => new Float64Array(length), capacity);
    this.sumY = copy(this.sumY, (length) => new Float64Array(length), capacity);
    this.size = copy(this.size, (length) => new Float64Array(length), capacity);
    this.capacity = capacity;
  }

  private cell(size: number): number {
    if (this.cells === this.capacity) this.grow(this.capacity * 2);
    const cell = this.cells++;
    this.child.fill(-1, cell * 4, cell * 4 + 4);
    this.point[cell] = -1;
    this.internal[cell] = 0;
    this.mass[cell] = 0;
    this.sumX[cell] = 0;
    this.sumY[cell] = 0;
    this.size[cell] = size;
    return cell;
  }

  build(x: Float64Array, y: Float64Array, count: number): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < count; index++) {
      minX = Math.min(minX, x[index]);
      maxX = Math.max(maxX, x[index]);
      minY = Math.min(minY, y[index]);
      maxY = Math.max(maxY, y[index]);
    }
    this.width = Math.max(1, maxX - minX, maxY - minY) * 1.0001;
    this.x0 = minX;
    this.y0 = minY;
    this.cells = 0;
    this.cell(this.width);
    for (let index = 0; index < count; index++) this.insert(x, y, index);
  }

  private insert(x: Float64Array, y: Float64Array, index: number): void {
    const px = x[index];
    const py = y[index];
    let cell = 0;
    let left = this.x0;
    let top = this.y0;
    let size = this.width;
    let depth = 0;
    for (;;) {
      this.mass[cell] += 1;
      this.sumX[cell] += px;
      this.sumY[cell] += py;
      if (this.internal[cell] === 0) {
        const resident = this.point[cell];
        if (resident < 0) {
          this.point[cell] = index;
          this.next[index] = -1;
          return;
        }
        if (depth >= MAX_DEPTH || (x[resident] === px && y[resident] === py)) {
          this.next[index] = this.next[resident];
          this.next[resident] = index;
          return;
        }
        this.point[cell] = -1;
        this.internal[cell] = 1;
        const half = size / 2;
        const quadrant = (y[resident] >= top + half ? 2 : 0) + (x[resident] >= left + half ? 1 : 0);
        const moved = this.cell(half);
        this.child[cell * 4 + quadrant] = moved;
        this.point[moved] = resident;
        this.mass[moved] = this.mass[cell] - 1;
        this.sumX[moved] = this.sumX[cell] - px;
        this.sumY[moved] = this.sumY[cell] - py;
      }
      const half = size / 2;
      const right = px >= left + half;
      const bottom = py >= top + half;
      if (right) left += half;
      if (bottom) top += half;
      size = half;
      depth += 1;
      const slot = cell * 4 + (bottom ? 2 : 0) + (right ? 1 : 0);
      let next = this.child[slot];
      if (next < 0) {
        next = this.cell(size);
        this.child[slot] = next;
      }
      cell = next;
    }
  }
}

function jiggle(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return (value - Math.floor(value) - 0.5) * 1e-6;
}

export class Simulation {
  readonly count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly fixed: Uint8Array;
  private readonly fx: Float64Array;
  private readonly fy: Float64Array;
  private readonly sources: Uint32Array;
  private readonly targets: Uint32Array;
  private readonly bias: Float64Array;
  private readonly strength: Float64Array;
  private readonly tree: QuadTree;
  private readonly options: ForceOptions;
  private stack: Int32Array;
  alpha: number;
  alphaTarget = 0;

  constructor(count: number, edges: Uint32Array, initial: Float32Array | null, options: ForceOptions = DEFAULT_FORCES) {
    this.count = count;
    this.options = options;
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);
    this.fixed = new Uint8Array(count);
    this.fx = new Float64Array(count);
    this.fy = new Float64Array(count);
    const links = Math.floor(edges.length / 2);
    this.sources = new Uint32Array(links);
    this.targets = new Uint32Array(links);
    const degree = new Uint32Array(count);
    let used = 0;
    for (let link = 0; link < links; link++) {
      const source = edges[link * 2];
      const target = edges[link * 2 + 1];
      if (source >= count || target >= count || source === target) continue;
      this.sources[used] = source;
      this.targets[used] = target;
      degree[source] += 1;
      degree[target] += 1;
      used += 1;
    }
    this.bias = new Float64Array(used);
    this.strength = new Float64Array(used);
    for (let link = 0; link < used; link++) {
      const source = degree[this.sources[link]];
      const target = degree[this.targets[link]];
      this.bias[link] = source / (source + target);
      this.strength[link] = 1 / Math.min(source, target);
    }
    this.sourcesUsed = used;
    const known = this.place(initial);
    this.alpha = count === 0 ? 0 : known === count ? 0.25 : known > 0 ? 0.6 : 1;
    this.tree = new QuadTree(count);
    this.stack = new Int32Array(16);
  }

  private readonly sourcesUsed: number;

  private place(initial: Float32Array | null): number {
    let known = 0;
    const has = new Uint8Array(this.count);
    for (let index = 0; index < this.count; index++) {
      const x = initial?.[index * 2];
      const y = initial?.[index * 2 + 1];
      if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) {
        this.x[index] = x;
        this.y[index] = y;
        has[index] = 1;
        known += 1;
      }
    }
    const sumX = new Float64Array(this.count);
    const sumY = new Float64Array(this.count);
    const seen = new Uint32Array(this.count);
    for (let link = 0; link < this.sourcesUsed; link++) {
      const source = this.sources[link];
      const target = this.targets[link];
      if (has[source] && !has[target]) {
        sumX[target] += this.x[source];
        sumY[target] += this.y[source];
        seen[target] += 1;
      }
      if (has[target] && !has[source]) {
        sumX[source] += this.x[target];
        sumY[source] += this.y[target];
        seen[source] += 1;
      }
    }
    let spiral = 0;
    for (let index = 0; index < this.count; index++) {
      if (has[index]) continue;
      if (seen[index] > 0) {
        const angle = index * GOLDEN_ANGLE;
        const radius = this.options.linkDistance * 0.5;
        this.x[index] = sumX[index] / seen[index] + Math.cos(angle) * radius;
        this.y[index] = sumY[index] / seen[index] + Math.sin(angle) * radius;
        continue;
      }
      const radius = 10 * Math.sqrt(0.5 + spiral + known);
      const angle = (spiral + known) * GOLDEN_ANGLE;
      this.x[index] = radius * Math.cos(angle);
      this.y[index] = radius * Math.sin(angle);
      spiral += 1;
    }
    return known;
  }

  settled(): boolean {
    return this.alpha < this.options.alphaMin && this.alphaTarget === 0;
  }

  reheat(alpha: number): void {
    this.alpha = Math.max(this.alpha, alpha);
  }

  pin(index: number, x: number, y: number): void {
    if (index < 0 || index >= this.count) return;
    this.fixed[index] = 1;
    this.fx[index] = x;
    this.fy[index] = y;
    this.x[index] = x;
    this.y[index] = y;
    this.vx[index] = 0;
    this.vy[index] = 0;
  }

  unpin(index: number | null): void {
    if (index === null) this.fixed.fill(0);
    else if (index >= 0 && index < this.count) this.fixed[index] = 0;
  }

  positions(): Float32Array {
    const out = new Float32Array(this.count * 2);
    for (let index = 0; index < this.count; index++) {
      out[index * 2] = this.x[index];
      out[index * 2 + 1] = this.y[index];
    }
    return out;
  }

  tick(): void {
    const { count, x, y, vx, vy } = this;
    if (count === 0) return;
    this.alpha += (this.alphaTarget - this.alpha) * this.options.alphaDecay;
    const alpha = this.alpha;
    this.applyLinks(alpha);
    this.applyCharge(alpha);
    const gravity = this.options.gravity * alpha;
    const keep = 1 - this.options.velocityDecay;
    for (let index = 0; index < count; index++) {
      if (this.fixed[index]) {
        x[index] = this.fx[index];
        y[index] = this.fy[index];
        vx[index] = 0;
        vy[index] = 0;
        continue;
      }
      vx[index] = (vx[index] - x[index] * gravity) * keep;
      vy[index] = (vy[index] - y[index] * gravity) * keep;
      x[index] += vx[index];
      y[index] += vy[index];
    }
  }

  private applyLinks(alpha: number): void {
    const { x, y, vx, vy } = this;
    const distance = this.options.linkDistance;
    for (let link = 0; link < this.sourcesUsed; link++) {
      const source = this.sources[link];
      const target = this.targets[link];
      let dx = x[target] + vx[target] - x[source] - vx[source];
      let dy = y[target] + vy[target] - y[source] - vy[source];
      if (dx === 0) dx = jiggle(link + 1);
      if (dy === 0) dy = jiggle(link + 2);
      const length = Math.sqrt(dx * dx + dy * dy);
      const force = ((length - distance) / length) * alpha * this.strength[link];
      dx *= force;
      dy *= force;
      const bias = this.bias[link];
      vx[target] -= dx * bias;
      vy[target] -= dy * bias;
      vx[source] += dx * (1 - bias);
      vy[source] += dy * (1 - bias);
    }
  }

  private push(depth: number, cell: number): number {
    if (depth >= this.stack.length) {
      const grown = new Int32Array(this.stack.length * 2);
      grown.set(this.stack);
      this.stack = grown;
    }
    this.stack[depth] = cell;
    return depth + 1;
  }

  private applyCharge(alpha: number): void {
    const { count, x, y, vx, vy, tree } = this;
    tree.build(x, y, count);
    const strength = this.options.charge * alpha;
    const theta2 = this.options.theta * this.options.theta;
    const distanceMax2 = this.options.distanceMax * this.options.distanceMax;
    for (let index = 0; index < count; index++) {
      const px = x[index];
      const py = y[index];
      let top = this.push(0, 0);
      while (top > 0) {
        top -= 1;
        const cell = this.stack[top];
        const mass = tree.mass[cell];
        if (tree.internal[cell]) {
          const dx = tree.sumX[cell] / mass - px;
          const dy = tree.sumY[cell] / mass - py;
          const distance = dx * dx + dy * dy;
          const width = tree.size[cell];
          if ((width * width) / theta2 < distance) {
            if (distance < distanceMax2) {
              const force = (strength * mass) / Math.max(distance, 1);
              vx[index] += dx * force;
              vy[index] += dy * force;
            }
            continue;
          }
          for (let quadrant = 0; quadrant < 4; quadrant++) {
            const child = tree.child[cell * 4 + quadrant];
            if (child >= 0) top = this.push(top, child);
          }
          continue;
        }
        for (let other = tree.point[cell]; other >= 0; other = tree.next[other]) {
          if (other === index) continue;
          let dx = x[other] - px;
          let dy = y[other] - py;
          if (dx === 0) dx = jiggle(index * 31 + other);
          if (dy === 0) dy = jiggle(index * 17 + other);
          let distance = dx * dx + dy * dy;
          if (distance >= distanceMax2) continue;
          if (distance < 1) distance = Math.sqrt(distance);
          const force = strength / distance;
          vx[index] += dx * force;
          vy[index] += dy * force;
        }
      }
    }
  }
}

export interface LayoutEngine {
  handle(request: LayoutRequest): void;
}

export function createLayoutEngine(
  post: (update: LayoutUpdate) => void,
  timer: LayoutTimer,
  now: () => number = () => performance.now(),
  options: ForceOptions = DEFAULT_FORCES,
): LayoutEngine {
  let simulation: Simulation | null = null;
  let generation = 0;
  let animate = true;
  let handle: unknown = null;
  let ticks = 0;

  const cancel = () => {
    if (handle === null) return;
    timer.clear(handle);
    handle = null;
  };
  const emit = (current: Simulation, settled: boolean) => {
    post({ type: "positions", generation, positions: current.positions(), settled });
  };
  const run = () => {
    handle = null;
    const current = simulation;
    if (!current) return;
    const started = now();
    let slice = 0;
    do {
      current.tick();
      ticks += 1;
      slice += 1;
    } while (!current.settled() && ticks < MAX_TICKS && (!animate || (slice < SLICE_TICKS && now() - started < SLICE_MS)));
    const settled = current.settled() || ticks >= MAX_TICKS;
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
        simulation = null;
        return;
      }
      if (request.type === "start") {
        cancel();
        generation = request.generation;
        animate = request.animate;
        ticks = 0;
        simulation = new Simulation(request.count, request.edges, request.positions, options);
        emit(simulation, simulation.count === 0);
        if (simulation.count > 0) schedule();
        return;
      }
      const current = simulation;
      if (!current || request.generation !== generation) return;
      if (request.type === "pin") {
        current.pin(request.index, request.x, request.y);
        if (!animate) {
          emit(current, true);
          return;
        }
        ticks = 0;
        current.reheat(0.05);
        schedule();
        return;
      }
      if (request.type === "unpin") {
        current.unpin(request.index);
        if (!animate) return;
        ticks = 0;
        current.reheat(DRAG_ALPHA);
        schedule();
        return;
      }
      if (!animate) return;
      current.alphaTarget = request.active ? DRAG_ALPHA : 0;
      ticks = 0;
      schedule();
    },
  };
}
