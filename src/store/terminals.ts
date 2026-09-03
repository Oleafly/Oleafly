import { create } from "zustand";

export const TERMINAL_LIMIT = 10;
export const TERMINAL_LIMIT_MESSAGE = "Close a terminal to open another";
export const TERMINAL_TITLE_MAX_LENGTH = 40;

const TITLES_KEY_PREFIX = "oleafly.terminal.titles.";

export interface TerminalTab {
  id: string;
  index: number;
  title: string;
  autoStart: boolean;
}

interface TerminalsState {
  projectId: string | null;
  tabs: TerminalTab[];
  activeId: string | null;
  counters: Record<string, number>;
  setProject: (projectId: string | null) => void;
  addTerminal: () => TerminalTab | null;
  closeTerminal: (id: string) => TerminalTab[];
  activateTerminal: (id: string) => void;
  renameTerminal: (id: string, title: string) => void;
}

let tabSeq = 0;

export function defaultTerminalTitle(index: number): string {
  return `Terminal ${index}`;
}

export function terminalTitlesKey(projectId: string): string {
  return `${TITLES_KEY_PREFIX}${projectId}`;
}

function readTitles(projectId: string): Record<string, string> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(terminalTitlesKey(projectId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const titles: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) titles[key] = value;
    }
    return titles;
  } catch {
    return {};
  }
}

function writeTitles(projectId: string, titles: Record<string, string>) {
  try {
    if (typeof localStorage === "undefined") return;
    const key = terminalTitlesKey(projectId);
    if (Object.keys(titles).length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(titles));
  } catch {
    return;
  }
}

export function normalizeTerminalTitle(raw: string, index: number): string {
  const trimmed = raw.trim().slice(0, TERMINAL_TITLE_MAX_LENGTH).trim();
  return trimmed || defaultTerminalTitle(index);
}

function makeTab(projectId: string, index: number, autoStart: boolean): TerminalTab {
  tabSeq += 1;
  const persisted = readTitles(projectId)[String(index)];
  return {
    id: `terminal-${tabSeq}`,
    index,
    title: persisted ? normalizeTerminalTitle(persisted, index) : defaultTerminalTitle(index),
    autoStart,
  };
}

function neighborOf(tabs: TerminalTab[], closedIndex: number): TerminalTab | null {
  if (tabs.length === 0) return null;
  return tabs[Math.min(closedIndex, tabs.length - 1)] ?? null;
}

export const useTerminalsStore = create<TerminalsState>((set, get) => ({
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
    const titles = readTitles(projectId);
    if (nextTitle === defaultTerminalTitle(tab.index)) {
      delete titles[String(tab.index)];
    } else {
      titles[String(tab.index)] = nextTitle;
    }
    writeTitles(projectId, titles);
  },
}));
