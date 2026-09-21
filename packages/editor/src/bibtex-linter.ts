import { linter, type Diagnostic } from "@codemirror/lint";
import {
  bibtexEntryType,
  isBibtexDirective,
  missingBibtexRequiredFields,
} from "@oleafly/latex";
import { novalidateDirective } from "./latex-novalidate";
import { editorMessage, type EditorMessageKey } from "./messages";

interface BibtexRange {
  readonly from: number;
  readonly to: number;
}

interface BibtexFieldSpan extends BibtexRange {
  readonly name: string;
  readonly value: string;
  readonly valueFrom: number;
  readonly valueTo: number;
}

interface BibtexEntrySpan {
  readonly type: string;
  readonly typeRange: BibtexRange;
  readonly key: string;
  readonly keyRange: BibtexRange;
  readonly fields: readonly BibtexFieldSpan[];
  readonly complete: boolean;
}

const ENTRY_HEAD = /^@([A-Za-z][A-Za-z0-9_-]*)[ \t]*([{(])/u;
const FIELD_HEAD = /^([A-Za-z][A-Za-z0-9_+:-]*)[ \t\r\n]*=/u;
const ENTRY_START = /^[ \t]*@[A-Za-z][A-Za-z0-9_-]*[ \t]*[{(]/u;
const YEAR_VALUE = /^\d{4}[a-z]?$/u;
const HEAD_LOOKAHEAD = 128;

function lineEndFrom(text: string, cursor: number): number {
  const newline = text.indexOf("\n", cursor);
  return newline < 0 ? text.length : newline;
}

function startsEntry(text: string, lineStart: number, lineEnd: number): number {
  const line = text.slice(lineStart, lineEnd);
  if (!ENTRY_START.test(line)) return -1;
  return lineStart + line.indexOf("@");
}

function skipBlank(text: string, cursor: number, limit: number): number {
  let index = cursor;
  while (index < limit && /\s/u.test(text[index])) index += 1;
  return index;
}

function bracedValueEnd(text: string, cursor: number, limit: number): number {
  let depth = 1;
  let index = cursor + 1;
  while (index < limit && depth > 0) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    index += 1;
  }
  return index;
}

function quotedValueEnd(text: string, cursor: number, limit: number): number {
  let index = cursor + 1;
  while (index < limit && text[index] !== '"') {
    index += text[index] === "\\" ? 2 : 1;
  }
  return Math.min(index + 1, limit);
}

function bareValueEnd(text: string, cursor: number, limit: number): number {
  let index = cursor;
  while (index < limit && text[index] !== "," && text[index] !== "\n") {
    index += 1;
  }
  return index;
}

function valueEnd(text: string, cursor: number, limit: number): number {
  if (text[cursor] === "{") return bracedValueEnd(text, cursor, limit);
  if (text[cursor] === '"') return quotedValueEnd(text, cursor, limit);
  return bareValueEnd(text, cursor, limit);
}

function unwrapValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseFields(
  text: string,
  from: number,
  limit: number,
): BibtexFieldSpan[] {
  const fields: BibtexFieldSpan[] = [];
  let cursor = from;
  while (cursor < limit) {
    cursor = skipBlank(text, cursor, limit);
    if (cursor >= limit) break;
    if (text[cursor] === ",") {
      cursor += 1;
      continue;
    }
    const head = FIELD_HEAD.exec(
      text.slice(cursor, Math.min(limit, cursor + HEAD_LOOKAHEAD)),
    );
    if (!head) {
      cursor = skipToFieldBoundary(text, cursor, limit);
      continue;
    }
    const nameFrom = cursor;
    const valueFrom = skipBlank(text, cursor + head[0].length, limit);
    const valueTo = valueEnd(text, valueFrom, limit);
    fields.push({
      name: head[1].toLowerCase(),
      from: nameFrom,
      to: nameFrom + head[1].length,
      value: unwrapValue(text.slice(valueFrom, valueTo)),
      valueFrom,
      valueTo: Math.max(valueFrom + 1, valueTo),
    });
    cursor = Math.max(valueTo, nameFrom + 1);
  }
  return fields;
}

function skipToFieldBoundary(
  text: string,
  cursor: number,
  limit: number,
): number {
  let index = cursor;
  while (index < limit && text[index] !== ",") index += 1;
  return index + 1;
}

function nextEntryFollows(text: string, newline: number): boolean {
  const lineStart = newline + 1;
  return startsEntry(text, lineStart, lineEndFrom(text, lineStart)) >= 0;
}

function entryBodyEnd(
  text: string,
  bodyFrom: number,
  close: string,
): { end: number; complete: boolean } {
  const open = close === ")" ? "(" : "{";
  let depth = 1;
  let index = bodyFrom;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "{" || char === open) depth += 1;
    else if (char === "}" || char === close) depth -= 1;
    else if (char === "\n" && nextEntryFollows(text, index)) {
      return { end: index, complete: false };
    }
    if (depth === 0) return { end: index, complete: true };
    index += 1;
  }
  return { end: text.length, complete: false };
}

function parseEntry(
  text: string,
  at: number,
): { entry: BibtexEntrySpan | null; next: number } {
  const head = ENTRY_HEAD.exec(text.slice(at, at + HEAD_LOOKAHEAD));
  if (!head) return { entry: null, next: at + 1 };
  const bodyFrom = at + head[0].length;
  const { end, complete } = entryBodyEnd(
    text,
    bodyFrom,
    head[2] === "(" ? ")" : "}",
  );
  const keyFrom = skipBlank(text, bodyFrom, end);
  let keyTo = keyFrom;
  while (keyTo < end && text[keyTo] !== "," && !/\s/u.test(text[keyTo])) {
    keyTo += 1;
  }
  const comma = text.indexOf(",", keyFrom);
  const fieldsFrom = comma >= 0 && comma < end ? comma + 1 : end;
  return {
    entry: {
      type: head[1].toLowerCase(),
      typeRange: { from: at + 1, to: at + 1 + head[1].length },
      key: text.slice(keyFrom, keyTo),
      keyRange: { from: keyFrom, to: Math.max(keyFrom + 1, keyTo) },
      fields: parseFields(text, fieldsFrom, end),
      complete,
    },
    next: complete ? end + 1 : end,
  };
}

export function scanBibtexEntries(text: string): BibtexEntrySpan[] {
  const entries: BibtexEntrySpan[] = [];
  let suppressed = false;
  let lineStart = 0;
  while (lineStart < text.length) {
    const lineEnd = lineEndFrom(text, lineStart);
    const directive = novalidateDirective(text.slice(lineStart, lineEnd));
    if (directive === "file") return [];
    if (directive === "begin" || directive === "end") {
      suppressed = directive === "begin";
      lineStart = lineEnd + 1;
      continue;
    }
    const at = startsEntry(text, lineStart, lineEnd);
    if (at < 0) {
      lineStart = lineEnd + 1;
      continue;
    }
    const parsed = parseEntry(text, at);
    if (parsed.entry && !suppressed) entries.push(parsed.entry);
    lineStart = Math.max(parsed.next, lineEnd + 1);
  }
  return entries;
}

function diagnostic(
  range: BibtexRange,
  severity: Diagnostic["severity"],
  key: EditorMessageKey,
  params: Record<string, string>,
): Diagnostic {
  return {
    from: range.from,
    to: Math.max(range.from + 1, range.to),
    severity,
    message: editorMessage(key, params),
    source: editorMessage("bibtex.lint.source"),
  };
}

function checkRequiredFields(entry: BibtexEntrySpan): Diagnostic[] {
  if (!entry.complete || !entry.key) return [];
  const present = new Set(entry.fields.map((field) => field.name));
  return missingBibtexRequiredFields(entry.type, present).map((group) =>
    diagnostic(entry.keyRange, "error", "bibtex.lint.missingRequiredField", {
      entry: `@${entry.type}{${entry.key}}`,
      fields: group.join(" or "),
    }),
  );
}

function checkRepeatedFields(entry: BibtexEntrySpan): Diagnostic[] {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const field of entry.fields) {
    if (seen.has(field.name)) {
      diagnostics.push(
        diagnostic(field, "warning", "bibtex.lint.fieldRepeated", {
          name: field.name,
          key: entry.key,
        }),
      );
    }
    seen.add(field.name);
  }
  return diagnostics;
}

function checkYear(entry: BibtexEntrySpan): Diagnostic[] {
  const year = entry.fields.find((field) => field.name === "year");
  if (!year?.value || YEAR_VALUE.test(year.value)) return [];
  return [
    diagnostic(
      { from: year.valueFrom, to: year.valueTo },
      "warning",
      "bibtex.lint.invalidYear",
      { year: year.value },
    ),
  ];
}

function entryDiagnostics(entry: BibtexEntrySpan): Diagnostic[] {
  if (isBibtexDirective(entry.type)) return [];
  if (!bibtexEntryType(entry.type)) {
    return [
      diagnostic(
        entry.typeRange,
        "warning",
        "bibtex.lint.unknownEntryType",
        { type: entry.type },
      ),
    ];
  }
  return [
    ...checkRequiredFields(entry),
    ...checkRepeatedFields(entry),
    ...checkYear(entry),
  ];
}

export function lintBibtexText(text: string): Diagnostic[] {
  return scanBibtexEntries(text)
    .flatMap(entryDiagnostics)
    .sort(
      (left, right) =>
        left.from - right.from ||
        left.to - right.to ||
        left.message.localeCompare(right.message),
    );
}

export function createBibtexLinter() {
  return linter((view): Diagnostic[] => lintBibtexText(view.state.doc.toString()), {
    delay: 500,
    tooltipFilter: () => [],
  });
}
