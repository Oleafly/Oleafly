import { edgeDirection, normalWeights, pairBeside, reorder, spliceBeside, type Direction, type Edge } from "./tree";

export type { Direction } from "./tree";
export type DropZone = "center" | Edge;
export type Presentation = "tabs" | "icons";
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
  presentation?: Presentation;
  hidden?: boolean;
}

export type LayoutNode = SplitNode | GroupNode;

export interface ViewState {
  type: string;
  params?: { [key: string]: JsonValue };
}

export interface StackState {
  title?: string;
  icon?: string;
  sections: string[];
  collapsed: string[];
  weights: number[];
}

export interface WorkspaceLayout {
  schema: 1 | 2;
  root: LayoutNode;
  views: Record<string, ViewState>;
  stacks?: Record<string, StackState>;
  maximized: string | null;
  stage?: string | null;
}

export interface DropTarget {
  groupId: string;
  zone: DropZone;
  index?: number;
}

export interface StackTarget {
  stackId: string;
  index?: number;
}

export type MoveTarget = DropTarget | StackTarget;

export interface Container {
  groupId: string;
  stackId: string | null;
  index: number;
}

export interface GroupOptions {
  presentation?: Presentation;
  hidden?: boolean;
}

export interface StackOptions {
  title?: string;
  icon?: string;
  collapsed?: readonly string[];
  weights?: readonly number[];
}

export const MIN_WEIGHT = 0.08;
const EDGE_SHARE = 0.5;
const GONE = "\u0000gone";

function own(record: object, key: string): boolean {
  return Object.hasOwn(record, key);
}

function stacksOf(layout: WorkspaceLayout): Record<string, StackState> {
  return layout.stacks ?? {};
}

function idNumbers(node: LayoutNode, into: number[]): number[] {
  const match = /^[gs](\d+)$/u.exec(node.id);
  if (match) into.push(Number(match[1]));
  if (node.kind === "split") for (const child of node.children) idNumbers(child, into);
  return into;
}

export function nextId(root: LayoutNode, prefix: "g" | "s"): string {
  return `${prefix}${Math.max(0, ...idNumbers(root, [])) + 1}`;
}

export function newStackId(layout: WorkspaceLayout): string {
  const stacks = stacksOf(layout);
  let number = 1;
  while (own(layout.views, `stack-${number}`) || own(stacks, `stack-${number}`)) number += 1;
  return `stack-${number}`;
}

function withFlags(node: GroupNode, views: string[], active: string | null, presentation: Presentation | undefined, hidden: boolean | undefined): GroupNode {
  const next: GroupNode = { kind: "group", id: node.id, views, active };
  if (presentation === "icons") next.presentation = "icons";
  if (hidden === true) next.hidden = true;
  return next;
}

export function group(
  id: string,
  views: readonly string[],
  active: string | null = views[0] ?? null,
  options: GroupOptions = {},
): GroupNode {
  const chosen = active !== null && views.includes(active) ? active : (views[0] ?? null);
  return withFlags({ kind: "group", id, views: [], active: null }, [...views], chosen, options.presentation, options.hidden);
}

export function split(id: string, direction: Direction, children: readonly LayoutNode[], weights?: readonly number[]): SplitNode {
  return { kind: "split", id, direction, children: [...children], weights: normalWeights(weights ?? children.map(() => 1), children.length) };
}

export function stack(sections: readonly string[], options: StackOptions = {}): StackState {
  const folded = new Set(options.collapsed ?? []);
  const result: StackState = {
    sections: [...sections],
    collapsed: sections.filter((id) => folded.has(id)),
    weights: normalWeights(options.weights ?? [], sections.length),
  };
  if (options.title !== undefined) result.title = options.title;
  if (options.icon !== undefined) result.icon = options.icon;
  return result;
}

export function createLayout(
  root: LayoutNode,
  views: Record<string, ViewState>,
  stage: string | null = null,
  stacks: Record<string, StackState> = {},
): WorkspaceLayout {
  return normalize({ schema: 2, root, views: { ...views }, stacks: { ...stacks }, maximized: null, stage });
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

function findGroup(node: LayoutNode, id: string): GroupNode | null {
  const found = findNode(node, id);
  return found?.kind === "group" ? found : null;
}

export function stackOf(layout: WorkspaceLayout, id: string): StackState | null {
  const stacks = stacksOf(layout);
  return own(stacks, id) && !own(layout.views, id) ? stacks[id] : null;
}

export function isStack(layout: WorkspaceLayout, id: string): boolean {
  return stackOf(layout, id) !== null;
}

export function containerOf(layout: WorkspaceLayout, id: string): Container | null {
  const groups = groupsOf(layout.root);
  for (const candidate of groups) {
    const index = candidate.views.indexOf(id);
    if (index >= 0) return { groupId: candidate.id, stackId: null, index };
  }
  for (const candidate of groups) {
    for (const entry of candidate.views) {
      const index = stackOf(layout, entry)?.sections.indexOf(id) ?? -1;
      if (index >= 0) return { groupId: candidate.id, stackId: entry, index };
    }
  }
  return null;
}

export function groupOfView(layout: WorkspaceLayout, viewId: string): GroupNode | null {
  const place = containerOf(layout, viewId);
  return place ? findGroup(layout.root, place.groupId) : null;
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

function sameList(left: readonly unknown[], right: readonly unknown[] | undefined): boolean {
  return right !== undefined && left.length === right.length && left.every((value, index) => value === right[index]);
}

function cleanStack(candidate: StackState, views: Record<string, ViewState>, seen: Set<string>): StackState | null {
  const raw = Array.isArray(candidate.sections) ? candidate.sections : [];
  const sections: string[] = [];
  const weights: (number | undefined)[] = [];
  raw.forEach((id, index) => {
    if (typeof id !== "string" || !own(views, id) || seen.has(id)) return;
    seen.add(id);
    sections.push(id);
    weights.push(candidate.weights?.[index]);
  });
  if (sections.length === 0) return null;
  const folded = new Set(Array.isArray(candidate.collapsed) ? candidate.collapsed : []);
  const collapsed = sections.filter((id) => folded.has(id));
  const normal = normalWeights(weights, sections.length);
  const title = typeof candidate.title === "string" ? candidate.title : undefined;
  const icon = typeof candidate.icon === "string" ? candidate.icon : undefined;
  if (
    sameList(sections, raw) &&
    sameList(collapsed, candidate.collapsed) &&
    sameList(normal, candidate.weights) &&
    title === candidate.title &&
    icon === candidate.icon
  ) {
    return candidate;
  }
  const result: StackState = { sections, collapsed, weights: normal };
  if (title !== undefined) result.title = title;
  if (icon !== undefined) result.icon = icon;
  return result;
}

function tidyGroup(node: GroupNode, views: string[]): GroupNode {
  const presentation = node.presentation === "icons" ? "icons" : undefined;
  const hidden = node.hidden === true ? true : undefined;
  if (views === node.views && node.presentation === presentation && node.hidden === hidden) return node;
  return withFlags(node, views, node.active, presentation, hidden);
}

export function normalize(layout: WorkspaceLayout): WorkspaceLayout {
  const allStacks = stacksOf(layout);
  const seen = new Set<string>();
  const claimed = new Set<string>();
  const kept: Record<string, StackState> = {};
  const pruned = mapNode(layout.root, (node) => {
    if (node.kind !== "group") return node;
    const views = node.views.filter((entry) => {
      if (own(layout.views, entry)) {
        if (seen.has(entry)) return false;
        seen.add(entry);
        return true;
      }
      if (!own(allStacks, entry) || claimed.has(entry)) return false;
      claimed.add(entry);
      const cleaned = cleanStack(allStacks[entry], layout.views, seen);
      if (!cleaned) return false;
      kept[entry] = cleaned;
      return true;
    });
    return tidyGroup(node, views.length === node.views.length ? node.views : views);
  });
  const wantedStage = layout.stage ?? null;
  const root = cleanNode(pruned, true, wantedStage) ?? group("g1", []);
  const views: Record<string, ViewState> = {};
  for (const id of seen) views[id] = layout.views[id];
  const maximizedNode = layout.maximized === null ? null : findGroup(root, layout.maximized);
  const maximized = maximizedNode && maximizedNode.hidden !== true ? layout.maximized : null;
  const stage = wantedStage !== null && findGroup(root, wantedStage) ? wantedStage : null;
  const modern = Object.keys(kept).length > 0 || groupsOf(root).some((candidate) => candidate.presentation !== undefined || candidate.hidden !== undefined);
  const base: WorkspaceLayout = modern ? { schema: 2, root, views, stacks: kept, maximized } : { schema: 1, root, views, maximized };
  return stage === null ? base : { ...base, stage };
}

function updateGroup(layout: WorkspaceLayout, groupId: string, change: (group: GroupNode) => GroupNode): WorkspaceLayout {
  return {
    ...layout,
    root: mapNode(layout.root, (node) => (node.kind === "group" && node.id === groupId ? change(node) : node)),
  };
}

function updateStack(layout: WorkspaceLayout, stackId: string, change: (stack: StackState) => StackState): WorkspaceLayout {
  return { ...layout, stacks: { ...stacksOf(layout), [stackId]: change(stacksOf(layout)[stackId]) } };
}

export function activate(layout: WorkspaceLayout, viewId: string): WorkspaceLayout {
  const place = containerOf(layout, viewId);
  if (!place) return layout;
  const entry = place.stackId ?? viewId;
  const owner = findGroup(layout.root, place.groupId);
  if (!owner || owner.active === entry) return layout;
  return updateGroup(layout, owner.id, (current) => ({ ...current, active: entry }));
}

function neighbour(entries: readonly string[], index: number): string | null {
  for (let at = index + 1; at < entries.length; at += 1) if (entries[at] !== GONE) return entries[at];
  for (let at = index - 1; at >= 0; at -= 1) if (entries[at] !== GONE) return entries[at];
  return null;
}

function detach(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  const place = containerOf(layout, id);
  if (!place) return layout;
  if (place.stackId === null) {
    return updateGroup(layout, place.groupId, (current) => {
      const views = [...current.views];
      views[place.index] = GONE;
      return { ...current, views, active: current.active === id ? neighbour(views, place.index) : current.active };
    });
  }
  const stackId = place.stackId;
  const next = updateStack(layout, stackId, (current) => {
    const sections = [...current.sections];
    sections[place.index] = GONE;
    return { ...current, sections };
  });
  if (stacksOf(next)[stackId].sections.some((section) => section !== GONE)) return next;
  return updateGroup(next, place.groupId, (current) =>
    current.active === stackId ? { ...current, active: neighbour(current.views, current.views.indexOf(stackId)) } : current,
  );
}

function unmaximizeFor(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  if (layout.maximized === null) return layout;
  return containerOf(layout, id)?.groupId === layout.maximized ? layout : { ...layout, maximized: null };
}

export function closeView(layout: WorkspaceLayout, viewId: string): WorkspaceLayout {
  if (own(layout.views, viewId)) {
    const removed = detach(layout, viewId);
    const views = { ...removed.views };
    delete views[viewId];
    return normalize({ ...removed, views });
  }
  const holder = stackOf(layout, viewId);
  if (!holder) return layout;
  const removed = detach(layout, viewId);
  const views = { ...removed.views };
  for (const id of holder.sections) delete views[id];
  const stacks = { ...stacksOf(removed) };
  delete stacks[viewId];
  return normalize({ ...removed, views, stacks });
}

export function closeGroup(layout: WorkspaceLayout, groupId: string, prefer?: (group: GroupNode) => boolean): WorkspaceLayout {
  const groups = groupsOf(layout.root);
  const closing = groups.find((candidate) => candidate.id === groupId);
  if (!closing || groups.length < 2) return layout;
  const rest = groups.filter((candidate) => candidate !== closing);
  const views = { ...layout.views };
  for (const id of closing.views) {
    delete views[id];
    for (const section of stackOf(layout, id)?.sections ?? []) delete views[section];
  }
  const stage = layout.stage === groupId ? (rest.find((candidate) => prefer?.(candidate) === true) ?? rest[0]).id : (layout.stage ?? null);
  const root = mapNode(layout.root, (node) => (node === closing ? { ...closing, views: [], active: null } : node));
  return normalize({ ...layout, root, views, stage });
}

function insertBeside(node: LayoutNode, targetId: string, added: GroupNode, zone: Edge, share: number, splitId: string): LayoutNode {
  const direction = edgeDirection(zone);
  if (node.kind === "split") {
    const index = node.children.findIndex((child) => child.id === targetId);
    if (index >= 0 && node.direction === direction) return { ...node, ...spliceBeside<LayoutNode>(node.children, node.weights, index, added, zone, share) };
    return { ...node, children: node.children.map((child) => insertBeside(child, targetId, added, zone, share, splitId)) };
  }
  if (node.id !== targetId) return node;
  const pair = pairBeside<LayoutNode>(node, added, zone, share);
  return split(splitId, direction, pair.children, pair.weights);
}

function clampIndex(index: number | undefined, length: number): number {
  return Math.max(0, Math.min(index ?? length, length));
}

function placeInGroup(layout: WorkspaceLayout, entry: string, target: DropTarget, share: number): WorkspaceLayout {
  const destination = findGroup(layout.root, target.groupId);
  if (!destination) return layout;
  if (target.zone === "center") {
    return updateGroup(layout, destination.id, (current) => {
      const views = [...current.views];
      views.splice(clampIndex(target.index, views.length), 0, entry);
      return { ...current, views, active: entry };
    });
  }
  const added = group(nextId(layout.root, "g"), [entry]);
  const root = insertBeside(layout.root, destination.id, added, target.zone, share, nextId(layout.root, "s"));
  return { ...layout, root };
}

interface Carried {
  collapsed: ReadonlySet<string>;
  weights: readonly number[];
}

function placeInStack(layout: WorkspaceLayout, stackId: string, ids: readonly string[], index: number | undefined, carried?: Carried): WorkspaceLayout {
  const placed = updateStack(layout, stackId, (current) => {
    const weights = current.sections.map((_, at) => current.weights[at] ?? 0);
    const live = current.sections.flatMap((id, at) => (id === GONE ? [] : [weights[at]]));
    const mean = live.length > 0 ? live.reduce((sum, value) => sum + value, 0) / live.length : 1;
    const incoming = carried ? normalWeights(carried.weights, ids.length).map((weight) => weight * ids.length * mean) : ids.map(() => mean);
    const sections = [...current.sections];
    const at = clampIndex(index, sections.length);
    sections.splice(at, 0, ...ids);
    weights.splice(at, 0, ...incoming);
    const collapsed = [...current.collapsed.filter((id) => !ids.includes(id)), ...ids.filter((id) => carried?.collapsed.has(id) === true)];
    return { ...current, sections, collapsed, weights };
  });
  const home = containerOf(placed, stackId);
  return home ? updateGroup(placed, home.groupId, (current) => ({ ...current, active: stackId })) : placed;
}

function clampShare(share: number): number {
  return Math.min(1 - MIN_WEIGHT, Math.max(MIN_WEIGHT, Number.isFinite(share) ? share : EDGE_SHARE));
}

function moveIntoStack(layout: WorkspaceLayout, id: string, source: Container, target: StackTarget): WorkspaceLayout {
  const holder = stackOf(layout, target.stackId);
  const home = containerOf(layout, target.stackId);
  if (!holder || !home || home.stackId !== null || target.stackId === id) return layout;
  const moving = stackOf(layout, id);
  if (moving) {
    const carried = { collapsed: new Set(moving.collapsed), weights: moving.weights };
    const next = placeInStack(detach(layout, id), target.stackId, moving.sections, target.index, carried);
    return unmaximizeFor(normalize(next), target.stackId);
  }
  if (source.stackId === target.stackId) {
    const from = source.index;
    const wanted = clampIndex(target.index, holder.sections.length);
    const to = wanted > from ? wanted - 1 : wanted;
    if (to === from) return layout;
    return updateStack(layout, target.stackId, (current) => {
      const sections = reorder(current.sections, from, to);
      const folded = new Set(current.collapsed);
      return { ...current, sections, collapsed: sections.filter((section) => folded.has(section)), weights: reorder(current.weights, from, to) };
    });
  }
  return unmaximizeFor(normalize(placeInStack(detach(layout, id), target.stackId, [id], target.index)), id);
}

export function moveView(layout: WorkspaceLayout, viewId: string, target: MoveTarget, share = EDGE_SHARE): WorkspaceLayout {
  const source = containerOf(layout, viewId);
  if (!source) return layout;
  if ("stackId" in target) return moveIntoStack(layout, viewId, source, target);
  const destination = findGroup(layout.root, target.groupId);
  if (!destination) return layout;
  const sameGroup = source.groupId === destination.id;
  if (sameGroup && source.stackId === null) {
    if (target.zone !== "center" && destination.views.length === 1) return layout;
    if (target.zone === "center") {
      const from = source.index;
      const wanted = clampIndex(target.index, destination.views.length);
      const to = wanted > from ? wanted - 1 : wanted;
      if (to === from) return activate(layout, viewId);
      return updateGroup(layout, destination.id, (current) => ({ ...current, views: reorder(current.views, from, to), active: viewId }));
    }
  }
  if (sameGroup && source.stackId !== null && target.zone !== "center" && destination.views.length === 1 && stacksOf(layout)[source.stackId].sections.length === 1) {
    return layout;
  }
  let next = detach(layout, viewId);
  let entry = viewId;
  if (target.zone === "center" && destination.presentation === "icons" && !isStack(layout, viewId)) {
    entry = newStackId(layout);
    next = { ...next, stacks: { ...stacksOf(next), [entry]: stack([viewId]) } };
  }
  return unmaximizeFor(normalize(placeInGroup(next, entry, target, clampShare(share))), viewId);
}

export function createStack(
  layout: WorkspaceLayout,
  viewIds: readonly string[],
  target: DropTarget,
  options: StackOptions & { id?: string; share?: number } = {},
): WorkspaceLayout {
  const ids = [...new Set(viewIds)].filter((id) => own(layout.views, id));
  const id = options.id ?? newStackId(layout);
  if (ids.length === 0 || !findGroup(layout.root, target.groupId) || own(layout.views, id) || own(stacksOf(layout), id)) return layout;
  let next = layout;
  for (const viewId of ids) next = detach(next, viewId);
  next = { ...next, stacks: { ...stacksOf(next), [id]: stack(ids, options) } };
  return unmaximizeFor(normalize(placeInGroup(next, id, target, clampShare(options.share ?? EDGE_SHARE))), id);
}

export function toggleSection(layout: WorkspaceLayout, stackId: string, viewId: string, collapsed?: boolean): WorkspaceLayout {
  const holder = stackOf(layout, stackId);
  if (!holder || !holder.sections.includes(viewId)) return layout;
  const folded = holder.collapsed.includes(viewId);
  const want = collapsed ?? !folded;
  if (want === folded) return layout;
  return updateStack(layout, stackId, (current) => ({
    ...current,
    collapsed: current.sections.filter((section) => (section === viewId ? want : current.collapsed.includes(section))),
  }));
}

export function resizeSections(layout: WorkspaceLayout, stackId: string, weights: readonly number[]): WorkspaceLayout {
  const holder = stackOf(layout, stackId);
  if (!holder || weights.length !== holder.sections.length) return layout;
  const clamped = normalWeights(
    normalWeights(weights, weights.length).map((weight) => Math.max(MIN_WEIGHT, weight)),
    weights.length,
  );
  return updateStack(layout, stackId, (current) => ({ ...current, weights: clamped }));
}

export function setGroupHidden(layout: WorkspaceLayout, groupId: string, hidden: boolean): WorkspaceLayout {
  const node = findGroup(layout.root, groupId);
  if (!node || (node.hidden === true) === hidden) return layout;
  const next = updateGroup(layout, groupId, (current) => withFlags(current, current.views, current.active, current.presentation, hidden));
  return normalize(next);
}

export function revealView(layout: WorkspaceLayout, viewId: string): WorkspaceLayout {
  const place = containerOf(layout, viewId);
  if (!place) return layout;
  let next = activate(setGroupHidden(layout, place.groupId, false), viewId);
  if (place.stackId !== null) next = toggleSection(next, place.stackId, viewId, false);
  return unmaximizeFor(next, viewId);
}

export function visibleViews(layout: WorkspaceLayout): string[] {
  const shown = (layout.maximized === null ? null : findGroup(layout.root, layout.maximized)) ?? layout.root;
  return groupsOf(shown).flatMap((candidate) => {
    if (candidate.hidden === true || candidate.active === null) return [];
    const holder = stackOf(layout, candidate.active);
    if (!holder) return [candidate.active];
    if (holder.sections.length === 1) return holder.sections;
    return holder.sections.filter((section) => !holder.collapsed.includes(section));
  });
}

export function openView(
  layout: WorkspaceLayout,
  viewId: string,
  view: ViewState,
  target: MoveTarget,
  share = EDGE_SHARE,
): WorkspaceLayout {
  if (own(layout.views, viewId) && containerOf(layout, viewId)) return revealView(layout, viewId);
  const withView = { ...layout, views: { ...layout.views, [viewId]: view } };
  const first = groupsOf(layout.root)[0].id;
  let placed: WorkspaceLayout;
  if ("stackId" in target) {
    const home = containerOf(layout, target.stackId);
    placed =
      stackOf(layout, target.stackId) && home?.stackId === null
        ? placeInStack(withView, target.stackId, [viewId], target.index)
        : placeInGroup(withView, viewId, { groupId: first, zone: "center" }, EDGE_SHARE);
  } else {
    const destination = findGroup(layout.root, target.groupId) ? target : { ...target, groupId: first };
    placed = placeInGroup(withView, viewId, destination, clampShare(share));
  }
  return revealView(normalize(placed), viewId);
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

export function evenPair(layout: WorkspaceLayout, splitId: string, index: number, other = index + 1): WorkspaceLayout {
  const node = findNode(layout.root, splitId);
  if (!node || node.kind !== "split" || index < 0 || other <= index || other >= node.children.length) return layout;
  const weights = [...node.weights];
  const share = (weights[index] + weights[other]) / 2;
  if (weights[index] === share) return layout;
  weights[index] = share;
  weights[other] = share;
  return resizeSplit(layout, splitId, weights);
}

export function sameLayout(left: WorkspaceLayout, right: WorkspaceLayout): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function toggleMaximize(layout: WorkspaceLayout, groupId: string): WorkspaceLayout {
  if (layout.maximized === groupId) return { ...layout, maximized: null };
  const node = findGroup(layout.root, groupId);
  if (!node || node.hidden === true) return layout;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseNode(value: unknown, depth: number): LayoutNode | null {
  if (depth > 32 || typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id === "") return null;
  if (record.kind === "group") {
    if (!isStringList(record.views)) return null;
    const { presentation, hidden } = record;
    if (presentation !== undefined && presentation !== "tabs" && presentation !== "icons") return null;
    if (hidden !== undefined && typeof hidden !== "boolean") return null;
    const active = typeof record.active === "string" ? record.active : null;
    return group(record.id, record.views, active, { presentation: presentation as Presentation | undefined, hidden: hidden as boolean | undefined });
  }
  if (record.kind !== "split" || (record.direction !== "row" && record.direction !== "column")) return null;
  if (!Array.isArray(record.children) || !Array.isArray(record.weights)) return null;
  const children = record.children.map((child) => parseNode(child, depth + 1));
  if (children.some((child) => child === null)) return null;
  return split(record.id, record.direction, children as LayoutNode[], record.weights as number[]);
}

function parseStacks(value: unknown): Record<string, StackState> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const stacks: Record<string, StackState> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw)) return null;
    const { sections, collapsed = [], weights = [], title, icon } = raw;
    if (!isStringList(sections) || !isStringList(collapsed)) return null;
    if (!Array.isArray(weights) || !weights.every((weight) => typeof weight === "number")) return null;
    if ((title !== undefined && typeof title !== "string") || (icon !== undefined && typeof icon !== "string")) return null;
    const parsed: StackState = { sections, collapsed, weights };
    if (title !== undefined) parsed.title = title;
    if (icon !== undefined) parsed.icon = icon;
    stacks[id] = parsed;
  }
  return stacks;
}

export function parseLayout(value: unknown): WorkspaceLayout | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.schema !== 1 && record.schema !== 2) return null;
  if (typeof record.views !== "object" || record.views === null) return null;
  const root = parseNode(record.root, 0);
  if (!root) return null;
  const stacks = record.schema === 2 ? parseStacks(record.stacks) : {};
  if (!stacks) return null;
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
  return normalize({ schema: 2, root, views, stacks, maximized, stage });
}
