import { useQueries } from "@tanstack/react-query";
import { normalizeText } from "@oleafly/search-query";
import { defaultFilter } from "cmdk";
import { useMemo, useRef } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fencedLines } from "@/lib/code-fences";
import { splitFrontMatter } from "@/lib/front-matter";
import { describeError } from "@/lib/app-error";
import { appQueryClient } from "@/lib/query";
import type { NoteSearchHit, NoteSearchOptions, NoteTagCount } from "@/lib/tauri";
import { scanToCharOrLineBreak } from "./note-link-format";
import { mergeHits, type VaultPlan } from "./note-query";
import { useNotesData, useVaultKey, useVaultLoad, VAULT_QUERY } from "./notes-data";
import type { NoteItem } from "./types";

export const SEARCH_DEBOUNCE_MS = 120;
export const SEARCH_LIMIT = 50;
export const SWITCHER_LIMIT = 50;

const ALIAS_WEIGHT = 0.98;
const QUERY_SEPARATOR = "\u0001";
const NO_HITS: readonly NoteSearchHit[] = [];

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
  const phrase = text.replaceAll('"', " ").replaceAll(/\s+/gu, " ").trim();
  return phrase ? `"${phrase}"` : "";
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

const FOLDED = new WeakMap<NoteItem, readonly [string, ...string[]]>();

function foldedNames(note: NoteItem): readonly [string, ...string[]] {
  let names = FOLDED.get(note);
  if (!names) {
    names = [normalizeText(note.title), ...(note.aliases ?? []).map(normalizeText)];
    FOLDED.set(note, names);
  }
  return names;
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
  const search = normalizeText(query.trim());
  if (search === "") {
    return [...notes]
      .sort((left, right) => recency(right, opened) - recency(left, opened) || right.updatedAt - left.updatedAt)
      .slice(0, limit)
      .map((note) => ({ note, alias: null }));
  }
  const scored: { note: NoteItem; alias: string | null; score: number }[] = [];
  const lead = /[\s-]/.test(search[0]) ? "" : search[0];
  for (const note of notes) {
    const [title, ...aliases] = foldedNames(note);
    let best = { alias: null as string | null, score: title.includes(lead) ? defaultFilter(title, search) : 0 };
    aliases.forEach((alias, index) => {
      if (!alias.includes(lead)) return;
      const score = defaultFilter(alias, search) * ALIAS_WEIGHT;
      if (score > best.score) best = { alias: note.aliases?.[index] ?? null, score };
    });
    if (best.score > 0) scored.push({ note, ...best });
  }
  scored.sort(
    (left, right) =>
      right.score - left.score || recency(right.note, opened) - recency(left.note, opened) || right.note.updatedAt - left.note.updatedAt,
  );
  return scored.slice(0, limit).map(({ note, alias }) => ({ note, alias }));
}

export function hasExactTitle(notes: readonly NoteItem[], query: string): boolean {
  const wanted = normalizeText(query.trim());
  return notes.some((note) => normalizeText(note.title) === wanted || (note.aliases ?? []).some((alias) => normalizeText(alias) === wanted));
}

export function useNoteTagCounts(): readonly NoteTagCount[] | null {
  return useVaultLoad("tags", useNotesData().noteTags).data;
}

export interface NoteSearchState {
  hits: readonly NoteSearchHit[] | null;
  pending: boolean;
  error?: string | null;
}

interface SearchAnswer {
  readonly plan: VaultPlan;
  readonly results: readonly (readonly NoteSearchHit[])[];
}

const NO_OPTIONS: NoteSearchOptions = {};

export function useVaultSearch(plan: VaultPlan, enabled: boolean, limit = SEARCH_LIMIT, options: NoteSearchOptions = NO_OPTIONS): NoteSearchState {
  const { notes, searchNotes } = useNotesData();
  const active = enabled && searchNotes !== undefined && plan.branches.length > 0;
  const mode = options.mode ?? "ranked";
  const blocks = options.blocks === true;
  const key = active ? `${mode}${QUERY_SEPARATOR}${String(blocks)}${QUERY_SEPARATOR}${plan.searches.join(QUERY_SEPARATOR)}` : "";
  const settled = useDebouncedValue(key, SEARCH_DEBOUNCE_MS);
  const ready = active && settled === key;
  const base = useVaultKey("search", searchNotes, limit, mode, blocks);
  const results = useQueries(
    {
      queries: (ready ? plan.searches : []).map((search) => ({
        queryKey: [...base, search],
        queryFn: () => {
          if (!searchNotes) return Promise.resolve([]);
          return mode === "ranked" && !blocks ? searchNotes(search, limit) : searchNotes(search, limit, { mode, blocks });
        },
        ...VAULT_QUERY,
        retry: false,
      })),
    },
    appQueryClient(),
  );
  const done = ready && results.every((result) => !result.isPending);
  const answer = useRef<SearchAnswer | null>(null);
  const found = results.map((result) => result.data ?? NO_HITS);
  if (!active) answer.current = null;
  else if (done && (answer.current?.plan !== plan || found.some((hits, index) => hits !== answer.current?.results[index]))) {
    answer.current = { plan, results: found };
  }
  const shown = answer.current;
  const hits = useMemo(() => (shown ? mergeHits(shown.plan, shown.results, notes, limit) : null), [limit, notes, shown]);
  const failed = ready ? results.find((result) => result.error)?.error : undefined;
  return failed ? { hits, pending: active && !done, error: describeError(failed) } : { hits, pending: active && !done };
}

const CODE_SPAN = /`+[^`]*`+/gu;
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*>/gu;
const ASCII_LETTER = /[A-Za-z]/u;
const SCHEME_CHAR = /[A-Za-z0-9+.-]/u;
const NON_SPACE = /\S/u;
const CJK_START = 0x2e80;

function isWordy(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char) && (char.codePointAt(0) ?? 0) < CJK_START;
}

function foldedWithOrigin(line: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let index = 0;
  for (const char of line) {
    const part = normalizeText(char);
    folded += part;
    origin.push(...Array.from({ length: part.length }, () => index));
    index += char.length;
  }
  origin.push(line.length);
  return { folded, origin };
}

function matchRanges(line: string, pattern: RegExp): [number, number][] {
  return [...line.matchAll(pattern)].map((match): [number, number] => [match.index, match.index + match[0].length]);
}

function linkRanges(line: string): [number, number][] {
  const ranges: [number, number][] = [];
  let from = 0;
  let open = line.indexOf("[");
  while (open >= 0) {
    const close = scanToCharOrLineBreak(line, open + 1, "]");
    let next = close + 1;
    if (line[close] === "]" && line[close + 1] === "(") {
      const end = scanToCharOrLineBreak(line, close + 2, ")");
      if (line[end] === ")") {
        ranges.push([open > from && line[open - 1] === "!" ? open - 1 : open, end + 1]);
        from = end + 1;
      }
      next = end + 1;
    }
    open = line.indexOf("[", next);
  }
  return ranges;
}

function runEnd(text: string, from: number, pattern: RegExp): number {
  let end = from;
  while (end < text.length && pattern.test(text[end])) end += 1;
  return end;
}

function schemeStart(line: string, floor: number, mark: number): number {
  let start = mark;
  while (start > floor && SCHEME_CHAR.test(line[start - 1])) start -= 1;
  while (start < mark && !ASCII_LETTER.test(line[start])) start += 1;
  return start < mark ? start : -1;
}

function urlRanges(line: string): [number, number][] {
  const ranges: [number, number][] = [];
  let from = 0;
  for (let mark = line.indexOf("://"); mark >= 0; mark = line.indexOf("://", Math.max(mark + 1, from))) {
    const start = schemeStart(line, from, mark);
    if (start < 0) continue;
    const end = runEnd(line, mark + 3, NON_SPACE);
    if (end === mark + 3) continue;
    ranges.push([start, end]);
    from = end;
  }
  return ranges;
}

function protectedRanges(line: string): [number, number][] {
  return [...matchRanges(line, CODE_SPAN), ...linkRanges(line), ...matchRanges(line, AUTOLINK), ...urlRanges(line)];
}

function firstMention(line: string, names: readonly string[]): [number, number] | null {
  const { folded, origin } = foldedWithOrigin(line);
  const blocked = protectedRanges(line);
  let best: [number, number] | null = null;
  for (const name of names) {
    const needle = normalizeText(name.trim());
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
  const body = source.slice(head.length);
  for (const line of fencedLines(body)) {
    const found = line.fenced ? null : firstMention(line.text, names);
    if (!found) continue;
    const [start, end] = found.map((at) => line.from + at);
    const label = body.slice(start, end).replaceAll(/[\\[\]]/gu, String.raw`\$&`);
    return `${head}${body.slice(0, start)}[${label}](${href})${body.slice(end)}`;
  }
  return null;
}
