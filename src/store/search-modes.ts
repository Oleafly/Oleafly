import { create } from "zustand";
import { readJson, writeJson } from "@/lib/local-storage";
import { SEARCH_MODES, type SearchMode } from "@/lib/search-modes";

export const SEARCH_MODES_KEY = "oleafly.search.modes";

export type SearchScope = "notes" | "files";

type Modes = Record<SearchScope, SearchMode>;

const DEFAULT_MODES: Modes = { notes: "ranked", files: "ranked" };

function stored(value: unknown): Modes {
  const record = typeof value === "object" && value !== null ? (value as Partial<Record<string, unknown>>) : {};
  const pick = (scope: SearchScope): SearchMode => {
    const mode = record[scope];
    return SEARCH_MODES.find((known) => known === mode) ?? DEFAULT_MODES[scope];
  };
  return { notes: pick("notes"), files: pick("files") };
}

export const useSearchModeStore = create<Modes & { setMode: (scope: SearchScope, mode: SearchMode) => void }>((set, get) => ({
  ...readJson(SEARCH_MODES_KEY, DEFAULT_MODES, stored),
  setMode: (scope, mode) => {
    set({ [scope]: mode });
    const { notes, files } = get();
    writeJson(SEARCH_MODES_KEY, { notes, files });
  },
}));
