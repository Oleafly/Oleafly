import { readJson, removeKey, writeJson } from "@/lib/local-storage";

const TRUSTED_KEY = "oleafly.notes.runBlocks";
const STARTING_KEY = "oleafly.notes.startingBlocks";
const TRUSTED_LIMIT = 500;

export interface BlockKey {
  note: string;
  hash: string;
}

interface Starting extends BlockKey {
  id: string;
}

const listeners = new Set<() => void>();
let trusted: BlockKey[] | null = null;
let paused: Set<string> | null = null;
let started = 0;

function isKey(value: unknown): value is BlockKey {
  if (!value || typeof value !== "object") return false;
  const { note, hash } = value as Record<string, unknown>;
  return typeof note === "string" && typeof hash === "string";
}

function isStarting(value: unknown): value is Starting {
  return isKey(value) && typeof (value as unknown as Record<string, unknown>).id === "string";
}

function readList<T>(key: string, valid: (value: unknown) => value is T): T[] {
  return readJson(key, [], (value) => (Array.isArray(value) ? value.filter(valid) : []));
}

function same(a: BlockKey, b: BlockKey): boolean {
  return a.note === b.note && a.hash === b.hash;
}

function trustList(): BlockKey[] {
  trusted ??= readList(TRUSTED_KEY, isKey);
  return trusted;
}

function saveTrust(list: BlockKey[]): void {
  trusted = list;
  writeJson(TRUSTED_KEY, list);
  for (const listener of listeners) listener();
}

function saveStarting(list: readonly Starting[]): void {
  if (list.length === 0) removeKey(STARTING_KEY);
  else writeJson(STARTING_KEY, list);
}

function pausedNotes(): Set<string> {
  if (paused) return paused;
  const left = readList(STARTING_KEY, isStarting);
  paused = new Set(left.map((item) => item.note));
  if (left.length > 0) {
    saveTrust(trustList().filter((item) => !left.some((start) => same(start, item))));
    saveStarting([]);
  }
  return paused;
}

export async function blockHash(kind: string, source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}\n${source}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function blockTrusted(key: BlockKey): boolean {
  return trustList().some((item) => same(item, key));
}

export function setBlockTrusted(key: BlockKey, trust: boolean): void {
  const rest = trustList().filter((item) => !same(item, key));
  saveTrust(trust ? [...rest, { note: key.note, hash: key.hash }].slice(-TRUSTED_LIMIT) : rest);
}

export function subscribeBlockTrust(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== TRUSTED_KEY) return;
    trusted = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function notePaused(note: string): boolean {
  return pausedNotes().has(note);
}

export function markBlockStarting(key: BlockKey): () => void {
  pausedNotes();
  started += 1;
  const id = `${Date.now().toString(36)}-${started}`;
  saveStarting([...readList(STARTING_KEY, isStarting), { note: key.note, hash: key.hash, id }]);
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    saveStarting(readList(STARTING_KEY, isStarting).filter((item) => item.id !== id));
  };
}

export function forgetNoteBlocks(note: string): void {
  pausedNotes().delete(note);
  saveStarting(readList(STARTING_KEY, isStarting).filter((item) => item.note !== note));
  saveTrust(trustList().filter((item) => item.note !== note));
}
