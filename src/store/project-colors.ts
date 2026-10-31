import { create } from "zustand";
import { setProjectColor as setProjectColorCmd } from "@/lib/tauri";
import { logError } from "@/lib/log";
import { readJson, writeJson } from "@/lib/local-storage";

const KEY = "oleafly.projectColors";

function load(): Record<string, string> {
  return readJson<Record<string, string>>(KEY, {});
}

function save(map: Record<string, string>) {
  writeJson(KEY, map);
}

interface ProjectColorsState {
  colors: Record<string, string>;
  setColor: (id: string, color: string) => void;
  remove: (id: string) => void;
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
  remove: (id) => {
    const { [id]: _removed, ...next } = get().colors;
    save(next);
    set({ colors: next });
  },
  get: (id) => get().colors[id],
}));
