import {
  edgeDirection,
  isLeadingEdge,
  normalWeights,
  pairBeside,
  reorder,
  spliceBeside,
  type Direction,
  type Edge,
} from "@oleafly/workspace/tree";
import { create } from "zustand";
import { readString, removeKey, writeJson } from "@/lib/local-storage";

export type PaneId = "sidebar" | "editor" | "pdf" | "terminal" | "assistant";
export type SplitDirection = Direction;
export type Side = Edge;

export interface PaneLeaf {
  readonly pane: PaneId;
}

export interface PaneSplit {
  readonly direction: SplitDirection;
  readonly children: readonly PaneNode[];
  readonly sizes: readonly number[];
}

export type PaneNode = PaneLeaf | PaneSplit;

export type DropTarget =
  | { readonly kind: "pane"; readonly pane: PaneId; readonly side: Side }
  | { readonly kind: "edge"; readonly side: Side };

export type PaneShown = Readonly<Record<PaneId, boolean>>;

export const PANE_LAYOUT_KEY = "oleafly.workspace.paneLayout";
export const PANES: readonly PaneId[] = ["sidebar", "editor", "pdf", "terminal", "assistant"];

const LEGACY_GROUPS = {
  vertical: ["content-band", "terminal"],
  horizontal: ["sidebar", "editorpdf", "assistant"],
  document: ["editor", "pdf"],
} as const satisfies Record<string, readonly string[]>;

export type LegacyGroup = keyof typeof LEGACY_GROUPS;

function leaf(pane: PaneId): PaneLeaf {
  return { pane };
}

function split(direction: SplitDirection, children: readonly PaneNode[], sizes: readonly number[]): PaneSplit {
  return { direction, children, sizes };
}

export const DEFAULT_PANE_LAYOUT: PaneSplit = split(
  "column",
  [
    split("row", [leaf("sidebar"), split("row", [leaf("editor"), leaf("pdf")], [50, 50]), leaf("assistant")], [20, 52, 28]),
    leaf("terminal"),
  ],
  [72, 28],
);

export function isLeaf(node: PaneNode): node is PaneLeaf {
  return "pane" in node;
}

function isPane(value: unknown): value is PaneId {
  return typeof value === "string" && (PANES as readonly string[]).includes(value);
}

export function panesOf(node: PaneNode): PaneId[] {
  return isLeaf(node) ? [node.pane] : node.children.flatMap(panesOf);
}

function rounded(size: number): number {
  return Math.round(size * 1000) / 1000;
}

export function normalizeSizes(sizes: readonly unknown[], count: number): number[] {
  const usable =
    sizes.length === count && sizes.every((size) => typeof size === "number" && Number.isFinite(size) && size > 0);
  return normalWeights(usable ? (sizes as number[]) : [], count).map((share) => rounded(share * 100));
}

function compact(direction: SplitDirection, entries: readonly { node: PaneNode; size: unknown }[]): PaneNode | null {
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]?.node ?? null;
  return split(
    direction,
    entries.map((entry) => entry.node),
    normalizeSizes(
      entries.map((entry) => entry.size),
      entries.length,
    ),
  );
}

export function layoutKey(node: PaneNode): string {
  return isLeaf(node) ? node.pane : `${node.direction}(${node.children.map(layoutKey).join(",")})`;
}

export function isDefaultPaneLayout(layout: PaneNode): boolean {
  return layoutKey(layout) === layoutKey(DEFAULT_PANE_LAYOUT);
}

export function panelIdOf(node: PaneNode): string {
  if (isLeaf(node)) return node.pane;
  const ids = node.children.map(panelIdOf);
  if (sameSet(ids, LEGACY_GROUPS.horizontal)) return "content-band";
  if (sameSet(ids, LEGACY_GROUPS.document)) return "editorpdf";
  return `panes-${[...panesOf(node)].sort().join("-")}`;
}

function sameSet(ids: readonly string[], expected: readonly string[]): boolean {
  return ids.length === expected.length && expected.every((id) => ids.includes(id));
}

export function legacyGroupOf(node: PaneSplit): LegacyGroup | null {
  const ids = node.children.map(panelIdOf);
  for (const name of Object.keys(LEGACY_GROUPS) as LegacyGroup[]) {
    if (sameSet(ids, LEGACY_GROUPS[name])) return name;
  }
  return null;
}

export function groupNameOf(node: PaneSplit): string {
  return legacyGroupOf(node) ?? `split-${[...panesOf(node)].sort().join("-")}`;
}

export function storageOrderOf(node: PaneSplit): readonly string[] {
  const legacy = legacyGroupOf(node);
  return legacy ? LEGACY_GROUPS[legacy] : node.children.map(panelIdOf).sort();
}

export function groupDomIdOf(node: PaneSplit): string | undefined {
  const ids = node.children.map(panelIdOf);
  const legacy = legacyGroupOf(node);
  if (legacy && ids.every((id, index) => id === LEGACY_GROUPS[legacy][index])) return undefined;
  return `oleafly-panes-${groupNameOf(node)}-${ids.join("-")}`;
}

export function separatorIdOf(node: PaneSplit, rendered: readonly string[], left: string, right: string): string {
  const pair = [left, right];
  if (sameSet(pair, ["content-band", "terminal"])) return "v-terminal";
  if (sameSet(pair, ["sidebar", "editorpdf"])) return "h-tree";
  if (sameSet(pair, ["editorpdf", "assistant"])) return "h-assistant";
  if (sameSet(pair, ["editor", "pdf"])) return "h-mid";
  if (sameSet(pair, ["sidebar", "assistant"])) {
    const ids = node.children.map(panelIdOf);
    const [from, to] = [ids.indexOf(left), ids.indexOf(right)].sort((a, b) => a - b);
    const between = ids.slice((from ?? 0) + 1, to);
    return between.includes("editorpdf") && !rendered.includes("editorpdf") ? "h-tree" : "h-side-assistant";
  }
  return `sep-${[...pair].sort().join("-")}`;
}

export function nodeShown(node: PaneNode, shown: PaneShown): boolean {
  return isLeaf(node) ? shown[node.pane] : node.children.some((child) => nodeShown(child, shown));
}

export function renderedChildren(node: PaneSplit, shown: PaneShown): PaneNode[] {
  return node.children.filter((child) => (isLeaf(child) && child.pane === "terminal") || nodeShown(child, shown));
}

type Path = readonly number[];

export function pathOf(node: PaneNode, pane: PaneId, path: Path = []): Path | null {
  if (isLeaf(node)) return node.pane === pane ? path : null;
  for (const [index, child] of node.children.entries()) {
    const found = pathOf(child, pane, [...path, index]);
    if (found) return found;
  }
  return null;
}

export function parentSplitOf(layout: PaneNode, pane: PaneId): PaneSplit | null {
  const path = pathOf(layout, pane);
  if (!path || path.length === 0) return null;
  const parent = nodeAt(layout, path.slice(0, -1));
  return parent && !isLeaf(parent) ? parent : null;
}

function nodeAt(node: PaneNode, path: Path): PaneNode | null {
  let current: PaneNode | undefined = node;
  for (const index of path) {
    if (!current || isLeaf(current)) return null;
    current = current.children[index];
  }
  return current ?? null;
}

function replaceAt(node: PaneNode, path: Path, replacement: PaneNode): PaneNode {
  const [index, ...rest] = path;
  if (index === undefined || isLeaf(node)) return replacement;
  return split(
    node.direction,
    node.children.map((child, position) => (position === index ? replaceAt(child, rest, replacement) : child)),
    node.sizes,
  );
}

export function removePane(node: PaneNode, pane: PaneId): PaneNode | null {
  if (isLeaf(node)) return node.pane === pane ? null : node;
  const entries = node.children.flatMap((child, index) => {
    const kept = removePane(child, pane);
    return kept ? [{ node: kept, size: node.sizes[index] }] : [];
  });
  return compact(node.direction, entries);
}

function paired(direction: SplitDirection, target: PaneNode, inserted: PaneNode, side: Side, share: number): PaneSplit {
  const pair = pairBeside(target, inserted, side, share);
  return split(direction, pair.children, normalizeSizes(pair.weights, pair.children.length));
}

export function insertAtEdge(node: PaneNode, side: Side, inserted: PaneNode): PaneSplit {
  const direction = edgeDirection(side);
  if (!isLeaf(node) && node.direction === direction) {
    const sizes = node.sizes.map((size) => size * 0.75);
    return split(
      direction,
      isLeadingEdge(side) ? [inserted, ...node.children] : [...node.children, inserted],
      normalizeSizes(isLeadingEdge(side) ? [25, ...sizes] : [...sizes, 25], node.children.length + 1),
    );
  }
  return paired(direction, node, inserted, side, 0.25);
}

export function insertBeside(node: PaneNode, path: Path, side: Side, inserted: PaneNode): PaneNode {
  if (path.length === 0) return insertAtEdge(node, side, inserted);
  const direction = edgeDirection(side);
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1] ?? 0;
  const parent = nodeAt(node, parentPath);
  const target = nodeAt(node, path);
  if (!parent || isLeaf(parent) || !target) return node;
  if (parent.direction === direction) {
    const next = spliceBeside(parent.children, parent.sizes, index, inserted, side, 0.5);
    return replaceAt(node, parentPath, split(direction, next.children, normalizeSizes(next.weights, next.children.length)));
  }
  return replaceAt(node, path, paired(direction, target, inserted, side, 0.5));
}

function asSplit(node: PaneNode): PaneSplit {
  return isLeaf(node) ? split("row", [node], [100]) : node;
}

function moveAmongSiblings(layout: PaneSplit, parentPath: Path, from: number, to: number, side: Side): PaneSplit | null {
  const parent = nodeAt(layout, parentPath);
  if (!parent || isLeaf(parent)) return null;
  const direction = edgeDirection(side);
  if (parent.direction === direction) {
    if (!parent.children[from] || parent.sizes[from] === undefined) return null;
    const target = to > from ? to - 1 : to;
    const at = isLeadingEdge(side) ? target : target + 1;
    if (at === from) return layout;
    const moved = split(direction, reorder(parent.children, from, at), reorder(parent.sizes, from, at));
    return asSplit(replaceAt(layout, parentPath, moved));
  }
  if (parent.children.length !== 2) return null;
  const moved = parent.children[from];
  const target = parent.children[to];
  if (!moved || !target) return null;
  return asSplit(replaceAt(layout, parentPath, paired(direction, target, moved, side, 0.5)));
}

export function movePane(layout: PaneSplit, pane: PaneId, target: DropTarget): PaneSplit {
  if (target.kind === "pane" && target.pane === pane) return layout;
  const own = pathOf(layout, pane);
  if (!own) return layout;
  if (target.kind === "pane") {
    const other = pathOf(layout, target.pane);
    if (!other) return layout;
    const parentPath = own.slice(0, -1);
    if (own.length === other.length && parentPath.join() === other.slice(0, -1).join()) {
      const among = moveAmongSiblings(layout, parentPath, own[own.length - 1] ?? 0, other[other.length - 1] ?? 0, target.side);
      if (among) return among;
    }
  }
  const rest = removePane(layout, pane);
  if (!rest) return layout;
  if (target.kind === "edge") return insertAtEdge(rest, target.side, leaf(pane));
  const path = pathOf(rest, target.pane);
  if (!path) return layout;
  return asSplit(insertBeside(rest, path, target.side, leaf(pane)));
}

export function swapPanes(layout: PaneSplit, a: PaneId, b: PaneId): PaneSplit {
  const swap = (node: PaneNode): PaneNode => {
    if (!isLeaf(node)) return split(node.direction, node.children.map(swap), node.sizes);
    if (node.pane === a) return leaf(b);
    return node.pane === b ? leaf(a) : node;
  };
  return asSplit(swap(layout));
}

function documentPath(layout: PaneNode, side: Side): Path | null {
  const editor = pathOf(layout, "editor");
  const pdf = pathOf(layout, "pdf");
  if (editor && pdf) {
    const parent = editor.slice(0, -1);
    const node = nodeAt(layout, parent);
    if (
      parent.join() === pdf.slice(0, -1).join() &&
      node &&
      !isLeaf(node) &&
      sameSet(panesOf(node), ["editor", "pdf"])
    ) {
      return parent;
    }
  }
  return isLeadingEdge(side) ? (editor ?? pdf) : (pdf ?? editor);
}

const MISSING_SPOTS: Readonly<Record<PaneId, readonly (readonly [PaneId | "document", Side])[]>> = {
  editor: [
    ["pdf", "left"],
    ["sidebar", "right"],
    ["assistant", "left"],
  ],
  pdf: [
    ["editor", "right"],
    ["assistant", "left"],
    ["sidebar", "right"],
  ],
  sidebar: [
    ["document", "left"],
    ["assistant", "left"],
  ],
  assistant: [
    ["document", "right"],
    ["sidebar", "right"],
  ],
  terminal: [],
};

function placeMissing(layout: PaneNode, pane: PaneId): PaneNode {
  for (const [reference, side] of MISSING_SPOTS[pane]) {
    const path = reference === "document" ? documentPath(layout, side) : pathOf(layout, reference);
    if (path?.length === 0) return paired(edgeDirection(side), layout, leaf(pane), side, 0.2);
    if (path) return insertBeside(layout, path, side, leaf(pane));
  }
  return insertAtEdge(layout, pane === "terminal" ? "bottom" : "right", leaf(pane));
}

export function withAllPanes(layout: PaneNode): PaneSplit {
  let next = layout;
  for (const pane of ["editor", "pdf", "sidebar", "assistant", "terminal"] as const) {
    if (!pathOf(next, pane)) next = placeMissing(next, pane);
  }
  return asSplit(next);
}

function parseNode(value: unknown, seen: Set<PaneId>): PaneNode | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if ("pane" in record) {
    if (!isPane(record.pane) || seen.has(record.pane)) return null;
    seen.add(record.pane);
    return leaf(record.pane);
  }
  if ((record.direction !== "row" && record.direction !== "column") || !Array.isArray(record.children)) return null;
  const sizes: unknown[] = Array.isArray(record.sizes) ? record.sizes : [];
  const entries = record.children.flatMap((child, index) => {
    const node = parseNode(child, seen);
    return node ? [{ node, size: sizes[index] }] : [];
  });
  return compact(record.direction, entries);
}

function canonical(layout: PaneSplit): PaneSplit {
  return isDefaultPaneLayout(layout) ? DEFAULT_PANE_LAYOUT : layout;
}

export function parsePaneLayout(raw: string | null): PaneSplit {
  let value: unknown = null;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = null;
  }
  const node = parseNode(value, new Set());
  return node ? canonical(withAllPanes(node)) : DEFAULT_PANE_LAYOUT;
}

function writePaneLayout(layout: PaneSplit): void {
  if (isDefaultPaneLayout(layout)) removeKey(PANE_LAYOUT_KEY);
  else writeJson(PANE_LAYOUT_KEY, layout);
}

interface PaneLayoutState {
  layout: PaneSplit;
  setLayout: (layout: PaneSplit) => void;
  move: (pane: PaneId, target: DropTarget) => void;
  swap: (a: PaneId, b: PaneId) => void;
  reset: () => void;
}

export const usePaneLayoutStore = create<PaneLayoutState>((set, get) => ({
  layout: parsePaneLayout(readString(PANE_LAYOUT_KEY)),
  setLayout: (layout) => {
    const next = canonical(withAllPanes(layout));
    if (JSON.stringify(next) === JSON.stringify(get().layout)) return;
    writePaneLayout(next);
    set({ layout: next });
  },
  move: (pane, target) => get().setLayout(movePane(get().layout, pane, target)),
  swap: (a, b) => get().setLayout(swapPanes(get().layout, a, b)),
  reset: () => get().setLayout(DEFAULT_PANE_LAYOUT),
}));

export function paneLayoutIsDefault(): boolean {
  return isDefaultPaneLayout(usePaneLayoutStore.getState().layout);
}

export function resetPaneLayout(): void {
  usePaneLayoutStore.getState().reset();
}

export function movePaneToEdge(pane: PaneId, side: Side): void {
  usePaneLayoutStore.getState().move(pane, { kind: "edge", side });
}

export function swapEditorAndPreview(): void {
  usePaneLayoutStore.getState().swap("editor", "pdf");
}

export function paneSide(layout: PaneNode, pane: "sidebar" | "assistant"): "left" | "right" {
  const fallback = pane === "sidebar" ? "left" : "right";
  const own = pathOf(layout, pane);
  const reference = pathOf(layout, "editor") ?? pathOf(layout, "pdf");
  if (!own || !reference) return fallback;
  let depth = 0;
  while (depth < own.length && depth < reference.length && own[depth] === reference[depth]) depth += 1;
  const ancestor = nodeAt(layout, own.slice(0, depth));
  if (!ancestor || isLeaf(ancestor) || ancestor.direction !== "row") return fallback;
  return (own[depth] ?? 0) < (reference[depth] ?? 0) ? "left" : "right";
}
