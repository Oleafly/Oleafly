import { bodiesWrap } from "./file";
import { compileTrigger, type EndClass, regexEndClass } from "./trigger";
import type { LayerId, ParsedSnippetFile, SnippetLanguage, SnippetProblem, SnippetRecord } from "./types";

export type { EndClass } from "./trigger";

type Patchable = "trigger" | "expand" | "place" | "inWord" | "lineStart" | "priority" | "languages" | "name" | "bodies";

export interface SnippetOverride {
  id: string;
  collection: string;
  patch?: Partial<Pick<SnippetRecord, Patchable>>;
  disabled?: boolean;
}

export interface LibraryInput {
  files: readonly ParsedSnippetFile[];
  disabledCollections: ReadonlySet<string>;
  overrides: readonly SnippetOverride[];
  disabledRegex: ReadonlySet<string>;
}

export interface LanguageIndex {
  readonly prefixSorted: readonly SnippetRecord[];
  readonly autoByLastChar: ReadonlyMap<string, readonly SnippetRecord[]>;
  readonly regexByEnd: ReadonlyMap<EndClass, readonly SnippetRecord[]>;
  readonly wrappers: readonly SnippetRecord[];
  readonly triggerless: readonly SnippetRecord[];
}

export interface SnippetLibrary {
  readonly records: readonly SnippetRecord[];
  readonly all: readonly SnippetRecord[];
  readonly problems: readonly SnippetProblem[];
  byId(id: string): SnippetRecord | undefined;
  forLanguage(language: SnippetLanguage): LanguageIndex;
}

const LAYER_RANK: Readonly<Record<LayerId, number>> = { builtin: 0, pack: 1, user: 2, project: 3 };

export function layerRank(layer: LayerId): number {
  return LAYER_RANK[layer];
}

export function compareCandidates(a: SnippetRecord, b: SnippetRecord, lengthA: number, lengthB: number): number {
  return b.priority - a.priority || lengthB - lengthA || layerRank(b.layer) - layerRank(a.layer);
}

export function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function overrideKey(collection: string, id: string): string {
  return `${collection}\u0000${id}`;
}

function applyPatch(record: SnippetRecord, override: SnippetOverride, problems: SnippetProblem[]): SnippetRecord {
  const patch = override.patch;
  if (!patch) return record;
  const next: SnippetRecord = { ...record };
  for (const [key, value] of Object.entries(patch) as [Patchable, unknown][]) {
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  if (patch.bodies !== undefined) next.wraps = bodiesWrap(next.bodies);
  if (record.regex && patch.trigger !== undefined && patch.trigger !== record.trigger) {
    try {
      next.regex = patch.trigger === null ? null : compileTrigger(patch.trigger);
    } catch {
      next.trigger = record.trigger;
      problems.push({
        collection: record.collection,
        line: 0,
        id: record.id,
        code: "bad-regex",
        message: `The changed trigger of "${record.id}" is not a valid regular expression, so the old one is kept`,
        severity: "error",
      });
    }
  }
  return next;
}

function keysOf(record: SnippetRecord): string[] {
  return record.trigger === null ? [] : [record.trigger, ...record.aliases];
}

function longestEndingWith(record: SnippetRecord, char: string): number {
  return Math.max(...keysOf(record).filter((key) => key.endsWith(char)).map((key) => key.length));
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

function inLanguage(record: SnippetRecord, language: SnippetLanguage): boolean {
  const listed = record.languages === "any" || record.languages.includes(language);
  return listed && (record.bodies[language] !== undefined || record.bodies.default !== undefined);
}

function buildIndex(records: readonly SnippetRecord[], language: SnippetLanguage): LanguageIndex {
  const eligible = records.filter((record) => inLanguage(record, language));
  const literal = eligible.filter((record) => record.trigger !== null && record.regex === null);
  const prefixSorted = [...literal].sort((a, b) => compareKeys(a.trigger as string, b.trigger as string));
  const autoByLastChar = new Map<string, SnippetRecord[]>();
  for (const record of literal) {
    if (record.expand !== "auto") continue;
    for (const key of keysOf(record)) push(autoByLastChar, key.slice(-1), record);
  }
  for (const [char, bucket] of autoByLastChar) {
    bucket.sort((a, b) => compareCandidates(a, b, longestEndingWith(a, char), longestEndingWith(b, char)));
  }
  const regexByEnd = new Map<EndClass, SnippetRecord[]>();
  for (const record of eligible) {
    if (record.regex) push(regexByEnd, regexEndClass(record.trigger as string), record);
  }
  for (const bucket of regexByEnd.values()) bucket.sort((a, b) => compareCandidates(a, b, 0, 0));
  return {
    prefixSorted,
    autoByLastChar,
    regexByEnd,
    wrappers: eligible.filter((record) => record.wraps),
    triggerless: eligible.filter((record) => record.trigger === null),
  };
}

export function buildLibrary(input: LibraryInput): SnippetLibrary {
  const problems: SnippetProblem[] = input.files.flatMap((file) => file.problems);
  const overrides = new Map(input.overrides.map((override) => [overrideKey(override.collection, override.id), override]));
  const all: SnippetRecord[] = [];
  const disabled = new Set<SnippetRecord>();
  for (const file of input.files) {
    for (const record of file.records) {
      const override = overrides.get(overrideKey(record.collection, record.id));
      const patched = override ? applyPatch(record, override, problems) : record;
      if (override?.disabled) disabled.add(patched);
      all.push(patched);
    }
  }
  const byId = new Map<string, SnippetRecord>();
  for (const record of all) {
    if (disabled.has(record) || input.disabledCollections.has(record.collection)) continue;
    if (record.regex && input.disabledRegex.has(record.id)) continue;
    const existing = byId.get(record.id);
    if (!existing || layerRank(record.layer) >= layerRank(existing.layer)) byId.set(record.id, record);
  }
  const records = [...byId.values()];
  const indexes = new Map<SnippetLanguage, LanguageIndex>();
  return {
    records,
    all,
    problems,
    byId: (id) => byId.get(id),
    forLanguage(language) {
      let index = indexes.get(language);
      if (!index) {
        index = buildIndex(records, language);
        indexes.set(language, index);
      }
      return index;
    },
  };
}
