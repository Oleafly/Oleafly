import { create } from "zustand";
import { nextTabSeq } from "@/store/tab-order";

export type DiffSide = "working" | "staged";
export type DiffMode = "split" | "unified";

export interface OpenDiff {
  path: string;
  /** "working" = worktree vs index (editable); "staged" = index vs HEAD (read-only). */
  side: DiffSide;
  /** Open-order stamp, shared with file tabs so they interleave by open time. */
  order: number;
}

/** Stable identity for a diff tab (a file can be open as both a working and a staged diff). */
export function diffKey(d: Pick<OpenDiff, "path" | "side">): string {
  return `${d.side}:${d.path}`;
}

interface DiffState {
  /** Open diff tabs, in the order they were opened. */
  diffs: OpenDiff[];
  /** Key of the focused diff, or null when a file tab is the focused view. */
  activeKey: string | null;
  mode: DiffMode;
  openDiff: (path: string, side: DiffSide) => void;
  closeDiff: (key: string) => void;
  /** Focus a diff tab (without touching the open file tabs). */
  setActiveDiff: (key: string) => void;
  /** Unfocus any diff so a file tab becomes the active view. */
  clearActiveDiff: () => void;
  setMode: (mode: DiffMode) => void;
}

const MODE_KEY = "openleaf.diffMode";

function loadMode(): DiffMode {
  try {
    return localStorage.getItem(MODE_KEY) === "unified" ? "unified" : "split";
  } catch {
    return "split";
  }
}

/** Git diffs open in the editor area as tabs (replaces the old modal). */
export const useDiffStore = create<DiffState>((set) => ({
  diffs: [],
  activeKey: null,
  mode: loadMode(),
  openDiff: (path, side) =>
    set((s) => {
      const key = diffKey({ path, side });
      const exists = s.diffs.some((d) => diffKey(d) === key);
      return {
        // Re-opening an already-open diff keeps its position; only new diffs get
        // a fresh open-order stamp.
        diffs: exists ? s.diffs : [...s.diffs, { path, side, order: nextTabSeq() }],
        activeKey: key,
      };
    }),
  closeDiff: (key) =>
    set((s) => ({
      diffs: s.diffs.filter((d) => diffKey(d) !== key),
      activeKey: s.activeKey === key ? null : s.activeKey,
    })),
  setActiveDiff: (key) => set({ activeKey: key }),
  clearActiveDiff: () => set({ activeKey: null }),
  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
    set({ mode });
  },
}));

/** The currently focused diff, or null when a file tab is active. */
export function activeDiff(s: DiffState): OpenDiff | null {
  return s.diffs.find((d) => diffKey(d) === s.activeKey) ?? null;
}
