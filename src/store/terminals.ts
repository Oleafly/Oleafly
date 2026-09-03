import { create } from "zustand";

export const TERMINAL_LIMIT = 10;
export const TERMINAL_LIMIT_MESSAGE = "Close a terminal to open another";
export const TERMINAL_TITLE_MAX_LENGTH = 40;

const TITLES_KEY_PREFIX = "oleafly.terminal.titles.";

export const TERMINAL_COLOR_KEYS = [
  "blue",
  "cream",
  "peach",
  "rose",
  "pink",
  "lilac",
  "sky",
  "aqua",
  "cyan",
  "mint",
  "spring",
] as const;

export type TerminalColorKey = (typeof TERMINAL_COLOR_KEYS)[number];

export function isTerminalColorKey(value: unknown): value is TerminalColorKey {
  return typeof value === "string" && (TERMINAL_COLOR_KEYS as readonly string[]).includes(value);
}

export interface TerminalTab {
  id: string;
  index: number;
  title: string;
  color: TerminalColorKey | null;
  autoStart: boolean;
}

interface TerminalSlot {
  title?: string;
  color?: TerminalColorKey;
}

interface TerminalsState {
  projectId: string | null;
  tabs: TerminalTab[];
  activeId: string | null;
  counters: Record<string, number>;
  setProject: (projectId: string | null) => void;
  addTerminal: () => TerminalTab | null;
  closeTerminal: (id: string) => TerminalTab[];
  closeOtherTerminals: (id: string) => TerminalTab[];
  closeTerminalsToTheRight: (id: string) => TerminalTab[];
  closeTerminalsToTheLeft: (id: string) => TerminalTab[];
  activateTerminal: (id: string) => void;
  renameTerminal: (id: string, title: string) => void;
  setTerminalColor: (id: string, color: TerminalColorKey | null) => void;
}

let tabSeq = 0;

export function defaultTerminalTitle(index: number): string {
  return `Terminal ${index}`;
}

export function terminalTitlesKey(projectId: string): string {
  return `${TITLES_KEY_PREFIX}${projectId}`;
}

function readSlot(value: unknown): TerminalSlot | null {
  if (typeof value === "string") return value.trim() ? { title: value } : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const slot: TerminalSlot = {};
  if (typeof record.title === "string" && record.title.trim()) slot.title = record.title;
  if (isTerminalColorKey(record.color)) slot.color = record.color;
  return slot.title || slot.color ? slot : null;
}

function readSlots(projectId: string): Record<string, TerminalSlot> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(terminalTitlesKey(projectId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const slots: Record<string, TerminalSlot> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const slot = readSlot(value);
      if (slot) slots[key] = slot;
    }
    return slots;
  } catch {
    return {};
  }
}

function writeSlots(projectId: string, slots: Record<string, TerminalSlot>) {
  try {
    if (typeof localStorage === "undefined") return;
    const key = terminalTitlesKey(projectId);
    const stored: Record<string, string | TerminalSlot> = {};
    for (const [slotKey, slot] of Object.entries(slots)) {
      if (slot.color) {
        stored[slotKey] = slot.title
          ? { title: slot.title, color: slot.color }
          : { color: slot.color };
      } else if (slot.title) {
        stored[slotKey] = slot.title;
      }
    }
    if (Object.keys(stored).length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    return;
  }
}

function saveSlot(projectId: string, index: number, slot: TerminalSlot) {
  const slots = readSlots(projectId);
  if (slot.title || slot.color) slots[String(index)] = slot;
  else delete slots[String(index)];
  writeSlots(projectId, slots);
}

export function normalizeTerminalTitle(raw: string, index: number): string {
  const trimmed = raw.trim().slice(0, TERMINAL_TITLE_MAX_LENGTH).trim();
  return trimmed || defaultTerminalTitle(index);
}

function makeTab(projectId: string, index: number, autoStart: boolean): TerminalTab {
  tabSeq += 1;
  const slot = readSlots(projectId)[String(index)];
  return {
    id: `terminal-${tabSeq}`,
    index,
    title: slot?.title ? normalizeTerminalTitle(slot.title, index) : defaultTerminalTitle(index),
    color: slot?.color ?? null,
    autoStart,
  };
}

function neighborOf(tabs: TerminalTab[], closedIndex: number): TerminalTab | null {
  if (tabs.length === 0) return null;
  return tabs[Math.min(closedIndex, tabs.length - 1)] ?? null;
}

export const useTerminalsStore = create<TerminalsState>((set, get) => {
  const closeAround = (
    id: string,
    keep: (position: number, anchor: number) => boolean,
  ): TerminalTab[] => {
    const state = get();
    const anchor = state.tabs.findIndex((tab) => tab.id === id);
    if (anchor < 0) return state.tabs;
    const tabs = state.tabs.filter(
      (_tab, position) => position === anchor || keep(position, anchor),
    );
    if (tabs.length === state.tabs.length) return state.tabs;
    const activeId = tabs.some((tab) => tab.id === state.activeId) ? state.activeId : id;
    set({ tabs, activeId });
    return tabs;
  };

  return {
    projectId: null,
    tabs: [],
    activeId: null,
    counters: {},
    setProject: (projectId) => {
      const state = get();
      if (state.projectId === projectId) return;
      if (!projectId) {
        set({ projectId: null, tabs: [], activeId: null });
        return;
      }
      const index = (state.counters[projectId] ?? 0) + 1;
      const tab = makeTab(projectId, index, false);
      set({
        projectId,
        tabs: [tab],
        activeId: tab.id,
        counters: { ...state.counters, [projectId]: index },
      });
    },
    addTerminal: () => {
      const state = get();
      const projectId = state.projectId;
      if (!projectId) return null;
      if (state.tabs.length >= TERMINAL_LIMIT) return null;
      const index = (state.counters[projectId] ?? 0) + 1;
      const tab = makeTab(projectId, index, true);
      set({
        tabs: [...state.tabs, tab],
        activeId: tab.id,
        counters: { ...state.counters, [projectId]: index },
      });
      return tab;
    },
    closeTerminal: (id) => {
      const state = get();
      const position = state.tabs.findIndex((tab) => tab.id === id);
      if (position < 0) return state.tabs;
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const activeId =
        state.activeId === id ? (neighborOf(tabs, position)?.id ?? null) : state.activeId;
      set({ tabs, activeId });
      return tabs;
    },
    closeOtherTerminals: (id) => closeAround(id, () => false),
    closeTerminalsToTheRight: (id) => closeAround(id, (position, anchor) => position < anchor),
    closeTerminalsToTheLeft: (id) => closeAround(id, (position, anchor) => position > anchor),
    activateTerminal: (id) => {
      const state = get();
      if (state.activeId === id || !state.tabs.some((tab) => tab.id === id)) return;
      set({ activeId: id });
    },
    renameTerminal: (id, title) => {
      const state = get();
      const projectId = state.projectId;
      const tab = state.tabs.find((candidate) => candidate.id === id);
      if (!projectId || !tab) return;
      const nextTitle = normalizeTerminalTitle(title, tab.index);
      if (nextTitle !== tab.title) {
        set({
          tabs: state.tabs.map((candidate) =>
            candidate.id === id ? { ...candidate, title: nextTitle } : candidate,
          ),
        });
      }
      const slot = readSlots(projectId)[String(tab.index)] ?? {};
      if (nextTitle === defaultTerminalTitle(tab.index)) delete slot.title;
      else slot.title = nextTitle;
      saveSlot(projectId, tab.index, slot);
    },
    setTerminalColor: (id, color) => {
      const state = get();
      const projectId = state.projectId;
      const tab = state.tabs.find((candidate) => candidate.id === id);
      if (!projectId || !tab) return;
      const next = isTerminalColorKey(color) ? color : null;
      if (next !== tab.color) {
        set({
          tabs: state.tabs.map((candidate) =>
            candidate.id === id ? { ...candidate, color: next } : candidate,
          ),
        });
      }
      const slot = readSlots(projectId)[String(tab.index)] ?? {};
      if (next) slot.color = next;
      else delete slot.color;
      saveSlot(projectId, tab.index, slot);
    },
  };
});
