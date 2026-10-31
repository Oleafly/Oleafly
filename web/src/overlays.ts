import { ChangeSet } from "@codemirror/state";
import type { CollabCommentThread } from "@oleafly/backend-port";
import { diffOperation, editsFromOperation } from "@/features/collab/live/ot";
import type { CollabSuggestion, CollabSuggestionKind } from "./protocol";
import type { SessionEdit } from "./session";

export interface PlacedSuggestion {
  key: string;
  id: string | null;
  kind: CollabSuggestionKind;
  author: string;
  from: number;
  to: number;
  text: string;
  pending: boolean;
}

export interface PlacedThread {
  id: string;
  from: number;
  to: number;
  resolved: boolean;
}

export interface PlacedRange {
  from: number;
  to: number;
}

export interface OverlaySnapshot {
  suggestions: readonly PlacedSuggestion[];
  threads: readonly PlacedThread[];
  draft: PlacedRange | null;
}

export interface OverlaySession {
  readonly phase: string;
  readonly revision: number;
  readonly synchronized: boolean;
  confirmed(): string;
  text(): string;
}

export interface OverlayOptions {
  self: () => string | null;
  suggesting: () => boolean;
}

type Mapper = (position: number, assoc: -1 | 1) => number;

export type Placement =
  | { kind: "wait" }
  | { kind: "place"; map: Mapper; exact: boolean; unsent: ChangeSet | null; confirmed: string | null };

export function changesBetween(before: string, after: string): ChangeSet {
  return ChangeSet.of(editsFromOperation(diffOperation(before, after)), before.length, "\n");
}

export function mapRange(changes: ChangeSet, range: PlacedRange): PlacedRange {
  const from = changes.mapPos(range.from, 1);
  return { from, to: Math.max(from, changes.mapPos(range.to, -1)) };
}

function clampTo(length: number): (position: number) => number {
  return (position) => Math.max(0, Math.min(length, Math.trunc(position)));
}

export function placement(session: OverlaySession, rev: number | null): Placement {
  if (session.phase !== "open") return { kind: "wait" };
  if (rev !== null && rev > session.revision) return { kind: "wait" };
  const clamp = clampTo(session.text().length);
  if (rev === null || rev < session.revision) {
    return { kind: "place", map: (position) => clamp(position), exact: false, unsent: null, confirmed: null };
  }
  if (session.synchronized) {
    return { kind: "place", map: (position) => clamp(position), exact: true, unsent: null, confirmed: null };
  }
  const confirmed = session.confirmed();
  const unsent = changesBetween(confirmed, session.text());
  const inside = clampTo(confirmed.length);
  return {
    kind: "place",
    map: (position, assoc) => unsent.mapPos(inside(position), assoc),
    exact: true,
    unsent,
    confirmed,
  };
}

function coveredBy(from: number, to: number, cover: readonly PlacedRange[]): PlacedRange[] {
  const gaps: PlacedRange[] = [];
  let start = from;
  const sorted = cover.filter((range) => range.to > from && range.from < to).sort((a, b) => a.from - b.from);
  for (const range of sorted) {
    if (range.from > start) gaps.push({ from: start, to: Math.min(range.from, to) });
    start = Math.max(start, range.to);
    if (start >= to) break;
  }
  if (start < to) gaps.push({ from: start, to });
  return gaps;
}

export class FileOverlays {
  private suggestions: PlacedSuggestion[] = [];
  private optimistic: PlacedSuggestion[] = [];
  private threads: PlacedThread[] = [];
  private draft: PlacedRange | null = null;
  private pendingSuggestions: { rev: number | null; items: readonly CollabSuggestion[] } | null = null;
  private pendingThreads: { rev: number | null; items: readonly CollabCommentThread[] } | null = null;
  private readonly listeners = new Set<() => void>();
  private serial = 0;
  private cached: OverlaySnapshot | null = null;
  private readonly session: OverlaySession;
  private readonly options: OverlayOptions;

  constructor(session: OverlaySession, options: OverlayOptions) {
    this.session = session;
    this.options = options;
  }

  snapshot(): OverlaySnapshot {
    this.cached ??= {
      suggestions: [...this.suggestions, ...this.optimistic],
      threads: this.threads,
      draft: this.draft,
    };
    return this.cached;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setSuggestions(rev: number | null, items: readonly CollabSuggestion[]): void {
    this.pendingSuggestions = { rev, items };
    this.settle();
  }

  setThreads(rev: number | null, items: readonly CollabCommentThread[]): void {
    this.pendingThreads = { rev, items };
    this.settle();
  }

  setDraft(range: PlacedRange | null): void {
    this.draft = range ? { from: Math.min(range.from, range.to), to: Math.max(range.from, range.to) } : null;
    this.changed();
  }

  threadRange(id: string): PlacedRange | null {
    const thread = this.threads.find((entry) => entry.id === id);
    return thread ? { from: thread.from, to: thread.to } : null;
  }

  suggestionRange(id: string): PlacedRange | null {
    const suggestion = this.suggestions.find((entry) => entry.id === id);
    return suggestion ? { from: suggestion.from, to: suggestion.to } : null;
  }

  settle(): void {
    let moved = false;
    if (this.pendingSuggestions && this.placeSuggestions(this.pendingSuggestions)) {
      this.pendingSuggestions = null;
      moved = true;
    }
    if (this.pendingThreads && this.placeThreads(this.pendingThreads)) {
      this.pendingThreads = null;
      moved = true;
    }
    if (moved) this.changed();
  }

  edit(edit: SessionEdit): void {
    let changes: ChangeSet;
    try {
      changes = ChangeSet.of(
        edit.edits.map((change) => ({ from: change.from, to: change.to, insert: change.insert })),
        edit.before.length,
        "\n",
      );
    } catch {
      this.suggestions = [];
      this.optimistic = [];
      this.threads = [];
      this.draft = null;
      this.changed();
      return;
    }
    const suggesting = edit.local && this.options.suggesting();
    const own = suggesting ? this.ownInsertions() : [];
    this.suggestions = this.mapSuggestions(this.suggestions, changes);
    this.optimistic = this.mapSuggestions(this.optimistic, changes);
    this.threads = this.threads.map((thread) => ({ ...thread, ...mapRange(changes, thread) }));
    if (this.draft) this.draft = mapRange(changes, this.draft);
    if (suggesting) this.optimistic.push(...this.suggestionsFrom(changes, edit.before, own));
    this.changed();
    this.settle();
  }

  private ownInsertions(): PlacedRange[] {
    const self = this.options.self();
    return [...this.suggestions, ...this.optimistic]
      .filter((entry) => entry.kind === "insert" && entry.author === self)
      .map((entry) => ({ from: entry.from, to: entry.to }));
  }

  private mapSuggestions(entries: readonly PlacedSuggestion[], changes: ChangeSet): PlacedSuggestion[] {
    const mapped: PlacedSuggestion[] = [];
    for (const entry of entries) {
      if (entry.kind === "delete") {
        const at = changes.mapPos(entry.from, -1);
        mapped.push({ ...entry, from: at, to: at });
        continue;
      }
      const from = changes.mapPos(entry.from, 1);
      const to = changes.mapPos(entry.to, -1);
      if (to > from) mapped.push({ ...entry, from, to });
    }
    return mapped;
  }

  private suggestionsFrom(changes: ChangeSet, before: string, own: readonly PlacedRange[]): PlacedSuggestion[] {
    const author = this.options.self() ?? "";
    const made: PlacedSuggestion[] = [];
    changes.iterChanges((fromA, toA, fromB, toB) => {
      if (toA > fromA) {
        const removed = coveredBy(fromA, toA, own)
          .map((gap) => before.slice(gap.from, gap.to))
          .join("");
        if (removed) made.push(this.local("delete", author, fromB, fromB, removed));
      }
      if (toB > fromB) made.push(this.local("insert", author, fromB, toB, ""));
    });
    return made;
  }

  private local(kind: CollabSuggestionKind, author: string, from: number, to: number, text: string): PlacedSuggestion {
    this.serial += 1;
    return { key: `local-${this.serial}`, id: null, kind, author, from, to, text, pending: true };
  }

  private placeSuggestions(frame: { rev: number | null; items: readonly CollabSuggestion[] }): boolean {
    const place = placement(this.session, frame.rev);
    if (place.kind === "wait") return false;
    const placed: PlacedSuggestion[] = [];
    for (const item of frame.items) {
      if (item.kind === "delete") {
        const at = place.map(item.from, -1);
        placed.push({ key: item.id, id: item.id, kind: "delete", author: item.author, from: at, to: at, text: item.text, pending: false });
        continue;
      }
      const from = place.map(item.from, 1);
      const to = place.map(item.to, -1);
      if (to > from) {
        placed.push({ key: item.id, id: item.id, kind: "insert", author: item.author, from, to, text: item.text, pending: false });
      }
    }
    if (place.exact) {
      const self = this.options.self();
      const own = frame.items
        .filter((item) => item.kind === "insert" && item.author === self)
        .map((item) => ({ from: item.from, to: item.to }));
      this.optimistic =
        place.unsent && place.confirmed !== null && this.options.suggesting()
          ? this.suggestionsFrom(place.unsent, place.confirmed, own)
          : [];
    }
    this.suggestions = placed;
    return true;
  }

  private placeThreads(frame: { rev: number | null; items: readonly CollabCommentThread[] }): boolean {
    const place = placement(this.session, frame.rev);
    if (place.kind === "wait") return false;
    const placed: PlacedThread[] = [];
    for (const thread of frame.items) {
      const range = thread.anchor.range;
      if (!range) continue;
      const from = place.map(range.from, 1);
      const to = Math.max(from, place.map(range.to, -1));
      placed.push({ id: thread.id, from, to, resolved: thread.resolved !== null });
    }
    this.threads = placed;
    return true;
  }

  private changed(): void {
    this.cached = null;
    for (const listener of Array.from(this.listeners)) listener();
  }
}
