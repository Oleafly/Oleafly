import { useRef } from "react";
import { sameValue } from "@/lib/same-value";
import type { NoteItem } from "./types";

function sameLook(left: NoteItem | undefined, right: NoteItem): boolean {
  if (left === right) return true;
  return left?.id === right.id && left.title === right.title && left.icon === right.icon && left.color === right.color && sameValue(left.aliases, right.aliases);
}

export function useNotesByLook(notes: readonly NoteItem[]): readonly NoteItem[] {
  const kept = useRef(notes);
  const last = kept.current;
  if (last !== notes && (last.length !== notes.length || notes.some((note, index) => !sameLook(last[index], note)))) kept.current = notes;
  return kept.current;
}
