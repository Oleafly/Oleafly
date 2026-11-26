import {
  applyHelper,
  type BodyNode,
  type Expand,
  parseBody,
  parseSnippetFile,
  type Place,
  REGEX_PREFIX,
  SNIPPET_LANGUAGES,
  type SnippetLanguage,
  type SnippetLibrary,
  type SnippetRecord,
  serializeBody,
} from "@oleafly/snippets";
import { snippetName, USER_COLLECTION } from "./records";

export type BodyKey = SnippetLanguage | "default";

export interface SnippetDraft {
  id: string | null;
  collection: string;
  name: string;
  trigger: string;
  regex: boolean;
  expand: Expand;
  languages: SnippetLanguage[] | "any";
  place: Place;
  wholeWord: boolean;
  lineStart: boolean;
  bodies: Partial<Record<BodyKey, string>>;
}

export interface DraftResult {
  record: SnippetRecord | null;
  missing: "name" | "body" | null;
  errors: string[];
  warnings: string[];
}

export interface SnippetClash {
  kind: "duplicate" | "shared-start";
  records: SnippetRecord[];
}

const DEFAULT_KEY: BodyKey = "default";
const ID_PREFIX = "user.";
const ID_FALLBACK = "snippet";

export function bodyKeys(languages: SnippetDraft["languages"]): BodyKey[] {
  return languages === "any" ? [DEFAULT_KEY] : SNIPPET_LANGUAGES.filter((language) => languages.includes(language));
}

export function newDraft(language: SnippetLanguage | null, collection = USER_COLLECTION): SnippetDraft {
  return {
    id: null,
    collection,
    name: "",
    trigger: "",
    regex: false,
    expand: "tab",
    languages: language ? [language] : "any",
    place: "any",
    wholeWord: true,
    lineStart: false,
    bodies: {},
  };
}

export function draftFromRecord(record: SnippetRecord): SnippetDraft {
  const bodies: SnippetDraft["bodies"] = {};
  for (const key of bodyKeys(record.languages)) {
    const nodes = record.bodies[key] ?? record.bodies.default;
    if (nodes) bodies[key] = serializeBody(nodes);
  }
  return {
    id: record.id,
    collection: record.collection,
    name: snippetName(record),
    trigger: record.trigger ?? "",
    regex: record.regex !== null,
    expand: record.expand,
    languages: record.languages === "any" ? "any" : [...record.languages],
    place: record.place,
    wholeWord: !record.inWord,
    lineStart: record.lineStart,
    bodies,
  };
}

function bodyJson(draft: SnippetDraft, base: SnippetRecord | null): { body: unknown; languages?: SnippetLanguage[] } {
  const keys = bodyKeys(draft.languages);
  const texts = keys.map((key) => draft.bodies[key] ?? "");
  if (draft.languages === "any") return { body: texts[0] };
  const shared = texts.every((text) => text === texts[0]) && (base === null || base.bodies.default !== undefined);
  if (shared) return { body: texts[0], languages: draft.languages };
  const body = Object.fromEntries(keys.flatMap((key, index) => (texts[index] ? [[key, texts[index]]] : [])));
  return { body, languages: draft.languages };
}

function triggerJson(draft: SnippetDraft): string | undefined {
  const trigger = draft.trigger.trim();
  if (!trigger) return undefined;
  return draft.regex && !trigger.startsWith(REGEX_PREFIX) ? `${REGEX_PREFIX}${trigger}` : trigger;
}

function entryJson(draft: SnippetDraft, base: SnippetRecord | null, name: string): Record<string, unknown> {
  const { body, languages } = bodyJson(draft, base);
  const prefix = triggerJson(draft);
  return {
    name,
    ...(base?.nameKey !== undefined && name === base.name ? { nameKey: base.nameKey } : {}),
    ...(prefix === undefined ? {} : { prefix: base && base.aliases.length > 0 ? [prefix, ...base.aliases] : prefix }),
    ...(prefix !== undefined && !draft.regex && prefix.startsWith(REGEX_PREFIX) ? { regex: false } : {}),
    ...(base?.description === undefined ? {} : { description: base.description }),
    body,
    expand: draft.expand,
    ...(languages ? { languages } : {}),
    where: draft.place,
    inWord: !draft.wholeWord,
    lineStart: draft.lineStart,
    ...(base && base.priority !== 0 ? { priority: base.priority } : {}),
    ...(base?.typstSince ? { typstSince: base.typstSince } : {}),
  };
}

function bodyErrors(draft: SnippetDraft): string[] {
  const errors: string[] = [];
  for (const key of bodyKeys(draft.languages)) {
    const text = draft.bodies[key] ?? "";
    for (const error of parseBody(text).errors) errors.push(error.message);
  }
  return errors;
}

export function draftRecord(draft: SnippetDraft, base: SnippetRecord | null, id: string): DraftResult {
  const name = base && draft.name.trim() === snippetName(base) ? base.name : draft.name.trim();
  if (!name) return { record: null, missing: "name", errors: [], warnings: [] };
  if (bodyKeys(draft.languages).every((key) => !(draft.bodies[key] ?? "").trim())) {
    return { record: null, missing: "body", errors: [], warnings: [] };
  }
  const syntax = bodyErrors(draft);
  if (syntax.length > 0) return { record: null, missing: null, errors: syntax, warnings: [] };
  const layer = base?.layer ?? "user";
  const parsed = parseSnippetFile(JSON.stringify({ [id]: entryJson(draft, base, name) }), draft.collection, layer);
  const errors = parsed.problems.filter((problem) => problem.severity === "error").map((problem) => problem.message);
  const warnings = parsed.problems.filter((problem) => problem.severity === "warning").map((problem) => problem.message);
  const [record] = parsed.records;
  if (!record || errors.length > 0) return { record: null, missing: null, errors, warnings };
  return { record, missing: null, errors: [], warnings };
}

function indexesIn(nodes: readonly BodyNode[], into: Set<number>): void {
  for (const node of nodes) {
    if ("index" in node) into.add(node.index);
    if (node.kind === "field") indexesIn(node.placeholder, into);
    if (node.kind === "variable") indexesIn(node.fallback, into);
  }
}

export function nextFieldIndex(body: string): number {
  const used = new Set<number>();
  indexesIn(parseBody(body).nodes, used);
  return Math.max(0, ...used) + 1;
}

export function uniqueRecordId(name: string, taken: (id: string) => boolean): string {
  const stem = `${ID_PREFIX}${applyHelper("slug", name) || ID_FALLBACK}`;
  if (!taken(stem)) return stem;
  let number = 2;
  while (taken(`${stem}-${number}`)) number += 1;
  return `${stem}-${number}`;
}

function overlaps(left: SnippetRecord["languages"], right: SnippetRecord["languages"]): boolean {
  return left === "any" || right === "any" || left.some((language) => right.includes(language));
}

export function snippetClashes(draft: SnippetDraft, library: SnippetLibrary): SnippetClash[] {
  const trigger = draft.trigger.trim();
  if (!trigger || draft.regex) return [];
  const others = library.records.filter(
    (record) =>
      record.trigger !== null &&
      record.regex === null &&
      !(record.id === draft.id && record.collection === draft.collection) &&
      overlaps(record.languages, draft.languages),
  );
  const duplicate = others.filter((record) => record.trigger === trigger);
  const shared = others.filter(
    (record) => record.trigger !== trigger && ((record.trigger as string).startsWith(trigger) || trigger.startsWith(record.trigger as string)),
  );
  return [
    ...(duplicate.length > 0 ? [{ kind: "duplicate" as const, records: duplicate }] : []),
    ...(shared.length > 0 ? [{ kind: "shared-start" as const, records: shared }] : []),
  ];
}
