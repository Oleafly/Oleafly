import { create } from "zustand";
import { readJson, writeJson } from "@/lib/local-storage";
import { replaceStoredPanelLayout } from "@/lib/panel-layout";
import { workspacePanelId } from "@/lib/workspace-layout";
import { useFilesStore } from "@/store/files";
import {
  isLeaf,
  layoutKey,
  paneTreeFrom,
  paneVisibility,
  panelIdOf,
  renderedChildren,
  splitsOf,
  storageOrder,
  usePaneLayoutStore,
  withLiveSizes,
  type PaneFlags,
  type PaneNode,
  type PaneSplit,
} from "@/store/pane-layout";
import { useSettingsStore, type ViewMode } from "@/store/settings";

export const SAVED_LAYOUTS_KEY = "oleafly.workspace.savedLayouts";
export const SAVED_LAYOUT_LIMIT = 12;
const VERSION = 1;
const VIEW_MODES: readonly ViewMode[] = ["editor", "split", "pdf"];
const FLAG_NAMES = ["showTree", "assistantOpen", "workspaceHidden", "terminalOpen"] as const;
const SIZE_TOLERANCE = 1;

export interface SavedLayout {
  readonly id: string;
  readonly name: string;
  readonly tree: PaneSplit;
  readonly flags: PaneFlags;
}

function parseFlags(value: unknown): PaneFlags | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!VIEW_MODES.includes(record.viewMode as ViewMode)) return null;
  if (!FLAG_NAMES.every((name) => typeof record[name] === "boolean")) return null;
  return {
    viewMode: record.viewMode as ViewMode,
    showTree: record.showTree as boolean,
    assistantOpen: record.assistantOpen as boolean,
    workspaceHidden: record.workspaceHidden as boolean,
    terminalOpen: record.terminalOpen as boolean,
  };
}

function parseLayout(value: unknown): SavedLayout | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const tree = paneTreeFrom(record.tree);
  const flags = parseFlags(record.flags);
  if (typeof record.id !== "string" || !record.id || !name || !tree || !flags) return null;
  return { id: record.id, name, tree, flags };
}

function parseSaved(value: unknown): SavedLayout[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (record.version !== VERSION || !Array.isArray(record.layouts)) return [];
  const layouts: SavedLayout[] = [];
  for (const entry of record.layouts) {
    const layout = parseLayout(entry);
    if (layout && !layouts.some((kept) => kept.id === layout.id) && layouts.length < SAVED_LAYOUT_LIMIT) {
      layouts.push(layout);
    }
  }
  return layouts;
}

function currentPaneFlags(): PaneFlags {
  const { viewMode, showTree, assistantOpen, workspaceHidden, terminalOpen } = useSettingsStore.getState();
  return { viewMode, showTree, assistantOpen, workspaceHidden, terminalOpen };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

export function savedLayoutNamed(name: string, except: string | null = null): SavedLayout | undefined {
  return useSavedLayoutsStore.getState().layouts.find((layout) => layout.id !== except && sameName(layout.name, name));
}

function newId(): string {
  return `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function storeSizes(projectId: string, tree: PaneSplit, flags: PaneFlags): void {
  const shown = paneVisibility(flags);
  for (const node of splitsOf(tree)) {
    const rendered = renderedChildren(node, shown);
    if (rendered.length === 0) continue;
    const shares = new Map(rendered.map((child) => [panelIdOf(child), node.sizes[node.children.indexOf(child)] ?? 0]));
    const total = [...shares.values()].reduce((sum, size) => sum + size, 0) || 1;
    replaceStoredPanelLayout(
      workspacePanelId(projectId, node.id),
      Object.fromEntries(
        storageOrder([...shares.keys()]).map((id) => [id, Math.round(((shares.get(id) ?? 0) / total) * 100_000) / 1000]),
      ),
    );
  }
}

export function savedLayoutInEffect(layout: SavedLayout, tree: PaneSplit, flags: PaneFlags): boolean {
  return (
    layoutKey(layout.tree) === layoutKey(tree) &&
    (Object.keys(layout.flags) as (keyof PaneFlags)[]).every((name) => layout.flags[name] === flags[name])
  );
}

function sameSizes(a: PaneNode, b: PaneNode): boolean {
  if (isLeaf(a) || isLeaf(b)) return isLeaf(a) && isLeaf(b);
  return (
    a.sizes.every((size, index) => Math.abs(size - (b.sizes[index] ?? 0)) <= SIZE_TOLERANCE) &&
    a.children.every((child, index) => {
      const other = b.children[index];
      return other !== undefined && sameSizes(child, other);
    })
  );
}

function currentArrangement(): { tree: PaneSplit; flags: PaneFlags } {
  return { tree: withLiveSizes(usePaneLayoutStore.getState().layout), flags: currentPaneFlags() };
}

export function savedLayoutSameAs(
  layouts: readonly SavedLayout[],
  tree: PaneSplit,
  flags: PaneFlags,
): SavedLayout | undefined {
  return layouts.find((layout) => savedLayoutInEffect(layout, tree, flags) && sameSizes(layout.tree, tree));
}

export function savedLayoutShown(
  layouts: readonly SavedLayout[],
  activeId: string | null,
  tree: PaneSplit,
  flags: PaneFlags,
): SavedLayout | undefined {
  const inEffect = layouts.filter((layout) => savedLayoutInEffect(layout, tree, flags));
  return inEffect.find((layout) => layout.id === activeId) ?? savedLayoutSameAs(inEffect, tree, flags) ?? inEffect[0];
}

export function savedLayoutLikeCurrent(): SavedLayout | undefined {
  const { tree, flags } = currentArrangement();
  return savedLayoutSameAs(useSavedLayoutsStore.getState().layouts, tree, flags);
}

export type SaveOutcome =
  | { saved: true }
  | { saved: false; reason: "unnamed" | "limit" }
  | { saved: false; reason: "duplicate"; name: string };

interface SavedLayoutsState {
  layouts: SavedLayout[];
  activeId: string | null;
  naming: { id: string | null } | null;
  save: (name: string) => SaveOutcome;
  rename: (id: string, name: string) => void;
  update: (id: string) => void;
  remove: (id: string) => void;
  apply: (id: string) => void;
  startNaming: (id: string | null) => void;
  stopNaming: () => void;
}

function write(layouts: SavedLayout[]): SavedLayout[] {
  writeJson(SAVED_LAYOUTS_KEY, { version: VERSION, layouts });
  return layouts;
}

export const useSavedLayoutsStore = create<SavedLayoutsState>((set, get) => ({
  layouts: readJson(SAVED_LAYOUTS_KEY, [], parseSaved),
  activeId: null,
  naming: null,
  save: (name) => {
    const trimmed = name.trim();
    const { layouts } = get();
    if (!trimmed) return { saved: false, reason: "unnamed" };
    const existing = savedLayoutNamed(trimmed);
    const { tree, flags } = currentArrangement();
    const same = savedLayoutSameAs(layouts, tree, flags);
    if (same && same !== existing) return { saved: false, reason: "duplicate", name: same.name };
    if (!existing && layouts.length >= SAVED_LAYOUT_LIMIT) return { saved: false, reason: "limit" };
    const captured: SavedLayout = { id: existing?.id ?? newId(), name: trimmed, tree, flags };
    set({
      activeId: captured.id,
      layouts: write(existing ? layouts.map((layout) => (layout === existing ? captured : layout)) : [...layouts, captured]),
    });
    return { saved: true };
  },
  rename: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set({
      layouts: write(
        get()
          .layouts.filter((layout) => layout.id === id || !sameName(layout.name, trimmed))
          .map((layout) => (layout.id === id ? { ...layout, name: trimmed } : layout)),
      ),
    });
  },
  update: (id) => {
    const { tree, flags } = currentArrangement();
    set({
      activeId: id,
      layouts: write(get().layouts.map((layout) => (layout.id === id ? { ...layout, tree, flags } : layout))),
    });
  },
  remove: (id) =>
    set((state) => ({
      activeId: state.activeId === id ? null : state.activeId,
      layouts: write(state.layouts.filter((layout) => layout.id !== id)),
    })),
  apply: (id) => {
    const layout = get().layouts.find((saved) => saved.id === id);
    if (!layout) return;
    set({ activeId: id });
    const panes = usePaneLayoutStore.getState();
    panes.setLayout(layout.tree);
    useSettingsStore.setState({ ...layout.flags });
    const { projectId } = useFilesStore.getState();
    if (projectId) storeSizes(projectId, layout.tree, layout.flags);
    panes.remount();
  },
  startNaming: (id) => set({ naming: { id } }),
  stopNaming: () => set({ naming: null }),
}));
