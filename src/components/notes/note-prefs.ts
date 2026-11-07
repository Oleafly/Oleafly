import { useSyncExternalStore } from "react";

export type NoteWidth = "standard" | "wide" | "full";

export const NOTE_WIDTHS: readonly NoteWidth[] = ["standard", "wide", "full"];
export const NOTE_WIDTH_KEY = "oleafly.notes.width";
export const PROMPT_COLLAPSED_KEY = "oleafly.notes.promptCollapsed";

const memory = new Map<string, string>();
const widthListeners = new Set<() => void>();

function read(key: string): string | null {
  const kept = memory.get(key);
  if (kept !== undefined) return kept;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
}

export function readNoteWidth(): NoteWidth {
  const saved = read(NOTE_WIDTH_KEY);
  return NOTE_WIDTHS.find((width) => width === saved) ?? "standard";
}

export function saveNoteWidth(width: NoteWidth): void {
  write(NOTE_WIDTH_KEY, width);
  for (const listener of widthListeners) listener();
}

function subscribeWidth(listener: () => void): () => void {
  widthListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === NOTE_WIDTH_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    widthListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useNoteWidth(): NoteWidth {
  return useSyncExternalStore(subscribeWidth, readNoteWidth, readNoteWidth);
}

export function readPromptCollapsed(): boolean {
  return read(PROMPT_COLLAPSED_KEY) === "true";
}

export function savePromptCollapsed(collapsed: boolean): void {
  write(PROMPT_COLLAPSED_KEY, String(collapsed));
}
