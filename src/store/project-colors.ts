import { create } from "zustand";
import { setProjectColor as setProjectColorCmd } from "@/lib/tauri";
import { logError } from "@/lib/log";

// Cover colors now live on disk in each project's project.json. This store keeps
// a lightweight in-memory override for instant UI feedback and still reads the
// legacy localStorage map so projects created before the on-disk color keep theirs.
const KEY = "openleaf.projectColors";

function load(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function save(map: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* best effort */
  }
}

interface ProjectColorsState {
  /** Local overrides + migrated legacy colors, keyed by project id. */
  colors: Record<string, string>;
  /** Persist a color to disk and reflect it immediately in the UI. */
  setColor: (id: string, color: string) => void;
  get: (id: string) => string | undefined;
}

export const useProjectColorsStore = create<ProjectColorsState>((set, get) => ({
  colors: load(),
  setColor: (id, color) => {
    const next = { ...get().colors, [id]: color };
    save(next);
    set({ colors: next });
    void setProjectColorCmd(id, color).catch((e) => void logError("persist project color", e));
  },
  get: (id) => get().colors[id],
}));
