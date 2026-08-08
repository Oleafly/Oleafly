import { REDACTED_SECRET } from "@/lib/tauri";

export type KeyMap = Record<string, string>;

export function editableKeys(stored: KeyMap): KeyMap {
  return Object.fromEntries(
    Object.entries(stored).map(([id, value]) => [id, value === REDACTED_SECRET ? "" : value]),
  );
}

export function withKey(stored: KeyMap, id: string, value: string): KeyMap {
  return { ...stored, [id]: value };
}

export function withoutKey(stored: KeyMap, id: string): KeyMap {
  const next = { ...stored };
  delete next[id];
  return next;
}
