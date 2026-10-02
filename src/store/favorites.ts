import { create } from "zustand";
import { readJson, writeJson } from "@/lib/local-storage";

const KEY = "oleafly.favorites";

function load(): string[] {
  return readJson<string[]>(KEY, []);
}

function save(ids: string[]) {
  writeJson(KEY, ids);
}

interface FavoritesState {
  favs: string[];
  toggle: (id: string) => void;
  remove: (id: string) => void;
  isFav: (id: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favs: load(),
  toggle: (id) => {
    const cur = get().favs;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    save(next);
    set({ favs: next });
  },
  remove: (id) => {
    const next = get().favs.filter((favorite) => favorite !== id);
    save(next);
    set({ favs: next });
  },
  isFav: (id) => get().favs.includes(id),
}));
