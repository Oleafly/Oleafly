import { create } from "zustand";
import { isMac } from "@/lib/utils";

interface LibrarySelectionState {
  ids: ReadonlySet<string>;
  toggle(id: string): void;
  replace(ids: ReadonlySet<string>): void;
  retain(allowed: ReadonlySet<string>): void;
  clear(): void;
}

const EMPTY: ReadonlySet<string> = new Set();

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

export function isSelectionModifier(event: Readonly<{ metaKey: boolean; ctrlKey: boolean }>): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

export const useLibrarySelectionStore = create<LibrarySelectionState>((set, get) => ({
  ids: EMPTY,

  toggle(id) {
    const next = new Set(get().ids);
    if (!next.delete(id)) next.add(id);
    set({ ids: next });
  },

  replace(ids) {
    if (sameIds(ids, get().ids)) return;
    set({ ids: ids.size === 0 ? EMPTY : new Set(ids) });
  },

  retain(allowed) {
    const current = get().ids;
    const kept = [...current].filter((id) => allowed.has(id));
    if (kept.length !== current.size) set({ ids: kept.length === 0 ? EMPTY : new Set(kept) });
  },

  clear() {
    if (get().ids.size > 0) set({ ids: EMPTY });
  },
}));
