import {
  lineStarts,
  location,
  rangeFromOffsets,
  sourceHash,
  stableId,
  trimRange,
} from "./source";
import { bibliographyEntrySummary } from "./bibliography-summary";
import type {
  BibliographyEntryDetail,
  BibliographyField,
  FileAnalysis,
  OutlineNode,
  ProjectDefinition,
  ProjectDiagnostic,
  ProjectDiagnosticMessage,
  ProjectUse,
} from "./types";

const DIRECTIVE_TYPES = new Set(["comment", "preamble", "string"]);
const BIBTEX_REQUIRED_FIELDS: Readonly<
  Record<string, readonly (readonly string[])[]>
> = {
  article: [["author"], ["title"], ["journal"], ["year"]],
  book: [["author", "editor"], ["title"], ["publisher"], ["year"]],
  booklet: [["title"]],
  conference: [["author"], ["title"], ["booktitle"], ["year"]],
  inbook: [
    ["author", "editor"],
    ["title"],
    ["chapter", "pages"],
    ["publisher"],
    ["year"],
  ],
  incollection: [
    ["author"],
    ["title"],
    ["booktitle"],
    ["publisher"],
    ["year"],
  ],
  inproceedings: [["author"], ["title"], ["booktitle"], ["year"]],
  manual: [["title"]],
  mastersthesis: [["author"], ["title"], ["school"], ["year"]],
  misc: [],
  online: [["title"], ["url", "doi"]],
  phdthesis: [["author"], ["title"], ["school"], ["year"]],
  proceedings: [["title"], ["year"]],
  techreport: [["author"], ["title"], ["institution"], ["year"]],
  unpublished: [["author"], ["title"], ["note"]],
};

function skipWhitespaceAndCommas(
  source: string,
  offset: number,
): number {
  let cursor = offset;
  while (
    cursor < source.length &&
    (/\s/.test(source[cursor]) || source[cursor] === ",")
  ) {
    cursor++;
  }
  return cursor;
}

function closingFor(open: string): string {
  return open === "(" ? ")" : "}";
}

function looksLikeEntryStart(source: string, offset: number): boolean {
  if (source[offset] !== "@") return false;
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  if (source.slice(lineStart, offset).trim()) return false;
  return /^@[A-Za-z][A-Za-z0-9_-]*\s*[{(]/.test(
    source.slice(offset),
  );
}

function nextFieldBoundary(comma: number, end: number): number {
  if (comma < 0) return end;
  if (end < 0) return comma;
  return Math.min(comma, end);
}

function findDirectiveEnd(
  source: string,
  openOffset: number,
  open: string,
): number {
  const close = closingFor(open);
  let depth = 1;
  let quoted = false;
  for (let cursor = openOffset + 1; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (char === "\\" && quoted) {
      cursor++;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === open) depth++;
    else if (char === close && --depth === 0) return cursor + 1;
  }
  return source.length;
}

type FieldValue = {
  field: Omit<BibliographyField, "name" | "range">;
  next: number;
  complete: boolean;
};

function bracedFieldEnd(source: string, cursor: number): {
  end: number;
  complete: boolean;
} {
  let depth = 1;
  let end = cursor + 1;
  while (end < source.length && depth > 0) {
    if (depth === 1 && looksLikeEntryStart(source, end)) break;
    if (source[end] === "\\") {
      end += 2;
      continue;
    }
    if (source[end] === "{") depth++;
    else if (source[end] === "}") depth--;
    end++;
  }
  return { end, complete: depth === 0 };
}

function bracedFieldValue(
  source: string,
  starts: readonly number[],
  cursor: number,
): FieldValue {
  const { end, complete } = bracedFieldEnd(source, cursor);
  const valueTo = complete ? end - 1 : end;
  return {
    field: {
      value: source.slice(cursor + 1, valueTo).replace(/\s+/g, " ").trim(),
      valueRange: rangeFromOffsets(starts, cursor + 1, valueTo),
      valueStyle: "braced",
      complete,
    },
    next: end,
    complete,
  };
}

function quotedFieldEnd(source: string, cursor: number): {
  end: number;
  complete: boolean;
} {
  let end = cursor + 1;
  while (end < source.length) {
    if (looksLikeEntryStart(source, end)) break;
    if (source[end] === "\\") {
      end += 2;
      continue;
    }
    if (source[end] === '"') return { end, complete: true };
    end++;
  }
  return { end, complete: false };
}

function quotedFieldValue(
  source: string,
  starts: readonly number[],
  cursor: number,
): FieldValue {
  const { end, complete } = quotedFieldEnd(source, cursor);
  return {
    field: {
      value: source.slice(cursor + 1, end).replace(/\s+/g, " ").trim(),
      valueRange: rangeFromOffsets(starts, cursor + 1, end),
      valueStyle: "quoted",
      complete,
    },
    // If a new top-level entry starts before the quote closes, recover at
    // that entry instead of swallowing the rest of the bibliography.
    next: complete ? end + 1 : end,
    complete,
  };
}

function bareFieldValue(
  source: string,
  starts: readonly number[],
  cursor: number,
): FieldValue {
  let end = cursor;
  while (
    end < source.length &&
    source[end] !== "," &&
    source[end] !== "}" &&
    source[end] !== ")"
  ) {
    end++;
  }
  const [valueFrom, valueTo] = trimRange(source, cursor, end);
  return {
    field: {
      value: source.slice(valueFrom, valueTo),
      valueRange: rangeFromOffsets(starts, valueFrom, valueTo),
      valueStyle: "bare",
      complete: valueTo > valueFrom,
    },
    next: end,
    complete: valueTo > valueFrom,
  };
}

function fieldValue(
  source: string,
  starts: readonly number[],
  offset: number,
): FieldValue {
  const cursor = skipWhitespaceAndCommas(source, offset);
  const char = source[cursor];
  if (char === "{") return bracedFieldValue(source, starts, cursor);
  if (char === '"') return quotedFieldValue(source, starts, cursor);
  return bareFieldValue(source, starts, cursor);
}

type BibtexScan = {
  readonly file: string;
  readonly source: string;
  readonly starts: readonly number[];
  readonly entries: BibliographyEntryDetail[];
  readonly definitions: ProjectDefinition[];
  readonly uses: ProjectUse[];
  readonly outline: OutlineNode[];
  readonly diagnostics: ProjectDiagnostic[];
  partial: boolean;
};

type EntrySpec = {
  readonly entryFrom: number;
  readonly entryTo: number;
  readonly typeFrom: number;
  readonly typeTo: number;
  readonly keyFrom: number;
  readonly keyTo: number;
  readonly key: string;
  readonly type: string;
  readonly fields: BibliographyField[];
  readonly complete: boolean;
};

type ParsedFields = {
  readonly fields: BibliographyField[];
  readonly complete: boolean;
  readonly entryTo: number;
  readonly position: number;
};

const CROSS_REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  "crossref",
  "xref",
  "xdata",
  "related",
  "entryset",
]);

function malformed(
  scan: BibtexScan,
  from: number,
  to: number,
  message: ProjectDiagnosticMessage,
): void {
  scan.partial = true;
  scan.diagnostics.push({
    id: stableId("diag", scan.file, from, to, "malformed-bibtex"),
    source: "project-intelligence",
    severity: "error",
    code: "malformed-bibtex",
    message,
    location: location(scan.file, scan.starts, from, to),
    related: [],
  });
}

function validationFinding(
  scan: BibtexScan,
  range: ReturnType<typeof rangeFromOffsets>,
  severity: "error" | "warning",
  message: ProjectDiagnosticMessage,
  discriminator: string,
): void {
  scan.diagnostics.push({
    id: stableId("diag", scan.file, range.from, "bibtex-validation", discriminator),
    source: "project-intelligence",
    severity,
    code: "bibtex-validation",
    message,
    location: { file: scan.file, range },
    related: [],
  });
}

function findKeyDelimiter(
  source: string,
  position: number,
  close: string,
): number {
  for (let index = position; index < source.length; index++) {
    const char = source[index];
    if (char === "," || char === close || char === "@") return index;
  }
  return source.length;
}

function unparsableFieldRecovery(
  source: string,
  position: number,
  close: string,
): number {
  const comma = source.indexOf(",", position + 1);
  const end = source.indexOf(close, position + 1);
  if (comma < 0) return end < 0 ? source.length : end;
  if (end < 0) return comma;
  return Math.min(comma, end);
}

function missingEqualsRecovery(
  source: string,
  position: number,
  close: string,
): number {
  const comma = source.indexOf(",", position);
  const end = source.indexOf(close, position);
  if (comma < 0 && end < 0) return source.length;
  return nextFieldBoundary(comma, end);
}

function unparsableFieldMessage(
  key: string,
  type: string,
): ProjectDiagnosticMessage {
  if (key) return { key: "unparsableFieldNamed", params: { key } };
  return { key: "unparsableField", params: { type } };
}

function missingFieldListMessage(
  key: string,
  type: string,
): ProjectDiagnosticMessage {
  if (key) return { key: "entryMissingFieldList", params: { key } };
  return { key: "incompleteEntry", params: { type } };
}

function unclosedEntryMessage(
  key: string,
  type: string,
): ProjectDiagnosticMessage {
  if (key) return { key: "unclosedEntryNamed", params: { key } };
  return { key: "unclosedEntry", params: { type } };
}

function parseEntryFields(
  scan: BibtexScan,
  start: number,
  close: string,
  type: string,
  key: string,
  hasFieldList: boolean,
): ParsedFields {
  const { source, starts } = scan;
  const fields: BibliographyField[] = [];
  let complete = hasFieldList;
  let entryTo = start;
  let position = start;

  while (position < source.length && source[position] !== "@") {
    position = skipWhitespaceAndCommas(source, position);
    if (source[position] === close) {
      entryTo = position + 1;
      position++;
      break;
    }
    if (position >= source.length || source[position] === "@") {
      complete = false;
      entryTo = position;
      break;
    }
    const nameMatch = /^([A-Za-z][A-Za-z0-9_-]*)\s*/.exec(source.slice(position));
    if (!nameMatch) {
      complete = false;
      const recovery = unparsableFieldRecovery(source, position, close);
      malformed(
        scan,
        position,
        Math.max(position + 1, recovery),
        unparsableFieldMessage(key, type),
      );
      position = recovery;
      continue;
    }
    const fieldFrom = position;
    const name = nameMatch[1].toLowerCase();
    position += nameMatch[0].length;
    if (source[position] !== "=") {
      complete = false;
      malformed(
        scan,
        fieldFrom,
        Math.min(source.length, Math.max(position + 1, fieldFrom + 1)),
        { key: "fieldMissingEquals", params: { name } },
      );
      position = missingEqualsRecovery(source, position, close);
      continue;
    }
    position++;
    const parsed = fieldValue(source, starts, position);
    position = parsed.next;
    complete &&= parsed.complete;
    if (!parsed.complete) {
      malformed(scan, fieldFrom, Math.max(fieldFrom + 1, position), {
        key: "fieldIncompleteValue",
        params: { name },
      });
    }
    fields.push({
      name,
      range: rangeFromOffsets(starts, fieldFrom, position),
      ...parsed.field,
    });
    entryTo = position;
  }

  return { fields, complete, entryTo, position };
}

function checkRequiredFields(
  scan: BibtexScan,
  entry: BibliographyEntryDetail,
  spec: EntrySpec,
): void {
  const required = BIBTEX_REQUIRED_FIELDS[spec.type];
  if (!required) {
    validationFinding(
      scan,
      entry.typeRange,
      "warning",
      { key: "unknownEntryType", params: { type: spec.type } },
      `unknown-type:${spec.type}`,
    );
    return;
  }
  const present = new Set(spec.fields.map((field) => field.name));
  for (const alternatives of required) {
    if (alternatives.some((name) => present.has(name))) continue;
    validationFinding(
      scan,
      entry.keyRange,
      "error",
      {
        key: "missingRequiredField",
        params: {
          entry: `@${spec.type}{${spec.key}}`,
          fields: alternatives.join(" or "),
        },
      },
      `missing-field:${alternatives.join("|")}`,
    );
  }
}

function reportRepeatedFields(
  scan: BibtexScan,
  key: string,
  fields: readonly BibliographyField[],
): void {
  const fieldsByName = new Map<string, BibliographyField[]>();
  for (const field of fields) {
    const values = fieldsByName.get(field.name);
    if (values) values.push(field);
    else fieldsByName.set(field.name, [field]);
  }
  for (const [name, values] of fieldsByName) {
    if (values.length < 2) continue;
    for (const field of values) {
      validationFinding(
        scan,
        field.range,
        "error",
        { key: "fieldRepeated", params: { name, key } },
        `duplicate-field:${name}:${field.range.from}`,
      );
    }
  }
}

function collectCrossReferences(
  scan: BibtexScan,
  fields: readonly BibliographyField[],
): void {
  const { file, source, starts } = scan;
  for (const field of fields) {
    if (!CROSS_REFERENCE_FIELDS.has(field.name)) continue;
    // `field.value` is normalized for metadata display. Resolution ranges
    // must instead be derived from the untouched source slice or whitespace
    // folding would shift every key after the first newline.
    const originalValue = source.slice(field.valueRange.from, field.valueRange.to);
    for (const match of originalValue.matchAll(/[^,]+/g)) {
      const raw = match[0];
      const targetKey = raw.trim();
      if (!targetKey) continue;
      const leading = raw.length - raw.trimStart().length;
      const from = field.valueRange.from + match.index + leading;
      scan.uses.push({
        id: stableId("use", "local", file, from, "citation", targetKey),
        source: "local",
        engine: "bibtex",
        kind: "citation",
        name: targetKey,
        location: {
          file,
          range: rangeFromOffsets(starts, from, from + targetKey.length),
        },
        syntax: "explicit",
        resolution: "unresolved",
        definitionIds: [],
      });
    }
  }
}

function checkYear(
  scan: BibtexScan,
  fields: readonly BibliographyField[],
): void {
  const year = fields.find((field) => field.name === "year");
  if (!year?.value || /^\d{4}[a-z]?$/.test(year.value)) return;
  validationFinding(
    scan,
    year.valueRange,
    "warning",
    { key: "invalidYear", params: { year: year.value } },
    "invalid-year",
  );
}

function recordEntry(scan: BibtexScan, spec: EntrySpec): void {
  const { file, starts } = scan;
  const entry: BibliographyEntryDetail = {
    id: stableId("bib", file, spec.keyFrom, spec.keyTo, spec.key),
    key: spec.key,
    type: spec.type,
    file,
    range: rangeFromOffsets(starts, spec.entryFrom, spec.entryTo),
    keyRange: rangeFromOffsets(starts, spec.keyFrom, spec.keyTo),
    typeRange: rangeFromOffsets(starts, spec.typeFrom, spec.typeTo),
    fields: spec.fields,
    complete: spec.complete,
    duplicate: false,
    duplicateIndex: 0,
    duplicateCount: 1,
    ...bibliographyEntrySummary(spec.type, file, spec.fields),
  };
  scan.entries.push(entry);
  checkRequiredFields(scan, entry, spec);
  reportRepeatedFields(scan, spec.key, spec.fields);
  collectCrossReferences(scan, spec.fields);
  checkYear(scan, spec.fields);
  const definitionId = stableId(
    "def",
    "local",
    file,
    spec.keyFrom,
    "bibentry",
    spec.key,
  );
  scan.definitions.push({
    id: definitionId,
    source: "local",
    engine: "bibtex",
    kind: "bibentry",
    name: spec.key,
    location: { file, range: entry.keyRange },
    detail: `@${spec.type}`,
  });
  scan.outline.push({
    id: stableId("outline", file, spec.keyFrom, "bibentry"),
    file,
    title: spec.key,
    kind: "bibentry",
    level: 0,
    parentId: null,
    range: entry.range,
    definitionId,
  });
}

function scanDirective(
  scan: BibtexScan,
  at: number,
  openOffset: number,
  open: string,
  type: string,
): number {
  const { source } = scan;
  const directiveEnd = findDirectiveEnd(source, openOffset, open);
  if (
    directiveEnd === source.length &&
    source[directiveEnd - 1] !== closingFor(open)
  ) {
    malformed(scan, at, directiveEnd, {
      key: "unclosedDirective",
      params: { type },
    });
  }
  return directiveEnd;
}

function scanEntry(
  scan: BibtexScan,
  entryFrom: number,
  openOffset: number,
  open: string,
  type: string,
  typeTo: number,
): number {
  const { source } = scan;
  const close = closingFor(open);
  const afterOpen = openOffset + 1;
  const keyDelimiter = findKeyDelimiter(source, afterOpen, close);
  const [keyFrom, keyTo] = trimRange(source, afterOpen, keyDelimiter);
  const key = source.slice(keyFrom, keyTo);
  if (!key) {
    malformed(
      scan,
      afterOpen,
      Math.min(source.length, Math.max(afterOpen + 1, keyDelimiter)),
      { key: "missingCitationKey", params: { type } },
    );
  }
  const hasFieldList = source[keyDelimiter] === ",";
  if (!hasFieldList) {
    malformed(
      scan,
      entryFrom,
      Math.min(source.length, Math.max(keyDelimiter + 1, entryFrom + 1)),
      missingFieldListMessage(key, type),
    );
  }
  const parsed = parseEntryFields(
    scan,
    hasFieldList ? keyDelimiter + 1 : keyDelimiter,
    close,
    type,
    key,
    hasFieldList,
  );
  let { complete, entryTo } = parsed;
  if (entryTo <= entryFrom) entryTo = Math.max(entryFrom + 1, parsed.position);
  if (source[entryTo - 1] !== close) {
    complete = false;
    malformed(scan, entryFrom, entryTo, unclosedEntryMessage(key, type));
  }
  if (key) {
    recordEntry(scan, {
      entryFrom,
      entryTo,
      typeFrom: entryFrom + 1,
      typeTo,
      keyFrom,
      keyTo,
      key,
      type,
      fields: parsed.fields,
      complete,
    });
  }
  return Math.max(parsed.position, entryFrom + 1);
}

function scanFrom(scan: BibtexScan, at: number): number {
  const { source } = scan;
  const typeMatch = /^@([A-Za-z][A-Za-z0-9_-]*)\s*/.exec(source.slice(at));
  if (!typeMatch) {
    malformed(scan, at, Math.min(source.length, at + 1), {
      key: "malformedDirective",
    });
    return at + 1;
  }
  const type = typeMatch[1].toLowerCase();
  const openOffset = at + typeMatch[0].length;
  const open = source[openOffset];
  if (open !== "{" && open !== "(") {
    malformed(scan, at, Math.min(source.length, openOffset + 1), {
      key: "typeDelimiterExpected",
      params: { type },
    });
    return openOffset + 1;
  }
  if (DIRECTIVE_TYPES.has(type)) {
    return scanDirective(scan, at, openOffset, open, type);
  }
  return scanEntry(
    scan,
    at,
    openOffset,
    open,
    type,
    at + 1 + typeMatch[1].length,
  );
}

export function parseBibtexIntelligence(
  file: string,
  source: string,
  sourceRevision: number,
): FileAnalysis {
  const starts = lineStarts(source);
  const scan: BibtexScan = {
    file,
    source,
    starts,
    entries: [],
    definitions: [],
    uses: [],
    outline: [],
    diagnostics: [],
    partial: false,
  };

  scan.definitions.push({
    id: stableId("def", "local", file, 0, "file", file),
    source: "local",
    engine: "bibtex",
    kind: "file",
    name: file,
    location: {
      file,
      range: rangeFromOffsets(starts, 0, 0),
    },
    detail: "Project bibliography file",
  });

  let cursor = 0;
  while (cursor < source.length) {
    const at = source.indexOf("@", cursor);
    if (at < 0) break;
    cursor = scanFrom(scan, at);
  }

  return {
    file,
    engine: "bibtex",
    sourceRevision,
    contentHash: sourceHash(source),
    status: scan.partial ? "partial" : "success",
    ...(scan.partial
      ? {
          statusReason:
            "BibTeX recovery retained entries around malformed source.",
        }
      : {}),
    outline: scan.outline,
    definitions: scan.definitions,
    uses: scan.uses,
    edges: [],
    diagnostics: scan.diagnostics,
    bibliographyEntries: scan.entries,
  };
}
