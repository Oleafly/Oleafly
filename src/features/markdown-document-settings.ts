import {
  composeSettingSteps,
  type DocumentSettingChanges,
  type DocumentSettingState,
  type DocumentSettingsEdit,
  type SettingsStep,
} from "./document-settings";

export type MarkdownSettingKey =
  | "documentClass"
  | "paper"
  | "columns"
  | "margin"
  | "font"
  | "fontSize"
  | "lang"
  | "lineSpacing"
  | "numberSections";

export const MARKDOWN_SETTING_KEYS: readonly MarkdownSettingKey[] = [
  "documentClass",
  "paper",
  "columns",
  "margin",
  "font",
  "fontSize",
  "lang",
  "lineSpacing",
  "numberSections",
];

export type MarkdownSettingChanges = DocumentSettingChanges<MarkdownSettingKey>;

export type FrontMatterStatus = "present" | "absent" | "unclosed";

export interface MarkdownDocumentSettings {
  fields: Record<MarkdownSettingKey, DocumentSettingState>;
  frontMatter: FrontMatterStatus;
}

type ScalarKey = Exclude<MarkdownSettingKey, "columns" | "margin">;

const YAML_KEYS: Record<ScalarKey, string> = {
  documentClass: "documentclass",
  paper: "papersize",
  font: "mainfont",
  fontSize: "fontsize",
  lang: "lang",
  lineSpacing: "linestretch",
  numberSections: "numbersections",
};

const TYPED = new Set<MarkdownSettingKey>(["lineSpacing", "numberSections"]);
const LENGTH = /^\d+(?:\.\d+)?(?:pt|mm|cm|in|em|ex|bp|pc)$/u;
const NUMBER = /^\d+(?:\.\d+)?$/u;
const COLUMNS = new Set(["onecolumn", "twocolumn"]);
const SIDE_KEYS = new Set(["left", "right", "top", "bottom", "inner", "outer", "hmargin", "vmargin", "textwidth", "textheight", "width", "height", "total", "body", "scale"]);
const KEY_LINE = /^([A-Za-z_][\w.-]*)[ \t]*:(?=[ \t]|$)/u;

interface Line {
  from: number;
  to: number;
  next: number;
  text: string;
}

interface ScalarItem {
  from: number;
  to: number;
  value: string;
  quote: '"' | "'" | null;
}

interface BlockItem extends ScalarItem {
  line: Line;
  indent: string;
}

type YamlValue =
  | { kind: "empty"; at: number }
  | ({ kind: "scalar" } & ScalarItem)
  | { kind: "flow"; open: number; close: number; items: ScalarItem[] }
  | { kind: "block"; items: BlockItem[] }
  | { kind: "complex"; source: string };

interface Entry {
  key: string;
  from: number;
  to: number;
  value: YamlValue;
}

interface FrontMatter {
  insertAt: number;
  newline: string;
  entries: Entry[];
}

type Scan = { status: "present"; frontMatter: FrontMatter } | { status: "absent" | "unclosed" };

function splitLines(text: string, start: number): Line[] {
  const lines: Line[] = [];
  let from = start;
  while (from < text.length) {
    const end = text.indexOf("\n", from);
    const next = end < 0 ? text.length : end + 1;
    let to = end < 0 ? text.length : end;
    if (to > from && text[to - 1] === "\r") to -= 1;
    lines.push({ from, to, next, text: text.slice(from, to) });
    from = next;
  }
  return lines;
}

function quotedScalar(source: string, offset: number): { item: ScalarItem; end: number } | null {
  const quote = source[0];
  if (quote === '"') {
    let index = 1;
    while (index < source.length && source[index] !== '"') index += source[index] === "\\" ? 2 : 1;
    if (index >= source.length) return null;
    try {
      const value = JSON.parse(source.slice(0, index + 1)) as string;
      return { item: { from: offset, to: offset + index + 1, value, quote: '"' }, end: index + 1 };
    } catch {
      return null;
    }
  }
  if (quote === "'") {
    let index = 1;
    while (index < source.length) {
      if (source[index] === "'" && source[index + 1] === "'") index += 2;
      else if (source[index] === "'") break;
      else index += 1;
    }
    if (index >= source.length) return null;
    const value = source.slice(1, index).replaceAll("''", "'");
    return { item: { from: offset, to: offset + index + 1, value, quote: "'" }, end: index + 1 };
  }
  return null;
}

function plainValue(source: string, offset: number): ScalarItem | null {
  if (/^[-?:,[\]{}#&*!|>'"%@`]/u.test(source) && !/^-[^\s]/u.test(source)) return null;
  const comment = /\s#/u.exec(source);
  const raw = (comment ? source.slice(0, comment.index) : source).trimEnd();
  if (raw === "" || /:\s/u.test(raw)) return null;
  return { from: offset, to: offset + raw.length, value: raw, quote: null };
}

function scalarItem(source: string, offset: number): ScalarItem | null {
  const quoted = quotedScalar(source, offset);
  if (quoted) {
    const rest = source.slice(quoted.end);
    return rest.trim() === "" || /^\s+#/u.test(rest) ? quoted.item : null;
  }
  if (source.startsWith('"') || source.startsWith("'")) return null;
  return plainValue(source, offset);
}

function flowValue(source: string, offset: number): YamlValue | null {
  const close = source.indexOf("]");
  if (close < 0) return null;
  const rest = source.slice(close + 1);
  if (rest.trim() !== "" && !/^\s+#/u.test(rest)) return null;
  const inner = source.slice(1, close);
  if (/[[\]{}]/u.test(inner)) return null;
  const items: ScalarItem[] = [];
  let start = 1;
  for (const part of inner.split(",")) {
    const lead = part.length - part.trimStart().length;
    const body = part.trim();
    if (body !== "") {
      const item = scalarItem(body, offset + start + lead);
      if (!item || item.to - item.from !== body.length) return null;
      items.push(item);
    }
    start += part.length + 1;
  }
  return { kind: "flow", open: offset, close: offset + close, items };
}

function parseValue(rest: string, restFrom: number, continuation: readonly Line[]): YamlValue {
  const lead = rest.length - rest.trimStart().length;
  const body = rest.trim();
  const bodyFrom = restFrom + lead;
  const content = continuation.filter((line) => line.text.trim() !== "" && !/^\s*#/u.test(line.text));
  const complex = (): YamlValue => ({
    kind: "complex",
    source: [body, ...content.map((line) => line.text.trim())].join(" ").trim(),
  });
  if (body === "" || body.startsWith("#")) {
    if (content.length === 0) return { kind: "empty", at: restFrom };
    const items: BlockItem[] = [];
    for (const line of content) {
      const match = /^([ \t]*)-(?:[ \t]+|$)/u.exec(line.text);
      if (!match) return complex();
      const valueFrom = match[0].length;
      const item = scalarItem(line.text.slice(valueFrom), line.from + valueFrom);
      if (!item) return complex();
      items.push({ ...item, line, indent: match[1] });
    }
    return { kind: "block", items };
  }
  if (content.length > 0) return complex();
  if (body.startsWith("[")) return flowValue(rest.slice(lead), bodyFrom) ?? complex();
  const item = scalarItem(rest.slice(lead), bodyFrom);
  return item ? { kind: "scalar", ...item } : complex();
}

function scanFrontMatter(text: string): Scan {
  const start = text.startsWith("﻿") ? 1 : 0;
  const lines = splitLines(text, start);
  if (lines[0]?.text.trimEnd() !== "---" || lines[1] === undefined || lines[1].text.trim() === "") {
    return { status: "absent" };
  }
  const closeIndex = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line.text));
  if (closeIndex < 0) return { status: "unclosed" };
  const newline = text.slice(lines[0].to, lines[0].next);
  const entries: Entry[] = [];
  let current: { key: string; line: Line; match: string; continuation: Line[] } | null = null;
  const finish = () => {
    if (!current) return;
    const { key, line, match, continuation } = current;
    const content = continuation.filter((candidate) => candidate.text.trim() !== "");
    const last = content.at(-1) ?? line;
    entries.push({
      key,
      from: line.from,
      to: last.next,
      value: parseValue(line.text.slice(match.length), line.from + match.length, continuation),
    });
    current = null;
  };
  for (const line of lines.slice(1, closeIndex)) {
    const match = KEY_LINE.exec(line.text);
    if (match) {
      finish();
      current = { key: match[1], line, match: match[0], continuation: [] };
    } else if (current && (line.text.trim() === "" || /^[ \t]/u.test(line.text) || /^-(?:[ \t]|$)/u.test(line.text))) {
      current.continuation.push(line);
    } else {
      finish();
    }
  }
  finish();
  return { status: "present", frontMatter: { insertAt: lines[closeIndex].from, newline, entries } };
}

function entryFor(frontMatter: FrontMatter | null, key: string): Entry | undefined {
  return frontMatter?.entries.filter((entry) => entry.key === key).at(-1);
}

function itemsOf(value: YamlValue): ScalarItem[] | null {
  if (value.kind === "flow" || value.kind === "block") return value.items;
  return null;
}

function geometryParts(value: string): { key: string; text: string; value: string }[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const equals = part.indexOf("=");
      return equals < 0
        ? { key: part.toLowerCase(), text: part, value: "" }
        : { key: part.slice(0, equals).trim().toLowerCase(), text: part, value: part.slice(equals + 1).trim() };
    });
}

function marginOfParts(parts: readonly { key: string; text: string; value: string }[]): DocumentSettingState {
  const margin = parts.filter((part) => part.key === "margin").at(-1);
  if (margin) {
    return LENGTH.test(margin.value)
      ? { status: "set", value: margin.value }
      : { status: "locked", reason: "expression", source: margin.value };
  }
  const sides = parts.filter((part) => SIDE_KEYS.has(part.key));
  if (sides.length > 0) return { status: "locked", reason: "sides", source: sides.map((part) => part.text).join(", ") };
  return { status: "unset" };
}

function marginState(entry: Entry | undefined): DocumentSettingState {
  if (!entry || entry.value.kind === "empty") return { status: "unset" };
  if (entry.value.kind === "complex") return { status: "locked", reason: "expression", source: entry.value.source };
  if (entry.value.kind === "scalar") return marginOfParts(geometryParts(entry.value.value));
  return marginOfParts(entry.value.items.flatMap((item) => geometryParts(item.value)));
}

function columnsState(entry: Entry | undefined): DocumentSettingState {
  if (!entry || entry.value.kind === "empty") return { status: "unset" };
  if (entry.value.kind === "complex") return { status: "locked", reason: "expression", source: entry.value.source };
  if (entry.value.kind === "scalar") {
    const value = entry.value.value.trim();
    if (COLUMNS.has(value)) return { status: "set", value };
    const parts = value.split(",").map((part) => part.trim());
    return parts.some((part) => COLUMNS.has(part))
      ? { status: "locked", reason: "expression", source: value }
      : { status: "unset" };
  }
  const item = entry.value.items.filter((candidate) => COLUMNS.has(candidate.value)).at(-1);
  return item ? { status: "set", value: item.value } : { status: "unset" };
}

function normalizedBoolean(value: string): string | null {
  const lower = value.toLowerCase();
  if (["true", "yes", "on"].includes(lower)) return "true";
  if (["false", "no", "off"].includes(lower)) return "false";
  return null;
}

function scalarState(key: ScalarKey, entry: Entry | undefined): DocumentSettingState {
  if (!entry || entry.value.kind === "empty") return { status: "unset" };
  if (entry.value.kind === "complex") return { status: "locked", reason: "expression", source: entry.value.source };
  if (entry.value.kind !== "scalar") {
    const items = itemsOf(entry.value) ?? [];
    return { status: "locked", reason: "expression", source: items.map((item) => item.value).join(", ") };
  }
  if (key === "numberSections") {
    const value = normalizedBoolean(entry.value.value);
    return value ? { status: "set", value } : { status: "locked", reason: "expression", source: entry.value.value };
  }
  return { status: "set", value: entry.value.value };
}

function fieldState(frontMatter: FrontMatter | null, key: MarkdownSettingKey): DocumentSettingState {
  if (key === "columns") return columnsState(entryFor(frontMatter, "classoption"));
  if (key === "margin") return marginState(entryFor(frontMatter, "geometry"));
  return scalarState(key, entryFor(frontMatter, YAML_KEYS[key]));
}

export function readMarkdownDocumentSettings(text: string): MarkdownDocumentSettings {
  const scan = scanFrontMatter(text);
  const frontMatter = scan.status === "present" ? scan.frontMatter : null;
  const fields = Object.fromEntries(MARKDOWN_SETTING_KEYS.map((key) => [key, fieldState(frontMatter, key)])) as Record<
    MarkdownSettingKey,
    DocumentSettingState
  >;
  return { fields, frontMatter: scan.status };
}

export function validateMarkdownSetting(key: MarkdownSettingKey, value: string): boolean {
  const trimmed = value.trim();
  switch (key) {
    case "documentClass":
      return /^[A-Za-z][A-Za-z0-9-]*$/u.test(trimmed);
    case "paper":
      return /^(?:a[0-6]|b[0-6]|letter|legal|executive)$/u.test(trimmed);
    case "columns":
      return COLUMNS.has(trimmed);
    case "margin":
      return LENGTH.test(trimmed);
    case "font":
      return trimmed.length > 0 && !/[\n\r]/u.test(trimmed);
    case "fontSize":
      return /^\d{1,2}(?:\.\d+)?pt$/u.test(trimmed);
    case "lang":
      return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u.test(trimmed);
    case "lineSpacing":
      return NUMBER.test(trimmed) && Number(trimmed) > 0 && Number(trimmed) < 10;
    case "numberSections":
      return trimmed === "true" || trimmed === "false";
  }
}

function plainSafe(value: string): boolean {
  if (value === "" || value !== value.trim()) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/u.test(value)) return false;
  if (/(?::\s|\s#|:$)/u.test(value)) return false;
  if (/^(?:true|false|yes|no|on|off|null|~)$/iu.test(value)) return false;
  return !/^[+-]?\d+(?:\.\d+)?$/u.test(value);
}

function serialize(value: string, quote: '"' | "'" | null, typed: boolean): string {
  if (typed) return value;
  if (quote === "'") return `'${value.replaceAll("'", "''")}'`;
  if (quote === '"' || !plainSafe(value)) return JSON.stringify(value);
  return value;
}

function removeEntry(entry: Entry): DocumentSettingsEdit {
  return { from: entry.from, to: entry.to, insert: "" };
}

function addEntry(text: string, scan: Scan, line: string): DocumentSettingsEdit[] {
  if (scan.status === "unclosed") return [];
  if (scan.status === "present") {
    const { insertAt, newline } = scan.frontMatter;
    return [{ from: insertAt, to: insertAt, insert: `${line}${newline}` }];
  }
  const start = text.startsWith("﻿") ? 1 : 0;
  const gap = text.slice(start).startsWith("\n") || text.slice(start).startsWith("\r\n") ? "" : "\n";
  return [{ from: start, to: start, insert: `---\n${line}\n---\n${gap}` }];
}

function removeListItem(value: { kind: "flow"; items: ScalarItem[] } | { kind: "block"; items: BlockItem[] }, item: ScalarItem): DocumentSettingsEdit {
  if (value.kind === "block") {
    const line = (item as BlockItem).line;
    return { from: line.from, to: line.next, insert: "" };
  }
  const index = value.items.indexOf(item);
  if (index < value.items.length - 1) return { from: item.from, to: value.items[index + 1].from, insert: "" };
  return { from: value.items[index - 1].to, to: item.to, insert: "" };
}

function appendListItem(
  value: { kind: "flow"; open: number; items: ScalarItem[] } | { kind: "block"; items: BlockItem[] },
  insert: string,
): DocumentSettingsEdit {
  if (value.kind === "block") {
    const last = value.items[value.items.length - 1];
    const newline = last.line.next > last.line.to ? "" : "\n";
    const tail = last.line.next > last.line.to ? "\n" : "";
    return { from: last.line.next, to: last.line.next, insert: `${newline}${last.indent}- ${insert}${tail}` };
  }
  const last = value.items.at(-1);
  if (!last) return { from: value.open + 1, to: value.open + 1, insert };
  return { from: last.to, to: last.to, insert: `, ${insert}` };
}

const scanned = (step: (text: string, scan: Scan) => DocumentSettingsEdit[]): SettingsStep => (current) => {
  const scan = scanFrontMatter(current);
  return scan.status === "unclosed" ? [] : step(current, scan);
};

function entryIn(scan: Scan, key: string): Entry | undefined {
  return entryFor(scan.status === "present" ? scan.frontMatter : null, key);
}

function scalarStep(key: ScalarKey, value: string | null): SettingsStep {
  const yamlKey = YAML_KEYS[key];
  const typed = TYPED.has(key);
  return scanned((text, scan) => {
    const entry = entryIn(scan, yamlKey);
    if (value === null) return entry ? [removeEntry(entry)] : [];
    if (!entry) return addEntry(text, scan, `${yamlKey}: ${serialize(value, null, typed)}`);
    if (entry.value.kind === "empty") return [{ from: entry.value.at, to: entry.value.at, insert: ` ${serialize(value, null, typed)}` }];
    if (entry.value.kind !== "scalar") return [];
    return [{ from: entry.value.from, to: entry.value.to, insert: serialize(value, entry.value.quote, typed) }];
  });
}

function columnsStep(value: string | null): SettingsStep {
  return scanned((text, scan) => {
    const entry = entryIn(scan, "classoption");
    if (!entry) return value === null ? [] : addEntry(text, scan, `classoption: ${value}`);
    const current = entry.value;
    if (current.kind === "complex") return [];
    if (current.kind === "empty") return value === null ? [] : [{ from: current.at, to: current.at, insert: ` ${value}` }];
    if (current.kind === "scalar") {
      if (COLUMNS.has(current.value)) {
        return value === null ? [removeEntry(entry)] : [{ from: current.from, to: current.to, insert: value }];
      }
      if (value === null || current.value.includes(",")) return [];
      return [{ from: current.from, to: current.to, insert: `[${text.slice(current.from, current.to)}, ${value}]` }];
    }
    const item = current.items.filter((candidate) => COLUMNS.has(candidate.value)).at(-1);
    if (value === null) {
      if (!item) return [];
      return current.items.length === 1 ? [removeEntry(entry)] : [removeListItem(current, item)];
    }
    if (item) return [{ from: item.from, to: item.to, insert: value }];
    return [appendListItem(current, value)];
  });
}

function marginStep(value: string | null): SettingsStep {
  return scanned((text, scan) => {
    const entry = entryIn(scan, "geometry");
    const state = marginState(entry);
    if (state.status === "locked") return [];
    if (!entry) return value === null ? [] : addEntry(text, scan, `geometry: margin=${value}`);
    const current = entry.value;
    if (current.kind === "complex") return [];
    if (current.kind === "empty") return value === null ? [] : [{ from: current.at, to: current.at, insert: ` margin=${value}` }];
    if (current.kind === "scalar") {
      const parts = geometryParts(current.value).map((part) => part.text);
      const separator = current.value.includes(", ") || parts.length < 2 ? ", " : ",";
      const keys = geometryParts(current.value).map((part) => part.key);
      const index = keys.lastIndexOf("margin");
      if (value === null) {
        if (index < 0) return [];
        parts.splice(index, 1);
        if (parts.length === 0) return [removeEntry(entry)];
      } else if (index < 0) parts.push(`margin=${value}`);
      else parts[index] = `margin=${value}`;
      return [{ from: current.from, to: current.to, insert: serialize(parts.join(separator), current.quote, false) }];
    }
    const item = current.items.filter((candidate) => geometryParts(candidate.value)[0]?.key === "margin").at(-1);
    if (value === null) {
      if (!item) return [];
      return current.items.length === 1 ? [removeEntry(entry)] : [removeListItem(current, item)];
    }
    if (item) return [{ from: item.from, to: item.to, insert: serialize(`margin=${value}`, item.quote, false) }];
    return [appendListItem(current, `margin=${value}`)];
  });
}

function stepFor(key: MarkdownSettingKey, value: string | null): SettingsStep {
  if (key === "columns") return columnsStep(value);
  if (key === "margin") return marginStep(value);
  return scalarStep(key, value);
}

export function markdownSettingsEdits(text: string, changes: MarkdownSettingChanges): DocumentSettingsEdit[] {
  const { fields, frontMatter } = readMarkdownDocumentSettings(text);
  if (frontMatter === "unclosed") return [];
  const steps: SettingsStep[] = [];
  for (const key of MARKDOWN_SETTING_KEYS) {
    if (!Object.hasOwn(changes, key)) continue;
    const current = fields[key];
    if (current.status === "locked") continue;
    const raw = changes[key];
    const next = raw === null || raw === undefined || raw.trim() === "" ? null : raw.trim();
    if (next === null && current.status === "unset") continue;
    if (next !== null && (!validateMarkdownSetting(key, next) || (current.status === "set" && current.value === next))) continue;
    steps.push(stepFor(key, next));
  }
  return composeSettingSteps(text, steps);
}
