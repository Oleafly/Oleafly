import { useMemo, useRef } from "react";
import type { NoteItem } from "./types";

export function noteLookSignature(notes: readonly NoteItem[]): string {
  return notes
    .map((note) => [note.id, note.title, note.icon ?? "", note.color ?? "", (note.aliases ?? []).join("\u0002")].join("\u0000"))
    .join("\u0001");
}

export function useKeyedValue<T>(value: T, key: string): T {
  const kept = useRef({ key, value });
  if (kept.current.key !== key) kept.current = { key, value };
  return kept.current.value;
}

export function useNotesByLook(notes: readonly NoteItem[]): readonly NoteItem[] {
  const signature = useMemo(() => noteLookSignature(notes), [notes]);
  return useKeyedValue(notes, signature);
}
