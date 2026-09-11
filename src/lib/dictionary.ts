import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { useToastStore } from "@/store/toast";

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
  suppressed: Record<string, string[]>;
  revision: number;
  ignore: (projectId: string, word: string) => void;
  ignoreGlobal: (word: string) => void;
  unignore: (projectId: string, word: string) => void;
  unignoreGlobal: (word: string) => void;
  suppress: (projectId: string, key: string) => void;
  unsuppress: (projectId: string, key: string) => void;
  clearSuppressed: (projectId: string) => void;
  clear: (projectId: string) => void;
  clearGlobal: () => void;
  clearAll: () => void;
}

export const DICTIONARY_LIMITS = {
  wordsPerScope: 5_000,
  wordCharacters: 128,
  projectScopes: 256,
  totalProjectWords: 20_000,
  suppressionsPerProject: 500,
  suppressionCharacters: 320,
} as const;

export type DictionaryWriteOutcome =
  | "stored"
  | "duplicate"
  | "unsupported_word"
  | "limit_reached"
  | "no_project";

type DictionaryNotice = (message: string) => void;

let notice: DictionaryNotice = (message) =>
  useToastStore.getState().push("info", message);

export function setDictionaryNotice(next: DictionaryNotice | null): void {
  notice =
    next ??
    ((message) => useToastStore.getState().push("info", message));
}

function announceProofreadingChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("oleafly:proofreading-settings-changed", {
      detail: { setting: "suppressions" },
    }),
  );
}

function reportDictionaryOutcome(
  outcome: DictionaryWriteOutcome,
): DictionaryWriteOutcome {
  if (outcome === "unsupported_word") {
    notice(
      `That is too long to save as a word, so it is hidden in this document instead. A word can be up to ${DICTIONARY_LIMITS.wordCharacters} characters.`,
    );
  } else if (outcome === "limit_reached") {
    notice(
      "Your dictionary is full, so that word is hidden in this document instead. Remove one in Settings to save it.",
    );
  }
  return outcome;
}

export function normalizeDictionaryWord(word: string): string {
  return word
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
}

export function dictionaryWordFromSelection(word: string): string {
  return normalizeDictionaryWord(
    word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""),
  );
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

export function canStoreWord(word: string): boolean {
  return (
    word.length > 0 &&
    word.length <= DICTIONARY_LIMITS.wordCharacters &&
    !/[\p{Cc}\p{Cf}]/u.test(word)
  );
}

function canStoreSuppression(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= DICTIONARY_LIMITS.suppressionCharacters &&
    !/[\p{Cc}\p{Cf}]/u.test(key)
  );
}

function sanitizeSuppressions(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string[]> = {};
  let scopes = 0;
  for (const [projectId, raw] of Object.entries(value)) {
    if (scopes >= DICTIONARY_LIMITS.projectScopes) break;
    if (!canStoreProjectId(projectId) || !Array.isArray(raw)) continue;
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const candidate of raw) {
      if (typeof candidate !== "string") continue;
      if (!canStoreSuppression(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      keys.push(candidate);
      if (keys.length >= DICTIONARY_LIMITS.suppressionsPerProject) break;
    }
    if (keys.length === 0) continue;
    output[projectId] = keys;
    scopes++;
  }
  return output;
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
      suppressed: {},
      revision: 0,
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
          return {
            ignored: { ...s.ignored, [projectId]: [...cur, w] },
            revision: s.revision + 1,
          };
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
          return { global: [...s.global, w], revision: s.revision + 1 };
        }),
      unignore: (projectId, word) =>
        set((s) => ({
          ignored: {
            ...s.ignored,
            [projectId]: (s.ignored[projectId] ?? []).filter(
              (item) => dictionaryKey(item) !== dictionaryKey(word),
            ),
          },
          revision: s.revision + 1,
        })),
      unignoreGlobal: (word) =>
        set((s) => ({
          global: s.global.filter(
            (item) => dictionaryKey(item) !== dictionaryKey(word),
          ),
          revision: s.revision + 1,
        })),
      suppress: (projectId, key) =>
        set((s) => {
          if (!canStoreProjectId(projectId) || !canStoreSuppression(key)) {
            return s;
          }
          const current = s.suppressed[projectId] ?? [];
          if (
            current.includes(key) ||
            current.length >= DICTIONARY_LIMITS.suppressionsPerProject
          ) {
            return s;
          }
          return {
            suppressed: {
              ...s.suppressed,
              [projectId]: [...current, key],
            },
            revision: s.revision + 1,
          };
        }),
      unsuppress: (projectId, key) => {
        set((s) => ({
          suppressed: {
            ...s.suppressed,
            [projectId]: (s.suppressed[projectId] ?? []).filter(
              (item) => item !== key,
            ),
          },
          revision: s.revision + 1,
        }));
        announceProofreadingChange();
      },
      clearSuppressed: (projectId) => {
        set((s) => {
          const next = { ...s.suppressed };
          delete next[projectId];
          return { suppressed: next, revision: s.revision + 1 };
        });
        announceProofreadingChange();
      },
      clear: (projectId) =>
        set((s) => {
          const next = { ...s.ignored };
          delete next[projectId];
          return { ignored: next, revision: s.revision + 1 };
        }),
      clearGlobal: () =>
        set((s) => ({ global: [], revision: s.revision + 1 })),
      clearAll: () =>
        set((s) => ({
          ignored: {},
          global: [],
          suppressed: {},
          revision: s.revision + 1,
        })),
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
          suppressed: sanitizeSuppressions(value.suppressed),
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

export function ignoreWordForProject(
  projectId: string | null,
  word: string,
): DictionaryWriteOutcome {
  if (!projectId) return "no_project";
  const normalized = dictionaryWordFromSelection(word);
  if (!canStoreWord(normalized)) {
    return reportDictionaryOutcome("unsupported_word");
  }
  if (isWordIgnored(projectId, normalized)) return "duplicate";
  useDictionary.getState().ignore(projectId, normalized);
  return reportDictionaryOutcome(
    isWordIgnored(projectId, normalized) ? "stored" : "limit_reached",
  );
}

export function ignoreWordGlobally(word: string): DictionaryWriteOutcome {
  const normalized = dictionaryWordFromSelection(word);
  if (!canStoreWord(normalized)) {
    return reportDictionaryOutcome("unsupported_word");
  }
  if (isWordIgnored(null, normalized)) return "duplicate";
  useDictionary.getState().ignoreGlobal(normalized);
  return reportDictionaryOutcome(
    isWordIgnored(null, normalized) ? "stored" : "limit_reached",
  );
}

export function suppressGrammarFinding(
  projectId: string | null,
  key: string,
): boolean {
  if (!projectId) return false;
  useDictionary.getState().suppress(projectId, key);
  announceProofreadingChange();
  return isGrammarFindingSuppressed(projectId, key);
}

export function isGrammarFindingSuppressed(
  projectId: string | null,
  key: string,
): boolean {
  if (!projectId) return false;
  return (
    useDictionary.getState().suppressed[projectId]?.includes(key) ?? false
  );
}

export function grammarSuppressionsFor(
  projectId: string | null,
): string[] {
  if (!projectId) return EMPTY_WORDS;
  return useDictionary.getState().suppressed[projectId] ?? EMPTY_WORDS;
}
