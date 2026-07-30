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
  clearGlobal: () => void;
  clearAll: () => void;
}

export const DICTIONARY_LIMITS = {
  wordsPerScope: 5_000,
  wordCharacters: 128,
  projectScopes: 256,
  totalProjectWords: 20_000,
} as const;

export function normalizeDictionaryWord(word: string): string {
  return word
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
}

function dictionaryKey(word: string): string {
  return normalizeDictionaryWord(word).toLocaleLowerCase("en-US");
}

const dictionarySetCache = new WeakMap<string[], ReadonlySet<string>>();
const EMPTY_WORDS: string[] = [];

function dictionarySet(words: string[]): ReadonlySet<string> {
  const cached = dictionarySetCache.get(words);
  if (cached) return cached;
  const keys = new Set(words.map(dictionaryKey));
  dictionarySetCache.set(words, keys);
  return keys;
}

function canStoreWord(word: string): boolean {
  return (
    word.length > 0 &&
    word.length <= DICTIONARY_LIMITS.wordCharacters &&
    !/[\p{Cc}\p{Cf}]/u.test(word)
  );
}

function canStoreProjectId(projectId: string): boolean {
  return (
    projectId.length > 0 &&
    projectId.length <= 256 &&
    projectId !== "__proto__" &&
    projectId !== "constructor" &&
    projectId !== "prototype" &&
    !/[\p{Cc}\p{Cf}]/u.test(projectId)
  );
}

function sanitizeWords(
  value: unknown,
  limit: number = DICTIONARY_LIMITS.wordsPerScope,
): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const keys = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const word = normalizeDictionaryWord(candidate);
    const key = dictionaryKey(word);
    if (!canStoreWord(word) || keys.has(key)) continue;
    keys.add(key);
    output.push(word);
    if (output.length >= limit) break;
  }
  return output;
}

function sanitizeProjectWords(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const output: Record<string, string[]> = {};
  let totalWords = 0;
  let scopes = 0;
  for (const [projectId, rawWords] of Object.entries(value)) {
    if (
      scopes >= DICTIONARY_LIMITS.projectScopes ||
      totalWords >= DICTIONARY_LIMITS.totalProjectWords ||
      !canStoreProjectId(projectId)
    ) {
      continue;
    }
    const words = sanitizeWords(
      rawWords,
      Math.min(
        DICTIONARY_LIMITS.wordsPerScope,
        DICTIONARY_LIMITS.totalProjectWords - totalWords,
      ),
    );
    if (words.length === 0) continue;
    output[projectId] = words;
    totalWords += words.length;
    scopes++;
  }
  return output;
}

export const useDictionary = create<DictionaryState>()(
  persist(
    (set) => ({
      ignored: {},
      global: [],
      ignore: (projectId, word) =>
        set((s) => {
          if (!canStoreProjectId(projectId)) return s;
          const w = normalizeDictionaryWord(word);
          if (!canStoreWord(w)) return s;
          const cur = s.ignored[projectId] ?? [];
          const totalProjectWords = Object.values(s.ignored).reduce(
            (total, words) => total + words.length,
            0,
          );
          if (
            cur.length >= DICTIONARY_LIMITS.wordsPerScope ||
            totalProjectWords >=
              DICTIONARY_LIMITS.totalProjectWords ||
            (!Object.hasOwn(s.ignored, projectId) &&
              Object.keys(s.ignored).length >=
                DICTIONARY_LIMITS.projectScopes) ||
            cur.some((item) => dictionaryKey(item) === dictionaryKey(w))
          ) {
            return s;
          }
          return { ignored: { ...s.ignored, [projectId]: [...cur, w] } };
        }),
      ignoreGlobal: (word) =>
        set((s) => {
          const w = normalizeDictionaryWord(word);
          if (
            !canStoreWord(w) ||
            s.global.length >= DICTIONARY_LIMITS.wordsPerScope ||
            s.global.some(
              (item) => dictionaryKey(item) === dictionaryKey(w),
            )
          ) {
            return s;
          }
          return { global: [...s.global, w] };
        }),
      unignore: (projectId, word) =>
        set((s) => ({
          ignored: {
            ...s.ignored,
            [projectId]: (s.ignored[projectId] ?? []).filter(
              (item) => dictionaryKey(item) !== dictionaryKey(word),
            ),
          },
        })),
      unignoreGlobal: (word) =>
        set((s) => ({
          global: s.global.filter(
            (item) => dictionaryKey(item) !== dictionaryKey(word),
          ),
        })),
      clear: (projectId) =>
        set((s) => {
          const next = { ...s.ignored };
          delete next[projectId];
          return { ignored: next };
        }),
      clearGlobal: () => set({ global: [] }),
      clearAll: () => set({ ignored: {}, global: [] }),
    }),
    {
      name: "oleafly.dictionary",
      storage: createJSONStorage(() =>
        typeof localStorage !== "undefined" ? localStorage : memoryStorage
      ),
      merge: (persisted, current) => {
        const value =
          persisted && typeof persisted === "object"
            ? (persisted as Record<string, unknown>)
            : {};
        return {
          ...current,
          global: sanitizeWords(value.global),
          ignored: sanitizeProjectWords(value.ignored),
        };
      },
    }
  )
);

export function isWordIgnored(projectId: string | null, word: string): boolean {
  const key = dictionaryKey(word);
  if (!key) return false;
  const s = useDictionary.getState();
  if (dictionarySet(s.global).has(key)) return true;
  if (
    projectId &&
    dictionarySet(s.ignored[projectId] ?? EMPTY_WORDS).has(key)
  ) {
    return true;
  }
  return false;
}

export function ignoreWordForProject(projectId: string | null, word: string): void {
  if (!projectId) return;
  useDictionary.getState().ignore(projectId, word);
}

export function ignoreWordGlobally(word: string): void {
  useDictionary.getState().ignoreGlobal(word);
}
