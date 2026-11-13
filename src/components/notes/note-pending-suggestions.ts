import { useSyncExternalStore } from "react";
import { createEmitter } from "@/lib/emitter";
import { readString, removeKey, writeString } from "@/lib/local-storage";
import { myersEditScript } from "@/lib/myers-diff";
import { forgetNoteBlocks } from "./block-trust";
import { applyNoteEdits, type NoteEdit } from "./note-edits";
import { indexedUndoStore } from "./note-undo-store";

export interface NoteEditorLink {
  readSource: () => string;
  propose: (edits: readonly NoteEdit[]) => number;
  pending: () => number;
}

const STORAGE_KEY = "oleafly.notes.pendingSuggestions";
const MAX_STORED_CHARS = 1_000_000;

const editors = new Map<string, NoteEditorLink[]>();
const changes = createEmitter();
let batches: Map<string, NoteEdit[][]> | null = null;
let waiting: ReadonlySet<string> | null = null;

function isEdit(value: unknown): value is NoteEdit {
  if (!value || typeof value !== "object") return false;
  const edit = value as Record<string, unknown>;
  return typeof edit.find === "string" && typeof edit.replace === "string";
}

function readStored(): Map<string, NoteEdit[][]> {
  try {
    const parsed: unknown = JSON.parse(readString(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const stored = new Map<string, NoteEdit[][]>();
    for (const [noteId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const kept = value.filter((batch): batch is NoteEdit[] => Array.isArray(batch) && batch.length > 0 && batch.every(isEdit));
      if (kept.length > 0) stored.set(noteId, kept);
    }
    return stored;
  } catch {
    return new Map();
  }
}

function stored(): Map<string, NoteEdit[][]> {
  batches ??= readStored();
  return batches;
}

function changed(): void {
  waiting = null;
  changes.emit();
}

function persist(): void {
  changed();
  const entries = [...stored()];
  let text = JSON.stringify(Object.fromEntries(entries));
  while (text.length > MAX_STORED_CHARS && entries.length > 1) {
    entries.shift();
    text = JSON.stringify(Object.fromEntries(entries));
  }
  if (entries.length === 0) removeKey(STORAGE_KEY);
  else writeString(STORAGE_KEY, text);
}

export function registerNoteEditor(noteId: string, link: NoteEditorLink): () => void {
  editors.set(noteId, [...(editors.get(noteId) ?? []).filter((open) => open !== link), link]);
  return () => {
    const left = (editors.get(noteId) ?? []).filter((open) => open !== link);
    if (left.length > 0) editors.set(noteId, left);
    else editors.delete(noteId);
  };
}

export function noteEditorLink(noteId: string): NoteEditorLink | null {
  return editors.get(noteId)?.at(-1) ?? null;
}

export function pendingBatches(noteId: string): readonly (readonly NoteEdit[])[] {
  return stored().get(noteId) ?? [];
}

export function proposeNoteEdits(noteId: string, edits: readonly NoteEdit[]): number {
  const open = noteEditorLink(noteId);
  if (open) return open.propose(edits);
  addPendingBatch(noteId, edits);
  return edits.length;
}

export function reviewedNoteSource(noteId: string, load: () => Promise<{ text: string }>): string | Promise<string> {
  return noteEditorLink(noteId)?.readSource() ?? load().then((saved) => withPendingEdits(saved.text, pendingBatches(noteId)));
}

export function addPendingBatch(noteId: string, edits: readonly NoteEdit[], first = false): void {
  if (edits.length === 0) return;
  const current = stored().get(noteId) ?? [];
  const batch = edits.map(({ find, replace }) => ({ find, replace }));
  stored().delete(noteId);
  stored().set(noteId, first ? [batch, ...current] : [...current, batch]);
  persist();
}

export function takePendingBatches(noteId: string): NoteEdit[][] {
  const taken = stored().get(noteId) ?? [];
  if (taken.length === 0) return [];
  stored().delete(noteId);
  persist();
  return taken;
}

export interface KeptReview {
  file: NoteEdit[];
  proposed: NoteEdit[];
}

const keptKeys = (noteId: string) => [`${noteId}#file`, `${noteId}#proposed`] as const;

export function keptReview(noteId: string): KeptReview {
  const [file, proposed] = keptKeys(noteId).map((key) => stored().get(key)?.[0] ?? []);
  return { file, proposed };
}

export function keepReview(noteId: string, kept: KeptReview | null): void {
  const keys = keptKeys(noteId);
  const before = JSON.stringify(keys.map((key) => stored().get(key)));
  keys.forEach((key, index) => {
    const edits = (index === 0 ? kept?.file : kept?.proposed) ?? [];
    if (edits.length > 0) stored().set(key, [edits.map(({ find, replace }) => ({ find, replace }))]);
    else stored().delete(key);
  });
  if (JSON.stringify(keys.map((key) => stored().get(key))) !== before) persist();
}

export function forgetNoteLeftovers(noteId: string): void {
  takePendingBatches(noteId);
  keepReview(noteId, null);
  forgetNoteBlocks(noteId);
  void indexedUndoStore.remove(noteId);
}

export function withPendingEdits(text: string, pending: readonly (readonly NoteEdit[])[]): string {
  return pending.reduce((current, batch) => applyNoteEdits(current, batch).text, text);
}

export function notesWithSuggestions(): ReadonlySet<string> {
  waiting ??= new Set([...stored().keys()].map((key) => key.split("#")[0]));
  return waiting;
}

export function useWaitingSuggestions(noteId: string): boolean {
  return useSyncExternalStore(changes.subscribe, () => notesWithSuggestions().has(noteId));
}

export function resetPendingSuggestionsForTest(): void {
  batches = null;
  editors.clear();
  changed();
}

interface Hunk {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

function hunksOf(oldLines: readonly string[], newLines: readonly string[]): Hunk[] | null {
  const script = myersEditScript(oldLines, newLines);
  if (!script) return null;
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  for (const step of script) {
    if (step.kind === "same") {
      open = null;
      continue;
    }
    if (!open) {
      open = { oldStart: step.oldStart, oldEnd: step.oldStart, newStart: step.newStart, newEnd: step.newStart };
      hunks.push(open);
    }
    if (step.kind === "del") open.oldEnd = step.oldStart + step.length;
    else open.newEnd = step.newStart + step.length;
  }
  return hunks;
}

function occursOnce(text: string, find: string): boolean {
  const first = text.indexOf(find);
  return first >= 0 && !text.includes(find, first + 1);
}

function placed(
  base: string,
  oldLines: readonly string[],
  newLines: readonly string[],
  hunk: Hunk,
  low: number,
  high: number,
): { edit: NoteEdit; end: number } | null {
  for (let grow = 0; ; grow += 1) {
    const before = Math.min(grow, hunk.oldStart - low);
    const after = Math.min(grow, high - hunk.oldEnd);
    const find = oldLines.slice(hunk.oldStart - before, hunk.oldEnd + after).join("\n");
    const keepsBreaks = hunk.newEnd > hunk.newStart || before + after > 0;
    if (find !== "" && keepsBreaks && occursOnce(base, find)) {
      const replace = [
        ...oldLines.slice(hunk.oldStart - before, hunk.oldStart),
        ...newLines.slice(hunk.newStart, hunk.newEnd),
        ...oldLines.slice(hunk.oldEnd, hunk.oldEnd + after),
      ].join("\n");
      return { edit: { find, replace }, end: hunk.oldEnd + after };
    }
    if (before === hunk.oldStart - low && after === high - hunk.oldEnd) return null;
  }
}

function joined(first: Hunk, second: Hunk): Hunk {
  return { oldStart: first.oldStart, oldEnd: second.oldEnd, newStart: first.newStart, newEnd: second.newEnd };
}

export function editsBetween(base: string, target: string): NoteEdit[] {
  if (base === target) return [];
  const whole = [{ find: base, replace: target }];
  const oldLines = base.split("\n");
  const newLines = target.split("\n");
  const hunks = hunksOf(oldLines, newLines);
  if (!hunks) return whole;
  const edits: NoteEdit[] = [];
  const ends: number[] = [];
  let index = 0;
  while (index < hunks.length) {
    const high = index + 1 < hunks.length ? hunks[index + 1].oldStart : oldLines.length;
    const found = placed(base, oldLines, newLines, hunks[index], ends.at(-1) ?? 0, high);
    if (found) {
      edits.push(found.edit);
      ends.push(found.end);
      index += 1;
    } else if (index + 1 < hunks.length) {
      hunks.splice(index, 2, joined(hunks[index], hunks[index + 1]));
    } else if (index > 0) {
      edits.pop();
      ends.pop();
      hunks.splice(index - 1, 2, joined(hunks[index - 1], hunks[index]));
      index -= 1;
    } else {
      return whole;
    }
  }
  return edits;
}
