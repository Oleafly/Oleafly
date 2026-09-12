import { trimToLetters } from "./word-edges";
export const BUILTIN_PROOFREADING_WORDS = new Set([
  "api",
  "argv",
  "backend",
  "begin",
  "bibtex",
  "boolean",
  "config",
  "end",
  "enum",
  "filename",
  "frontend",
  "href",
  "ieee",
  "inline",
  "latex",
  "localhost",
  "luatex",
  "pdf",
  "pdflatex",
  "stdin",
  "stdout",
  "string",
  "tectonic",
  "tex",
  "url",
  "xelatex",
  "xetex",
]);

export function isSessionIgnoredWord(word: string): boolean {
  const normalized = word
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
  if (BUILTIN_PROOFREADING_WORDS.has(normalized)) return true;
  if (/\d/u.test(word)) return true;
  return (
    word.length >= 2 &&
    word === word.toLocaleUpperCase("en-US") &&
    /\p{Lu}/u.test(word)
  );
}

const ignoredHere = new Map<string, Set<string>>();
const suppressedHere = new Map<string, Set<string>>();

function scopeKey(projectId: string | null, path: string): string {
  return `${projectId ?? ""}\u0000${path}`;
}

function hereKey(word: string): string {
  return trimToLetters(word.normalize("NFKC")).trim().toLocaleLowerCase("en-US");
}

function remember(
  store: Map<string, Set<string>>,
  scope: string,
  value: string,
): void {
  const existing = store.get(scope);
  if (existing) existing.add(value);
  else store.set(scope, new Set([value]));
}

export function ignoreWordHere(
  projectId: string | null,
  path: string,
  word: string,
): void {
  const key = hereKey(word);
  if (!key) return;
  remember(ignoredHere, scopeKey(projectId, path), key);
}

export function isWordIgnoredHere(
  projectId: string | null,
  path: string,
  word: string,
): boolean {
  const key = hereKey(word);
  if (!key) return false;
  return ignoredHere.get(scopeKey(projectId, path))?.has(key) ?? false;
}

export function suppressFindingHere(
  projectId: string | null,
  path: string,
  key: string,
): void {
  if (!key) return;
  remember(suppressedHere, scopeKey(projectId, path), key);
}

export function isFindingSuppressedHere(
  projectId: string | null,
  path: string,
  key: string,
): boolean {
  if (!key) return false;
  return suppressedHere.get(scopeKey(projectId, path))?.has(key) ?? false;
}

function forget(
  store: Map<string, Set<string>>,
  matches: (value: string) => boolean,
): void {
  for (const [scope, values] of store) {
    for (const value of values) {
      if (matches(value)) values.delete(value);
    }
    if (values.size === 0) store.delete(scope);
  }
}

export function forgetWordIgnoredHere(word: string): void {
  const key = hereKey(word);
  if (!key) return;
  forget(ignoredHere, (value) => value === key);
}

export function forgetFindingSuppressedHere(key: string): void {
  if (!key) return;
  forget(suppressedHere, (value) => value === key);
}

export function forgetRuleSuppressedHere(rule: string): void {
  if (!rule) return;
  const prefix = `${rule}:`;
  forget(suppressedHere, (value) => value.startsWith(prefix));
}

export function clearWordsIgnoredHere(
  projectId?: string | null,
  path?: string,
): void {
  if (projectId === undefined) {
    ignoredHere.clear();
    suppressedHere.clear();
    return;
  }
  if (path === undefined) {
    const prefix = `${projectId ?? ""}\u0000`;
    for (const store of [ignoredHere, suppressedHere]) {
      for (const scope of store.keys()) {
        if (scope.startsWith(prefix)) store.delete(scope);
      }
    }
    return;
  }
  const scope = scopeKey(projectId, path);
  ignoredHere.delete(scope);
  suppressedHere.delete(scope);
}
