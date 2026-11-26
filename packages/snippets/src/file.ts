import { bodyUses, parseBody, serializeBody } from "./body";
import { parseJsoncDocument } from "./jsonc";
import { lineAt } from "./locate";
import { compileTrigger, EVERY_KEY, hasNestedQuantifier, REGEX_PREFIX, regexEndClass } from "./trigger";
import {
  type BodyNode,
  EXPANDS,
  isOneOf,
  type LayerId,
  type PackHeader,
  type ParsedSnippetFile,
  PLACES,
  SNIPPET_LANGUAGES,
  type SnippetLanguage,
  type SnippetProblem,
  type SnippetProblemCode,
  type SnippetRecord,
} from "./types";

type Bodies = SnippetRecord["bodies"];
type BodyKey = keyof Bodies;

const BODY_KEYS: readonly BodyKey[] = [...SNIPPET_LANGUAGES, "default"];
const SCOPES: Readonly<Record<string, SnippetLanguage>> = {
  latex: "latex",
  tex: "latex",
  typst: "typst",
  markdown: "markdown",
  bibtex: "bibtex",
  plaintext: "notes",
};
const ORDINARY_WORD = /^\p{Ll}+$/u;

class Skip {
  constructor(
    readonly code: SnippetProblemCode,
    readonly message: string,
  ) {}
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function quote(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function badValue(id: string, key: string, value: unknown): Skip {
  return new Skip("bad-value", `"${id}" has an unknown ${key} value (${quote(value)}), so it was left out`);
}

function optional<T>(entry: Record<string, unknown>, id: string, key: string, valid: (value: unknown) => value is T): T | undefined {
  const value = entry[key];
  if (value === undefined) return undefined;
  if (!valid(value)) throw badValue(id, key, value);
  return value;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isVersion = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every((part) => Number.isInteger(part) && part >= 0);
const isLanguages = (value: unknown): value is SnippetLanguage[] | "any" =>
  value === "any" ||
  (Array.isArray(value) && value.length > 0 && value.every((language) => isOneOf(SNIPPET_LANGUAGES, language)));

function bodyText(id: string, value: unknown): string {
  if (typeof value === "string") return value;
  if (isStringList(value)) return value.join("\n");
  throw badValue(id, "body", value);
}

function readBodies(id: string, raw: unknown): Record<string, string> {
  if (raw === undefined) throw new Skip("no-body", `"${id}" has no body, so it was left out`);
  if (!isObject(raw)) return { default: bodyText(id, raw) };
  const bodies: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isOneOf(BODY_KEYS, key)) throw badValue(id, "body", key);
    bodies[key] = bodyText(id, value);
  }
  if (Object.keys(bodies).length === 0) throw new Skip("no-body", `"${id}" has no body, so it was left out`);
  return bodies;
}

function parseBodies(id: string, texts: Record<string, string>, captures: boolean): Bodies {
  const bodies: Bodies = {};
  for (const key of BODY_KEYS) {
    const text = texts[key];
    if (text === undefined) continue;
    const parsed = parseBody(text, { captures });
    const [error] = parsed.errors;
    if (error) throw new Skip(error.code, `"${id}" was left out. ${error.message}`);
    bodies[key] = parsed.nodes;
  }
  return bodies;
}

function scopeLanguages(scope: string): SnippetLanguage[] {
  const languages = new Set<SnippetLanguage>();
  for (const part of scope.split(",")) {
    const language = SCOPES[part.trim().toLowerCase()];
    if (language) languages.add(language);
  }
  return SNIPPET_LANGUAGES.filter((language) => languages.has(language));
}

function readPrefix(id: string, raw: unknown): string[] {
  if (raw === undefined) return [];
  if (typeof raw === "string") return raw ? [raw] : [];
  if (isStringList(raw)) return raw.filter((entry) => entry.length > 0);
  throw badValue(id, "prefix", raw);
}

export function bodiesWrap(bodies: Bodies): boolean {
  return Object.values(bodies).some((nodes) => bodyUses(nodes as BodyNode[], "SELECTION"));
}

interface RecordResult {
  record: SnippetRecord;
  warnings: { code: SnippetProblemCode; message: string }[];
}

function triggerRegex(id: string, trigger: string): RegExp {
  try {
    return compileTrigger(trigger);
  } catch {
    const reason = hasNestedQuantifier(trigger)
      ? "has a repeat inside a repeated group, like (a+)+, which can freeze typing"
      : "is not a valid regular expression";
    throw new Skip("bad-regex", `The trigger of "${id}" ${reason}, so it was left out`);
  }
}

function regexWarnings(id: string, trigger: string, aliases: readonly string[]): RecordResult["warnings"] {
  const warnings: RecordResult["warnings"] = [];
  if (regexEndClass(trigger) === EVERY_KEY) {
    warnings.push({
      code: "regex-every-key",
      message: `The trigger of "${id}" is checked after every key you type, which can slow typing`,
    });
  }
  if (aliases.length > 0) {
    warnings.push({
      code: "regex-aliases",
      message: `"${id}" has a regular expression trigger, so its other prefixes are never used`,
    });
  }
  return warnings;
}

function readRecord(id: string, entry: unknown, collection: string, layer: LayerId): RecordResult {
  if (!isObject(entry)) throw new Skip("entry-not-object", `"${id}" is not a snippet object, so it was left out`);
  const warnings: RecordResult["warnings"] = [];
  const [first = null, ...rest] = readPrefix(id, entry.prefix);
  const regexFlag = optional(entry, id, "regex", isBoolean);
  const isRegex = first !== null && (regexFlag ?? first.startsWith(REGEX_PREFIX));
  const trigger = isRegex && first?.startsWith(REGEX_PREFIX) ? first.slice(REGEX_PREFIX.length) : first;
  const name = optional(entry, id, "name", isString) ?? id;
  const nameKey = optional(entry, id, "nameKey", isString);
  const description = optional(entry, id, "description", isString);
  const scope = optional(entry, id, "scope", isString);
  const languagesValue = optional(entry, id, "languages", isLanguages);
  const expand = optional(entry, id, "expand", (value): value is SnippetRecord["expand"] => isOneOf(EXPANDS, value)) ?? "tab";
  const place = optional(entry, id, "where", (value): value is SnippetRecord["place"] => isOneOf(PLACES, value)) ?? "any";
  const inWord = optional(entry, id, "inWord", isBoolean) ?? false;
  const lineStart = optional(entry, id, "lineStart", isBoolean) ?? false;
  const priority = optional(entry, id, "priority", isNumber) ?? 0;
  const typstSince = optional(entry, id, "typstSince", isVersion);
  const texts = readBodies(id, entry.body);
  const bodies = parseBodies(id, texts, isRegex);
  const aliases = rest.filter((alias) => alias !== trigger && alias !== first);
  const regex = isRegex ? triggerRegex(id, trigger as string) : null;
  if (isRegex) warnings.push(...regexWarnings(id, trigger as string, aliases));
  let languages: SnippetLanguage[] | "any" = languagesValue ?? "any";
  if (languagesValue === undefined && scope !== undefined) {
    languages = scopeLanguages(scope);
    if (languages.length === 0) {
      warnings.push({ code: "no-language", message: `"${id}" is for ${quote(scope)}, which Oleafly does not edit` });
    }
  } else if (languagesValue === undefined && isObject(entry.body) && !("default" in texts)) {
    languages = SNIPPET_LANGUAGES.filter((language) => language in texts);
  }
  if (
    (layer === "user" || layer === "project") &&
    expand === "auto" &&
    !isRegex &&
    trigger !== null &&
    (place === "text" || place === "any") &&
    ORDINARY_WORD.test(trigger)
  ) {
    warnings.push({ code: "ordinary-words", message: `"${trigger}" could expand while you write ordinary words` });
  }
  const record: SnippetRecord = {
    id,
    name,
    trigger,
    aliases,
    regex,
    expand,
    languages,
    place,
    inWord,
    lineStart,
    priority,
    bodies,
    wraps: bodiesWrap(bodies),
    collection,
    layer,
  };
  if (nameKey !== undefined) record.nameKey = nameKey;
  if (description !== undefined) record.description = description;
  if (typstSince !== undefined) record.typstSince = typstSince;
  return { record, warnings };
}

function readHeader(raw: unknown): PackHeader | null {
  if (!isObject(raw)) return null;
  const header: PackHeader = {};
  for (const key of ["name", "nameKey", "source", "licence"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return null;
    header[key] = value;
  }
  return header;
}

export function parseSnippetFile(text: string, collection: string, layer: LayerId): ParsedSnippetFile {
  const problem = (
    line: number,
    code: SnippetProblemCode,
    message: string,
    severity: SnippetProblem["severity"],
    id?: string,
  ): SnippetProblem => ({ collection, line, ...(id === undefined ? {} : { id }), code, message, severity });
  const document = parseJsoncDocument(text);
  if ("error" in document) {
    const { offset, message } = document.error;
    return { collection, records: [], problems: [problem(lineAt(text, offset), "json", `Not valid JSON. ${message}`, "error")] };
  }
  if (!isObject(document.value)) {
    return {
      collection,
      records: [],
      problems: [problem(1, "not-object", "A snippet file is a JSON object with one entry per snippet", "error")],
    };
  }
  const records: SnippetRecord[] = [];
  const problems: SnippetProblem[] = [];
  let header: PackHeader | undefined;
  for (const [id, entry] of Object.entries(document.value)) {
    const line = lineAt(text, document.keys.get(id) as number);
    if (id === "$pack") {
      const read = readHeader(entry);
      if (read) header = read;
      else problems.push(problem(line, "header", "The $pack header was ignored because it is not an object of text values", "warning"));
      continue;
    }
    try {
      const { record, warnings } = readRecord(id, entry, collection, layer);
      records.push(record);
      for (const warning of warnings) problems.push(problem(line, warning.code, warning.message, "warning", id));
    } catch (error) {
      if (!(error instanceof Skip)) throw error;
      problems.push(problem(line, error.code, error.message, "error", id));
    }
  }
  return { collection, records, problems, ...(header ? { header } : {}) };
}

function bodyValue(nodes: readonly BodyNode[]): string | string[] {
  const text = serializeBody(nodes);
  return text.includes("\n") ? text.split("\n") : text;
}

function recordJson(record: SnippetRecord): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  if (record.name !== record.id) json.name = record.name;
  if (record.nameKey !== undefined) json.nameKey = record.nameKey;
  if (record.trigger !== null) {
    const trigger = record.regex ? `${REGEX_PREFIX}${record.trigger}` : record.trigger;
    json.prefix = record.aliases.length > 0 ? [trigger, ...record.aliases] : trigger;
    if (!record.regex && record.trigger.startsWith(REGEX_PREFIX)) json.regex = false;
  }
  if (record.description !== undefined) json.description = record.description;
  const keys = BODY_KEYS.filter((key) => record.bodies[key] !== undefined);
  json.body =
    keys.length === 1 && keys[0] === "default"
      ? bodyValue(record.bodies.default as BodyNode[])
      : Object.fromEntries(keys.map((key) => [key, bodyValue(record.bodies[key] as BodyNode[])]));
  if (record.expand !== "tab") json.expand = record.expand;
  if (record.languages !== "any" || record.bodies.default === undefined) json.languages = record.languages;
  if (record.place !== "any") json.where = record.place;
  if (record.inWord) json.inWord = true;
  if (record.lineStart) json.lineStart = true;
  if (record.priority !== 0) json.priority = record.priority;
  if (record.typstSince !== undefined) json.typstSince = record.typstSince;
  return json;
}

export function serializeSnippetFile(records: readonly SnippetRecord[], header?: PackHeader): string {
  const entries: [string, unknown][] = records.map((record) => [record.id, recordJson(record)]);
  if (header) entries.unshift(["$pack", header]);
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
}
