export type Direction = "row" | "column";
export type DropZone = "center" | "left" | "right" | "top" | "bottom";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface SplitNode {
  kind: "split";
  id: string;
  direction: Direction;
  children: LayoutNode[];
  weights: number[];
}

export interface GroupNode {
  kind: "group";
  id: string;
  views: string[];
  active: string | null;
}

export type LayoutNode = SplitNode | GroupNode;

export interface ViewState {
  type: string;
  params?: { [key: string]: JsonValue };
}

export interface WorkspaceLayout {
  schema: 1;
  root: LayoutNode;
  views: Record<string, ViewState>;
  maximized: string | null;
  stage?: string | null;
}

export interface DropTarget {
  groupId: string;
  zone: DropZone;
  index?: number;
}

export const MIN_WEIGHT = 0.08;
const EDGE_SHARE = 0.5;

function idNumbers(node: LayoutNode, into: number[]): number[] {
  const match = /^[gs](\d+)$/u.exec(node.id);
  if (match) into.push(Number(match[1]));
  if (node.kind === "split") for (const child of node.children) idNumbers(child, into);
  return into;
}

export function nextId(root: LayoutNode, prefix: "g" | "s"): string {
  return `${prefix}${Math.max(0, ...idNumbers(root, [])) + 1}`;
}

export function group(id: string, views: readonly string[], active: string | null = views[0] ?? null): GroupNode {
  return { kind: "group", id, views: [...views], active: active !== null && views.includes(active) ? active : (views[0] ?? null) };
}

export function split(id: string, direction: Direction, children: readonly LayoutNode[], weights?: readonly number[]): SplitNode {
  return { kind: "split", id, direction, children: [...children], weights: normalWeights(weights ?? children.map(() => 1), children.length) };
}

export function createLayout(root: LayoutNode, views: Record<string, ViewState>, stage: string | null = null): WorkspaceLayout {
  return normalize({ schema: 1, root, views: { ...views }, maximized: null, stage });
}

function normalWeights(weights: readonly number[], count: number): number[] {
  const usable = Array.from({ length: count }, (_, index) => {
    const value = weights[index];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
  });
  const total = usable.reduce((sum, value) => sum + value, 0);
  return usable.map((value) => value / total);
}

export function groupsOf(node: LayoutNode): GroupNode[] {
  if (node.kind === "group") return [node];
  return node.children.flatMap(groupsOf);
}

export function findNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  if (node.kind === "group") return null;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function groupOfView(layout: WorkspaceLayout, viewId: string): GroupNode | null {
  return groupsOf(layout.root).find((candidate) => candidate.views.includes(viewId)) ?? null;
}

function mapNode(node: LayoutNode, change: (node: LayoutNode) => LayoutNode): LayoutNode {
  const next = node.kind === "split" ? { ...node, children: node.children.map((child) => mapNode(child, change)) } : node;
  return change(next);
}

function cleanNode(node: LayoutNode, isRoot: boolean, stage: string | null): LayoutNode | null {
  if (node.kind === "group") {
    if (node.views.length === 0 && !isRoot && node.id !== stage) return null;
    const active = node.active !== null && node.views.includes(node.active) ? node.active : (node.views[0] ?? null);
    return active === node.active ? node : { ...node, active };
  }
  const kept: { node: LayoutNode; weight: number }[] = [];
  let carried = 0;
  node.children.forEach((child, index) => {
    const weight = node.weights[index] ?? 0;
    const cleaned = cleanNode(child, false, stage);
    if (!cleaned) {
      if (kept.length > 0 && index === node.children.length - 1) kept[kept.length - 1].weight += weight + carried;
      else carried += weight;
      return;
    }
    kept.push({ node: cleaned, weight: weight + carried });
    carried = 0;
  });
  if (carried > 0 && kept.length > 0) kept[kept.length - 1].weight += carried;
  const children: LayoutNode[] = [];
  const weights: number[] = [];
  kept.forEach(({ node: cleaned, weight }) => {
    if (cleaned.kind === "split" && cleaned.direction === node.direction) {
      cleaned.children.forEach((grandchild, inner) => {
        children.push(grandchild);
        weights.push(weight * (cleaned.weights[inner] ?? 0));
      });
      return;
    }
    children.push(cleaned);
    weights.push(weight);
  });
  if (children.length === 0) return isRoot ? group(node.id, []) : null;
  if (children.length === 1) return children[0];
  return { ...node, children, weights: normalWeights(weights, children.length) };
}

export function normalize(layout: WorkspaceLayout): WorkspaceLayout {
  const known = new Set(Object.keys(layout.views));
  const seen = new Set<string>();
  const pruned = mapNode(layout.root, (node) => {
    if (node.kind !== "group") return node;
    const views = node.views.filter((view) => {
      if (!known.has(view) || seen.has(view)) return false;
      seen.add(view);
      return true;
    });
    return views.length === node.views.length ? node : { ...node, views };
  });
  const wantedStage = layout.stage ?? null;
  const root = cleanNode(pruned, true, wantedStage) ?? group("g1", []);
  const views: Record<string, ViewState> = {};
  for (const id of seen) views[id] = layout.views[id];
  const maximized = layout.maximized !== null && findNode(root, layout.maximized)?.kind === "group" ? layout.maximized : null;
  const stage = wantedStage !== null && findNode(root, wantedStage)?.kind === "group" ? wantedStage : null;
  return stage === null ? { schema: 1, root, views, maximized } : { schema: 1, root, views, maximized, stage };
}

function updateGroup(layout: WorkspaceLayout, groupId: string, change: (group: GroupNode) => GroupNode): WorkspaceLayout {
  return {
    ...layout,
    root: mapNode(layout.root, (node) => (node.kind === "group" && node.id === groupId ? change(node) : node)),
  };
}

export function activate(layout: WorkspaceLayout, viewId: string): WorkspaceLayout {
  const owner = groupOfView(layout, viewId);
  if (!owner || owner.active === viewId) return layout;
  return updateGroup(layout, owner.id, (current) => ({ ...current, active: viewId }));
}

function withoutView(layout: WorkspaceLayout, viewId: string): WorkspaceLayout {
  const owner = groupOfView(layout, viewId);
  if (!owner) return layout;
  return updateGroup(layout, owner.id, (current) => {
    const index = current.views.indexOf(viewId);
    const views = current.views.filter((view) => view !== viewId);
    const active = current.active === viewId ? (views[Math.min(index, views.length - 1)] ?? null) : current.active;
    return { ...current, views, active };
  });
}

export function closeView(layout: WorkspaceLayout, viewId: string): WorkspaceLayout {
  if (!(viewId in layout.views)) return layout;
  const removed = withoutView(layout, viewId);
  const views = { ...removed.views };
  delete views[viewId];
  return normalize({ ...removed, views });
}

export function closeGroup(layout: WorkspaceLayout, groupId: string, prefer?: (group: GroupNode) => boolean): WorkspaceLayout {
  const groups = groupsOf(layout.root);
  const closing = groups.find((candidate) => candidate.id === groupId);
  if (!closing || groups.length < 2) return layout;
  const rest = groups.filter((candidate) => candidate !== closing);
  const views = { ...layout.views };
  for (const id of closing.views) delete views[id];
  const stage = layout.stage === groupId ? (rest.find((candidate) => prefer?.(candidate) === true) ?? rest[0]).id : (layout.stage ?? null);
  const root = mapNode(layout.root, (node) => (node === closing ? { ...closing, views: [], active: null } : node));
  return normalize({ ...layout, root, views, stage });
}

function insertBeside(node: LayoutNode, targetId: string, added: GroupNode, zone: Exclude<DropZone, "center">, share: number, splitId: string): LayoutNode {
  const direction: Direction = zone === "left" || zone === "right" ? "row" : "column";
  const before = zone === "left" || zone === "top";
  if (node.kind === "split") {
    const index = node.children.findIndex((child) => child.id === targetId);
    if (index >= 0 && node.direction === direction) {
      const weight = node.weights[index] ?? 0;
      const children = [...node.children];
      const weights = [...node.weights];
      weights.splice(index, 1, weight * (1 - share));
      const at = before ? index : index + 1;
      children.splice(at, 0, added);
      weights.splice(at, 0, weight * share);
      return { ...node, children, weights };
    }
    return { ...node, children: node.children.map((child) => insertBeside(child, targetId, added, zone, share, splitId)) };
  }
  if (node.id !== targetId) return node;
  const children = before ? [added, node] : [node, added];
  const weights = before ? [share, 1 - share] : [1 - share, share];
  return split(splitId, direction, children, weights);
}

function placeView(layout: WorkspaceLayout, viewId: string, target: DropTarget, share: number): WorkspaceLayout {
  const destination = findNode(layout.root, target.groupId);
  if (!destination || destination.kind !== "group") return layout;
  if (target.zone === "center") {
    return updateGroup(layout, destination.id, (current) => {
      const views = [...current.views];
      const index = Math.max(0, Math.min(target.index ?? views.length, views.length));
      views.splice(index, 0, viewId);
      return { ...current, views, active: viewId };
    });
  }
  const added = group(nextId(layout.root, "g"), [viewId]);
  const root = insertBeside(layout.root, destination.id, added, target.zone, share, nextId(layout.root, "s"));
  return { ...layout, root };
}

function revealView(layout: WorkspaceLayout, viewId: string): WorkspaceLayout {
  if (layout.maximized === null) return layout;
  return groupOfView(layout, viewId)?.id === layout.maximized ? layout : { ...layout, maximized: null };
}

export function openView(
  layout: WorkspaceLayout,
  viewId: string,
  view: ViewState,
  target: DropTarget,
  share = EDGE_SHARE,
): WorkspaceLayout {
  if (viewId in layout.views && groupOfView(layout, viewId)) return revealView(activate(layout, viewId), viewId);
  const withView = { ...layout, views: { ...layout.views, [viewId]: view } };
  const destination = findNode(layout.root, target.groupId)?.kind === "group" ? target : { ...target, groupId: groupsOf(layout.root)[0].id };
  return revealView(normalize(placeView(withView, viewId, destination, clampShare(share))), viewId);
}

function clampShare(share: number): number {
  return Math.min(1 - MIN_WEIGHT, Math.max(MIN_WEIGHT, Number.isFinite(share) ? share : EDGE_SHARE));
}

export function moveView(layout: WorkspaceLayout, viewId: string, target: DropTarget, share = EDGE_SHARE): WorkspaceLayout {
  const source = groupOfView(layout, viewId);
  const destination = findNode(layout.root, target.groupId);
  if (!source || !destination || destination.kind !== "group") return layout;
  if (source.id === destination.id && target.zone !== "center" && source.views.length === 1) return layout;
  if (source.id === destination.id && target.zone === "center") {
    const from = source.views.indexOf(viewId);
    const wanted = Math.max(0, Math.min(target.index ?? source.views.length, source.views.length));
    const to = wanted > from ? wanted - 1 : wanted;
    if (to === from) return activate(layout, viewId);
    return updateGroup(layout, source.id, (current) => {
      const views = current.views.filter((view) => view !== viewId);
      views.splice(to, 0, viewId);
      return { ...current, views, active: viewId };
    });
  }
  return revealView(normalize(placeView(withoutView(layout, viewId), viewId, target, clampShare(share))), viewId);
}

export function resizeSplit(layout: WorkspaceLayout, splitId: string, weights: readonly number[]): WorkspaceLayout {
  const node = findNode(layout.root, splitId);
  if (!node || node.kind !== "split" || weights.length !== node.children.length) return layout;
  const clamped = normalWeights(
    normalWeights(weights, weights.length).map((weight) => Math.max(MIN_WEIGHT, weight)),
    weights.length,
  );
  return {
    ...layout,
    root: mapNode(layout.root, (current) => (current.kind === "split" && current.id === splitId ? { ...current, weights: clamped } : current)),
  };
}

export function evenPair(layout: WorkspaceLayout, splitId: string, index: number): WorkspaceLayout {
  const node = findNode(layout.root, splitId);
  if (!node || node.kind !== "split" || index < 0 || index >= node.children.length - 1) return layout;
  const weights = [...node.weights];
  const share = (weights[index] + weights[index + 1]) / 2;
  if (weights[index] === share) return layout;
  weights[index] = share;
  weights[index + 1] = share;
  return resizeSplit(layout, splitId, weights);
}

export function sameLayout(left: WorkspaceLayout, right: WorkspaceLayout): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function toggleMaximize(layout: WorkspaceLayout, groupId: string): WorkspaceLayout {
  if (layout.maximized === groupId) return { ...layout, maximized: null };
  if (findNode(layout.root, groupId)?.kind !== "group") return layout;
  return { ...layout, maximized: groupId };
}

function isJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 8) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1));
  if (typeof value === "object") return Object.values(value).every((item) => isJson(item, depth + 1));
  return false;
}

function parseNode(value: unknown, depth: number): LayoutNode | null {
  if (depth > 32 || typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id === "") return null;
  if (record.kind === "group") {
    if (!Array.isArray(record.views) || !record.views.every((view) => typeof view === "string")) return null;
    const active = typeof record.active === "string" ? record.active : null;
    return group(record.id, record.views as string[], active);
  }
  if (record.kind !== "split" || (record.direction !== "row" && record.direction !== "column")) return null;
  if (!Array.isArray(record.children) || !Array.isArray(record.weights)) return null;
  const children = record.children.map((child) => parseNode(child, depth + 1));
  if (children.some((child) => child === null)) return null;
  return split(record.id, record.direction, children as LayoutNode[], record.weights as number[]);
}

export function parseLayout(value: unknown): WorkspaceLayout | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.schema !== 1 || typeof record.views !== "object" || record.views === null) return null;
  const root = parseNode(record.root, 0);
  if (!root) return null;
  const views: Record<string, ViewState> = {};
  for (const [id, view] of Object.entries(record.views as Record<string, unknown>)) {
    if (typeof view !== "object" || view === null) return null;
    const { type, params } = view as Record<string, unknown>;
    if (typeof type !== "string") return null;
    if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params) || !isJson(params))) return null;
    views[id] = params === undefined ? { type } : { type, params: params as { [key: string]: JsonValue } };
  }
  const ids = new Set<string>();
  const unique = (node: LayoutNode): boolean => {
    if (ids.has(node.id)) return false;
    ids.add(node.id);
    return node.kind === "group" || node.children.every(unique);
  };
  if (!unique(root)) return null;
  const maximized = typeof record.maximized === "string" ? record.maximized : null;
  const stage = typeof record.stage === "string" ? record.stage : null;
  return normalize({ schema: 1, root, views, maximized, stage });
}
