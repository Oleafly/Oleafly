import { defaultFilter } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { splitFrontMatter } from "@/lib/front-matter";
import { logError } from "@/lib/log";
import type { NoteSearchHit, NoteTagCount } from "@/lib/tauri";
import { mergeHits, type VaultPlan } from "./note-query";
import { useNotesData } from "./notes-data";
import type { NoteItem } from "./types";
import { useVaultKey, vaultLoad, vaultQuery } from "./vault-loads";

export const SEARCH_DEBOUNCE_MS = 120;
export const SEARCH_LIMIT = 50;
export const SWITCHER_LIMIT = 50;

const ALIAS_WEIGHT = 0.98;
const QUERY_SEPARATOR = "\u0001";

export interface HighlightPart {
  text: string;
  start: number;
  match: boolean;
}

export interface TagNode {
  tag: string;
  name: string;
  count: number;
  children: TagNode[];
}

export interface SwitcherMatch {
  note: NoteItem;
  alias: string | null;
}

export function phraseQuery(text: string): string {
  const phrase = text.replace(/"/gu, " ").replace(/\s+/gu, " ").trim();
  return phrase ? `"${phrase}"` : "";
}

export function highlightParts(text: string, ranges: readonly (readonly [number, number])[]): HighlightPart[] {
  const sorted = ranges
    .map(([start, end]) => [Math.max(0, start), Math.min(text.length, end)] as const)
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  const parts: HighlightPart[] = [];
  let at = 0;
  for (const [start, end] of sorted) {
    if (end <= at) continue;
    const from = Math.max(start, at);
    if (from > at) parts.push({ text: text.slice(at, from), start: at, match: false });
    parts.push({ text: text.slice(from, end), start: from, match: true });
    at = end;
  }
  if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at), start: at, match: false });
  return parts;
}

export function tagTree(tags: readonly NoteTagCount[]): TagNode[] {
  const nodes = new Map<string, { node: TagNode; notes: Set<string> }>();
  const roots: TagNode[] = [];
  for (const entry of tags) {
    const keys = entry.tag.split("/");
    const names = entry.label.split("/");
    keys.forEach((_part, index) => {
      const tag = keys.slice(0, index + 1).join("/");
      let found = nodes.get(tag);
      if (!found) {
        found = { node: { tag, name: names[index] ?? keys[index], count: 0, children: [] }, notes: new Set() };
        nodes.set(tag, found);
        const parent = index > 0 ? nodes.get(keys.slice(0, index).join("/")) : undefined;
        (parent ? parent.node.children : roots).push(found.node);
      }
      for (const note of entry.notes) found.notes.add(note);
    });
  }
  for (const { node, notes } of nodes.values()) node.count = notes.size;
  const sort = (list: TagNode[]) => {
    list.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function recency(note: NoteItem, opened: Readonly<Record<string, number>>): number {
  return opened[note.id] ?? 0;
}

export function switcherMatches(
  notes: readonly NoteItem[],
  query: string,
  opened: Readonly<Record<string, number>>,
  limit = SWITCHER_LIMIT,
): SwitcherMatch[] {
  const search = fold(query.trim());
  if (search === "") {
    return [...notes]
      .sort((left, right) => recency(right, opened) - recency(left, opened) || right.updatedAt - left.updatedAt)
      .slice(0, limit)
      .map((note) => ({ note, alias: null }));
  }
  const scored: { note: NoteItem; alias: string | null; score: number }[] = [];
  for (const note of notes) {
    let best = { alias: null as string | null, score: defaultFilter(fold(note.title), search) };
    for (const alias of note.aliases ?? []) {
      const score = defaultFilter(fold(alias), search) * ALIAS_WEIGHT;
      if (score > best.score) best = { alias, score };
    }
    if (best.score > 0) scored.push({ note, ...best });
  }
  return scored
    .sort(
      (left, right) =>
        right.score - left.score ||
        recency(right.note, opened) - recency(left.note, opened) ||
        right.note.updatedAt - left.note.updatedAt,
    )
    .slice(0, limit)
    .map(({ note, alias }) => ({ note, alias }));
}

export function hasExactTitle(notes: readonly NoteItem[], query: string): boolean {
  const wanted = fold(query.trim());
  return notes.some((note) => fold(note.title) === wanted || (note.aliases ?? []).some((alias) => fold(alias) === wanted));
}

export function useNoteTagCounts(): readonly NoteTagCount[] | null {
  const { noteTags } = useNotesData();
  const vault = useVaultKey();
  const [tags, setTags] = useState<readonly NoteTagCount[] | null>(null);
  useEffect(() => {
    if (!noteTags) return;
    let live = true;
    vaultLoad(noteTags, vault).then(
      (loaded) => {
        if (live) setTags(loaded);
      },
      (error: unknown) => void logError("read note tags", error),
    );
    return () => {
      live = false;
    };
  }, [noteTags, vault]);
  return tags;
}

export interface NoteSearchState {
  hits: readonly NoteSearchHit[] | null;
  pending: boolean;
}

interface SearchAnswer {
  readonly key: string;
  readonly plan: VaultPlan;
  readonly results: readonly (readonly NoteSearchHit[])[];
}

export function useVaultSearch(plan: VaultPlan, enabled: boolean, limit = SEARCH_LIMIT): NoteSearchState {
  const { notes, searchNotes } = useNotesData();
  const vault = useVaultKey();
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  const flight = useRef<Promise<unknown> | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;
  const active = enabled && searchNotes !== undefined && plan.branches.length > 0;
  const key = active ? plan.searches.join(QUERY_SEPARATOR) : "";
  useEffect(() => {
    const run = ++sequence.current;
    if (!active || !searchNotes) {
      setAnswer(null);
      setPending(false);
      return;
    }
    setPending(true);
    const queries = key === "" ? [] : key.split(QUERY_SEPARATOR);
    const start = () => {
      if (sequence.current !== run) return;
      const asked = planRef.current;
      const settle = (results: readonly (readonly NoteSearchHit[])[]) => {
        setAnswer({ key, plan: asked, results });
        setPending(false);
      };
      const running = Promise.all(
        queries.map((query) => vaultQuery(searchNotes, vault, `${limit}\u0000${query}`, () => searchNotes(query, limit))),
      ).then(
        (results) => {
          if (sequence.current === run) settle(results);
        },
        (error: unknown) => {
          if (sequence.current !== run) return;
          void logError("search notes", error);
          settle(queries.map(() => []));
        },
      );
      flight.current = running;
      void running.finally(() => {
        if (flight.current === running) flight.current = null;
      });
    };
    const timer = window.setTimeout(() => {
      const busy = flight.current;
      if (busy) void busy.then(start);
      else start();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, key, limit, searchNotes, vault]);
  const hits = useMemo(() => {
    if (!active || !answer) return null;
    return mergeHits(answer.key === key ? plan : answer.plan, answer.results, notes, limit);
  }, [active, answer, key, limit, notes, plan]);
  return { hits, pending: active && pending };
}

const PROTECTED = [
  /`+[^`]*`+/gu,
  /!?\[[^\]\n]*\]\([^)\n]*\)/gu,
  /<[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*>/gu,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/gu,
];
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})/u;
const CJK_START = 0x2e80;

function isWordy(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char) && (char.codePointAt(0) ?? 0) < CJK_START;
}

function foldedWithOrigin(line: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let index = 0;
  for (const char of line) {
    const part = fold(char);
    folded += part;
    for (let unit = 0; unit < part.length; unit++) origin.push(index);
    index += char.length;
  }
  origin.push(line.length);
  return { folded, origin };
}

function protectedRanges(line: string): [number, number][] {
  return PROTECTED.flatMap((pattern) => [...line.matchAll(pattern)].map((match): [number, number] => [match.index, match.index + match[0].length]));
}

function firstMention(line: string, names: readonly string[]): [number, number] | null {
  const { folded, origin } = foldedWithOrigin(line);
  const blocked = protectedRanges(line);
  let best: [number, number] | null = null;
  for (const name of names) {
    const needle = fold(name.trim());
    if (!needle) continue;
    let at = folded.indexOf(needle);
    while (at >= 0) {
      const start = origin[at];
      const end = Math.max(origin[at + needle.length - 1] + 1, origin[at + needle.length]);
      const text = line.slice(start, end);
      const bounded =
        (!isWordy(text[0]) || !isWordy(line[start - 1])) && (!isWordy(text.at(-1)) || !isWordy(line[end]));
      const free = !blocked.some(([from, to]) => start < to && from < end);
      if (bounded && free) {
        if (!best || start < best[0]) best = [start, end];
        break;
      }
      at = folded.indexOf(needle, at + 1);
    }
  }
  return best;
}

export function linkFirstMention(source: string, names: readonly string[], href: string): string | null {
  const head = source.slice(0, splitFrontMatter(source)?.bodyFrom ?? 0);
  const lines = source.slice(head.length).split("\n");
  let fence: string | null = null;
  for (const [index, line] of lines.entries()) {
    const marker = FENCE_LINE.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const found = firstMention(line, names);
    if (!found) continue;
    const [start, end] = found;
    const label = line.slice(start, end).replace(/[\\[\]]/gu, "\\$&");
    lines[index] = `${line.slice(0, start)}[${label}](${href})${line.slice(end)}`;
    return head + lines.join("\n");
  }
  return null;
}
