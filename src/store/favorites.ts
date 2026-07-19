import { create } from "zustand";

const KEY = "openleaf.favorites";

function load(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function save(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* best effort */
  }
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
