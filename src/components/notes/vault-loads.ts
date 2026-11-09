import { useNotesData } from "./notes-data";

const KEPT = 2;

interface Loaded {
  key: unknown;
  value: Promise<unknown>;
}

const loads = new WeakMap<object, Loaded[]>();

export function vaultLoad<T>(load: () => Promise<T>, key: unknown): Promise<T> {
  let entries = loads.get(load);
  if (!entries) {
    entries = [];
    loads.set(load, entries);
  }
  const found = entries.find((entry) => entry.key === key);
  if (found) return found.value as Promise<T>;
  const value = load();
  entries.push({ key, value });
  if (entries.length > KEPT) entries.shift();
  return value;
}

export function useVaultKey(): unknown {
  const { notes, revision } = useNotesData();
  return revision ?? notes;
}

const QUERIES_KEPT = 64;

interface Queries {
  vault: unknown;
  results: Map<string, Promise<unknown>>;
}

const queries = new WeakMap<object, Queries>();

export function vaultQuery<T>(owner: object, vault: unknown, key: string, run: () => Promise<T>): Promise<T> {
  let entry = queries.get(owner);
  if (!entry || entry.vault !== vault) {
    entry = { vault, results: new Map() };
    queries.set(owner, entry);
  }
  const { results } = entry;
  const found = results.get(key);
  if (found) return found as Promise<T>;
  const value = run();
  results.set(key, value);
  if (results.size > QUERIES_KEPT) results.delete(results.keys().next().value as string);
  value.catch(() => {
    if (results.get(key) === value) results.delete(key);
  });
  return value;
}
