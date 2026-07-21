import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

// In-memory fallback so the store also works where localStorage is absent
// (e.g. Node during tests) without changing behavior in the browser.
const memory = new Map<string, string>();
const memoryStorage: StateStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

// Words can be ignored just for one project or everywhere. Persisted to the
// webview's localStorage so it survives restarts.
interface DictionaryState {
  // Keyed by projectId -> ignored words (as written).
  ignored: Record<string, string[]>;
  // Words ignored across every project.
  global: string[];
  ignore: (projectId: string, word: string) => void;
  ignoreGlobal: (word: string) => void;
  unignore: (projectId: string, word: string) => void;
  unignoreGlobal: (word: string) => void;
  clear: (projectId: string) => void;
}

export const useDictionary = create<DictionaryState>()(
  persist(
    (set) => ({
      ignored: {},
      global: [],
      ignore: (projectId, word) =>
        set((s) => {
          const w = word.trim();
          if (!w) return s;
          const cur = s.ignored[projectId] ?? [];
          if (cur.includes(w)) return s;
          return { ignored: { ...s.ignored, [projectId]: [...cur, w] } };
        }),
      ignoreGlobal: (word) =>
        set((s) => {
          const w = word.trim();
          if (!w || s.global.includes(w)) return s;
          return { global: [...s.global, w] };
        }),
      unignore: (projectId, word) =>
        set((s) => ({
          ignored: {
            ...s.ignored,
            [projectId]: (s.ignored[projectId] ?? []).filter((x) => x !== word.trim()),
          },
        })),
      unignoreGlobal: (word) =>
        set((s) => ({ global: s.global.filter((x) => x !== word.trim()) })),
      clear: (projectId) =>
        set((s) => {
          const next = { ...s.ignored };
          delete next[projectId];
          return { ignored: next };
        }),
    }),
    {
      name: "oleafly.dictionary",
      storage: createJSONStorage(() =>
        typeof localStorage !== "undefined" ? localStorage : memoryStorage
      ),
    }
  )
);

export function isWordIgnored(projectId: string | null, word: string): boolean {
  const w = word.trim();
  const s = useDictionary.getState();
  if (s.global.includes(w)) return true;
  if (projectId && (s.ignored[projectId] ?? []).includes(w)) return true;
  return false;
}

export function ignoreWordForProject(projectId: string | null, word: string): void {
  if (!projectId) return;
  useDictionary.getState().ignore(projectId, word);
}

export function ignoreWordGlobally(word: string): void {
  useDictionary.getState().ignoreGlobal(word);
}
