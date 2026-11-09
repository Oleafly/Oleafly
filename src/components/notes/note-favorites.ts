import { useMemo } from "react";
import { parseJson, storedValue, useStoredValue } from "./note-storage";

export const NOTE_FAVORITES_KEY = "oleafly.notes.favorites";

const favorites = storedValue<readonly string[]>(
  NOTE_FAVORITES_KEY,
  (raw) => {
    const value = parseJson(raw);
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))] : [];
  },
  (ids) => JSON.stringify(ids),
);

export const subscribeNoteFavorites = favorites.subscribe;

export function readNoteFavorites(): readonly string[] {
  return favorites.read();
}

export function setNoteFavorite(id: string, favorite: boolean): void {
  const current = favorites.read();
  if (current.includes(id) === favorite) return;
  favorites.write(favorite ? [id, ...current] : current.filter((candidate) => candidate !== id));
}

export function toggleNoteFavorite(id: string): void {
  setNoteFavorite(id, !favorites.read().includes(id));
}

export function useNoteFavorites(): ReadonlySet<string> {
  const ids = useStoredValue(favorites);
  return useMemo(() => new Set(ids), [ids]);
}
