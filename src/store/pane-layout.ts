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
import type { ViewMode } from "@/store/settings";

export type PaneId = "sidebar" | "editor" | "pdf" | "terminal" | "assistant";
export type SplitDirection = Direction;
export type Side = Edge;

export interface PaneLeaf {
  readonly pane: PaneId;
}

export interface PaneSplit {
  readonly id: string;
  readonly direction: SplitDirection;
  readonly children: readonly PaneNode[];
  readonly sizes: readonly number[];
}

export type PaneNode = PaneLeaf | PaneSplit;

export type DropTarget =
  | { readonly kind: "pane"; readonly pane: PaneId; readonly side: Side }
  | { readonly kind: "edge"; readonly side: Side };

export type PaneShown = Readonly<Record<PaneId, boolean>>;

export interface PaneFlags {
  readonly viewMode: ViewMode;
  readonly showTree: boolean;
  readonly assistantOpen: boolean;
  readonly workspaceHidden: boolean;
  readonly terminalOpen: boolean;
}

export const PANE_LAYOUT_KEY = "oleafly.workspace.paneLayout";
const LAYOUT_VERSION = 2;
export const PANES: readonly PaneId[] = ["sidebar", "editor", "pdf", "terminal", "assistant"];

const SPLIT_PANEL_IDS: Readonly<Record<string, string>> = { horizontal: "content-band", document: "editorpdf" };
const STORAGE_RANK = ["content-band", "sidebar", "editorpdf", "editor", "pdf", "assistant", "terminal"];
const SEPARATOR_IDS: Readonly<Record<string, string>> = {
  "content-band|terminal": "v-terminal",
  "editorpdf|sidebar": "h-tree",
  "assistant|editorpdf": "h-assistant",
  "editor|pdf": "h-mid",
};
const LEGACY_SPLITS: readonly (readonly [string, readonly string[]])[] = [
  ["document", ["editor", "pdf"]],
  ["horizontal", ["sidebar", "editorpdf", "assistant"]],
  ["vertical", ["content-band", "terminal"]],
];
const SPLIT_ID = /^[a-z][a-z0-9-]{0,31}$/;

function leaf(pane: PaneId): PaneLeaf {
  return { pane };
}

function split(id: string, direction: SplitDirection, children: readonly PaneNode[], sizes: readonly number[]): PaneSplit {
  return { id, direction, children, sizes };
}

const DOCUMENT_SPLIT = split("document", "row", [leaf("editor"), leaf("pdf")], [50, 50]);
const BAND_SPLIT = split("horizontal", "row", [leaf("sidebar"), DOCUMENT_SPLIT, leaf("assistant")], [20, 52, 28]);
export const DEFAULT_PANE_LAYOUT: PaneSplit = split("vertical", "column", [BAND_SPLIT, leaf("terminal")], [72, 28]);

export function isLeaf(node: PaneNode): node is PaneLeaf {
  return "pane" in node;
}

function isPane(value: unknown): value is PaneId {
  return typeof value === "string" && (PANES as readonly string[]).includes(value);
}

export function panesOf(node: PaneNode): PaneId[] {
  return isLeaf(node) ? [node.pane] : node.children.flatMap(panesOf);
}

function sameSet(ids: readonly string[], expected: readonly string[]): boolean {
  return ids.length === expected.length && expected.every((id) => ids.includes(id));
}

function rounded(size: number): number {
  return Math.round(size * 1000) / 1000;
}

export function normalizeSizes(sizes: readonly unknown[], count: number): number[] {
  const usable =
    sizes.length === count && sizes.every((size) => typeof size === "number" && Number.isFinite(size) && size > 0);
  return normalWeights(usable ? (sizes as number[]) : [], count).map((share) => rounded(share * 100));
}

function compact(id: string, direction: SplitDirection, entries: readonly { node: PaneNode; size: unknown }[]): PaneNode | null {
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]?.node ?? null;
  const sizes = normalizeSizes(entries.map((entry) => entry.size), entries.length);
  return split(id, direction, entries.map((entry) => entry.node), sizes);
}

export function layoutKey(node: PaneNode): string {
  return isLeaf(node) ? node.pane : `${node.direction}(${node.children.map(layoutKey).join(",")})`;
}

export function isDefaultPaneLayout(layout: PaneNode): boolean {
  return layoutKey(layout) === layoutKey(DEFAULT_PANE_LAYOUT);
}

export function panelIdOf(node: PaneNode): string {
  return isLeaf(node) ? node.pane : (SPLIT_PANEL_IDS[node.id] ?? node.id);
}

function rankOf(id: string): number {
  const rank = STORAGE_RANK.indexOf(id);
  return rank < 0 ? STORAGE_RANK.length : rank;
}

function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : Number(a > b);
}

export function storageOrder(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => rankOf(a) - rankOf(b) || codeUnitOrder(a, b));
}

export function separatorIdAfter(node: PaneSplit, child: PaneNode): string {
  const next = node.children[node.children.indexOf(child) + 1];
  const pair = [panelIdOf(child), next ? panelIdOf(next) : ""];
  return SEPARATOR_IDS[[...pair].sort(codeUnitOrder).join("|")] ?? `sep-${pair.join("-")}`;
}

export function paneVisibility(flags: PaneFlags): PaneShown {
  return {
    sidebar: flags.showTree,
    editor: !flags.workspaceHidden && flags.viewMode !== "pdf",
    pdf: !flags.workspaceHidden && flags.viewMode !== "editor",
    terminal: flags.terminalOpen,
    assistant: flags.assistantOpen,
  };
}

export function nodeShown(node: PaneNode, shown: PaneShown): boolean {
  return isLeaf(node) ? shown[node.pane] : node.children.some((child) => nodeShown(child, shown));
}

export function renderedChildren(node: PaneSplit, shown: PaneShown): PaneNode[] {
  return node.children.filter((child) => nodeShown(child, shown));
}

export function splitsOf(node: PaneNode): PaneSplit[] {
  return isLeaf(node) ? [] : [node, ...node.children.flatMap(splitsOf)];
}

function legacyIdOf(children: readonly PaneNode[]): string | null {
  const ids = children.map(panelIdOf);
  return LEGACY_SPLITS.find(([, expected]) => sameSet(ids, expected))?.[0] ?? null;
}

function withIds(root: PaneSplit, legacy = false): PaneSplit {
  const kept = new Set<PaneSplit>();
  const used = new Set<string>();
  for (const node of splitsOf(root)) {
    if (node.id && !used.has(node.id)) {
      used.add(node.id);
      kept.add(node);
    }
  }
  const claim = (id: string): string => {
    used.add(id);
    return id;
  };
  const fresh = (): string => {
    let next = 1;
    while (used.has(`s${next}`)) next += 1;
    return claim(`s${next}`);
  };
  const rebuild = (node: PaneNode): PaneNode => {
    if (isLeaf(node)) return node;
    const children = node.children.map(rebuild);
    if (kept.has(node)) return children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
    const shaped = legacy ? legacyIdOf(children) : null;
    return split(shaped && !used.has(shaped) ? claim(shaped) : fresh(), node.direction, children, node.sizes);
  };
  return rebuild(root) as PaneSplit;
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
  const children = node.children.map((child, position) => (position === index ? replaceAt(child, rest, replacement) : child));
  return split(node.id, node.direction, children, node.sizes);
}

export function removePane(node: PaneNode, pane: PaneId): PaneNode | null {
  if (isLeaf(node)) return node.pane === pane ? null : node;
  const entries = node.children.flatMap((child, index) => {
    const kept = removePane(child, pane);
    return kept ? [{ node: kept, size: node.sizes[index] }] : [];
  });
  return compact(node.id, node.direction, entries);
}

function paired(direction: SplitDirection, target: PaneNode, inserted: PaneNode, side: Side, share: number, id = ""): PaneSplit {
  const pair = pairBeside(target, inserted, side, share);
  return split(id, direction, pair.children, normalizeSizes(pair.weights, pair.children.length));
}

export function insertAtEdge(node: PaneNode, side: Side, inserted: PaneNode): PaneSplit {
  const direction = edgeDirection(side);
  if (!isLeaf(node) && node.direction === direction) {
    const sizes = node.sizes.map((size) => size * 0.75);
    return split(
      node.id,
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
  const index = path.at(-1) ?? 0;
  const parent = nodeAt(node, parentPath);
  const target = nodeAt(node, path);
  if (!parent || isLeaf(parent) || !target) return node;
  if (parent.direction === direction) {
    const next = spliceBeside(parent.children, parent.sizes, index, inserted, side, 0.5);
    return replaceAt(node, parentPath, split(parent.id, direction, next.children, normalizeSizes(next.weights, next.children.length)));
  }
  return replaceAt(node, path, paired(direction, target, inserted, side, 0.5));
}

function asSplit(node: PaneNode): PaneSplit {
  return isLeaf(node) ? split("", "row", [node], [100]) : node;
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
    const moved = split(parent.id, direction, reorder(parent.children, from, at), reorder(parent.sizes, from, at));
    return asSplit(replaceAt(layout, parentPath, moved));
  }
  if (parent.children.length !== 2) return null;
  const moved = parent.children[from];
  const target = parent.children[to];
  if (!moved || !target) return null;
  return asSplit(replaceAt(layout, parentPath, paired(direction, target, moved, side, 0.5, parent.id)));
}

function moved(layout: PaneSplit, pane: PaneId, target: DropTarget): PaneSplit {
  if (target.kind === "pane" && target.pane === pane) return layout;
  const own = pathOf(layout, pane);
  if (!own) return layout;
  if (target.kind === "pane") {
    const other = pathOf(layout, target.pane);
    if (!other) return layout;
    const parentPath = own.slice(0, -1);
    if (own.length === other.length && parentPath.join() === other.slice(0, -1).join()) {
      const among = moveAmongSiblings(layout, parentPath, own.at(-1) ?? 0, other.at(-1) ?? 0, target.side);
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

export function movePane(layout: PaneSplit, pane: PaneId, target: DropTarget): PaneSplit {
  const next = moved(layout, pane, target);
  return next === layout ? layout : withIds(next);
}

export function moveChanges(layout: PaneSplit, pane: PaneId, target: DropTarget): boolean {
  return layoutKey(movePane(layout, pane, target)) !== layoutKey(layout);
}

export function swapPanes(layout: PaneSplit, a: PaneId, b: PaneId): PaneSplit {
  const swap = (node: PaneNode): PaneNode => {
    if (!isLeaf(node)) return split(node.id, node.direction, node.children.map(swap), node.sizes);
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
  editor: [["pdf", "left"], ["sidebar", "right"], ["assistant", "left"]],
  pdf: [["editor", "right"], ["assistant", "left"], ["sidebar", "right"]],
  sidebar: [["document", "left"], ["assistant", "left"]],
  assistant: [["document", "right"], ["sidebar", "right"]],
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

function withAllPanes(layout: PaneNode): PaneSplit {
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
  const id =
    typeof record.id === "string" && SPLIT_ID.test(record.id) && !isPane(record.id) && !STORAGE_RANK.includes(record.id)
      ? record.id
      : "";
  const sizes: unknown[] = Array.isArray(record.sizes) ? record.sizes : [];
  const entries = record.children.flatMap((child, index) => {
    const node = parseNode(child, seen);
    return node ? [{ node, size: sizes[index] }] : [];
  });
  return compact(id, record.direction, entries);
}

function canonical(layout: PaneSplit): PaneSplit {
  return isDefaultPaneLayout(layout) ? DEFAULT_PANE_LAYOUT : layout;
}

export function paneTreeFrom(root: unknown, legacy = false): PaneSplit | null {
  const node = parseNode(root, new Set());
  return node ? withIds(withAllPanes(node), legacy) : null;
}

export function parsePaneLayout(raw: string | null): PaneSplit {
  let value: unknown = null;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = null;
  }
  if (typeof value !== "object" || value === null || !("version" in value)) {
    return canonical(paneTreeFrom(value, true) ?? DEFAULT_PANE_LAYOUT);
  }
  const stored = value as { version: unknown; root?: unknown };
  return canonical((stored.version === LAYOUT_VERSION && paneTreeFrom(stored.root)) || DEFAULT_PANE_LAYOUT);
}

function writePaneLayout(layout: PaneSplit): void {
  if (isDefaultPaneLayout(layout)) removeKey(PANE_LAYOUT_KEY);
  else writeJson(PANE_LAYOUT_KEY, { version: LAYOUT_VERSION, root: layout });
}

const liveSizes = new Map<string, Readonly<Record<string, number>>>();

export function reportSplitSizes(splitId: string, sizes: Readonly<Record<string, number>> | null): void {
  if (sizes) liveSizes.set(splitId, sizes);
  else liveSizes.delete(splitId);
}

export function withLiveSizes(node: PaneSplit): PaneSplit {
  const sized = (current: PaneNode): PaneNode => {
    if (isLeaf(current)) return current;
    const ids = current.children.map(panelIdOf);
    const reported = liveSizes.get(current.id);
    const live = reported && Object.keys(reported).every((id) => ids.includes(id)) ? reported : {};
    const hidden = ids.reduce((sum, id, index) => (live[id] === undefined ? sum + (current.sizes[index] ?? 0) : sum), 0);
    const sizes = ids.map((id, index) => {
      const size = live[id];
      return size !== undefined && size > 0.5 ? (size * (100 - hidden)) / 100 : (current.sizes[index] ?? 0);
    });
    return split(current.id, current.direction, current.children.map(sized), normalizeSizes(sizes, ids.length));
  };
  return sized(node) as PaneSplit;
}

interface PaneLayoutState {
  layout: PaneSplit;
  epoch: number;
  setLayout: (layout: PaneSplit) => void;
  move: (pane: PaneId, target: DropTarget) => void;
  swap: (a: PaneId, b: PaneId) => void;
  reset: () => void;
  remount: () => void;
}

export const usePaneLayoutStore = create<PaneLayoutState>((set, get) => ({
  layout: parsePaneLayout(readString(PANE_LAYOUT_KEY)),
  epoch: 0,
  setLayout: (layout) => {
    const next = canonical(withIds(withAllPanes(layout)));
    if (JSON.stringify(next) === JSON.stringify(get().layout)) return;
    writePaneLayout(next);
    set({ layout: next });
  },
  move: (pane, target) => {
    const { layout } = get();
    if (moveChanges(layout, pane, target)) get().setLayout(movePane(withLiveSizes(layout), pane, target));
  },
  swap: (a, b) => get().setLayout(swapPanes(get().layout, a, b)),
  reset: () => get().setLayout(DEFAULT_PANE_LAYOUT),
  remount: () => set((state) => ({ epoch: state.epoch + 1 })),
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
