import { create } from "zustand";
import { useDiffStore } from "@/store/diff";
import { nextTabSeq } from "@/store/tab-order";
import { readJson, writeJson } from "@/lib/local-storage";

export interface NoteTab {
  id: string;
  projectId: string;
  order: number;
  icon?: string;
  color?: string;
}

export interface NoteTabLook {
  icon?: string;
  color?: string;
}

interface NoteTabsState {
  tabs: NoteTab[];
  active: string | null;
  markdown: Readonly<Record<string, true>>;
  open: (projectId: string, id: string, look?: NoteTabLook) => void;
  close: (id: string) => void;
  closeMany: (ids: readonly string[]) => void;
  setActive: (id: string) => void;
  clearActive: () => void;
  setLook: (id: string, look: NoteTabLook) => void;
  setMarkdown: (projectId: string, path: string, markdown: boolean) => void;
}

export function markdownKey(projectId: string, path: string): string {
  return `${projectId}\u0000${path}`;
}

const NO_TABS: NoteTab[] = [];
const MARKDOWN_STORAGE_KEY = "oleafly.notes.editAsMarkdown";

function storedMarkdown(): Readonly<Record<string, true>> {
  return readJson(MARKDOWN_STORAGE_KEY, {}, (value) =>
    Object.fromEntries(
      (Array.isArray(value) ? value : []).filter((key): key is string => typeof key === "string").map((key) => [key, true]),
    ),
  );
}
let watchingDiffs = false;

function focusFromDiffs(): void {
  useDiffStore.getState().clearActiveDiff();
  if (watchingDiffs) return;
  watchingDiffs = true;
  useDiffStore.subscribe((state, previous) => {
    if (state.activeKey !== null && state.activeKey !== previous.activeKey) clearActiveNoteTab();
  });
}

export const useNoteTabsStore = create<NoteTabsState>((set, get) => ({
  tabs: [],
  active: null,
  markdown: storedMarkdown(),
  open: (projectId, id, look) => {
    focusFromDiffs();
    set((state) => {
      const kept = state.tabs.filter((tab) => tab.projectId === projectId);
      const existing = kept.find((tab) => tab.id === id);
      const tabs = existing
        ? kept.map((tab) => (tab === existing && look ? { ...tab, ...look } : tab))
        : [...kept, { id, projectId, order: nextTabSeq(), ...look }];
      return { tabs, active: id };
    });
  },
  close: (id) => get().closeMany([id]),
  closeMany: (ids) => {
    if (ids.length === 0) return;
    const closing = new Set(ids);
    set((state) => ({
      tabs: state.tabs.filter((tab) => !closing.has(tab.id)),
      active: state.active !== null && closing.has(state.active) ? null : state.active,
    }));
  },
  setActive: (id) => {
    focusFromDiffs();
    set({ active: id });
  },
  clearActive: () => {
    if (get().active !== null) set({ active: null });
  },
  setLook: (id, look) =>
    set((state) => {
      const tab = state.tabs.find((entry) => entry.id === id);
      if (!tab || (tab.icon === look.icon && tab.color === look.color)) return state;
      return { tabs: state.tabs.map((entry) => (entry === tab ? { ...entry, ...look } : entry)) };
    }),
  setMarkdown: (projectId, path, markdown) => {
    const key = markdownKey(projectId, path);
    const current = get().markdown;
    if (Boolean(current[key]) === markdown) return;
    const next = { ...current };
    if (markdown) next[key] = true;
    else delete next[key];
    writeJson(MARKDOWN_STORAGE_KEY, Object.keys(next));
    set({ markdown: next });
  },
}));

export function noteTabsFor(state: Pick<NoteTabsState, "tabs">, projectId: string | null): NoteTab[] {
  if (!projectId) return NO_TABS;
  const tabs = state.tabs.filter((tab) => tab.projectId === projectId);
  return tabs.length === state.tabs.length ? state.tabs : tabs;
}

export function activeNoteTab(state: Pick<NoteTabsState, "tabs" | "active">, projectId: string | null): string | null {
  const { active } = state;
  if (active === null || !projectId) return null;
  return state.tabs.some((tab) => tab.id === active && tab.projectId === projectId) ? active : null;
}

export function editsAsMarkdown(state: Pick<NoteTabsState, "markdown">, projectId: string | null, path: string | null): boolean {
  return projectId !== null && path !== null && state.markdown[markdownKey(projectId, path)] === true;
}

export function clearActiveNoteTab(): void {
  useNoteTabsStore.getState().clearActive();
}
