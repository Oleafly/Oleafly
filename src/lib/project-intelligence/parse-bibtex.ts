import {
  lineStarts,
  location,
  rangeFromOffsets,
  sourceHash,
  stableId,
  trimRange,
} from "./source";
import type {
  BibliographyEntry,
  BibliographyField,
  FileIntelligence,
  OutlineNode,
  ProjectDefinition,
  ProjectDiagnostic,
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

function fieldValue(
  source: string,
  starts: readonly number[],
  offset: number,
): {
  field: Omit<BibliographyField, "name" | "range">;
  next: number;
  complete: boolean;
} {
  const cursor = skipWhitespaceAndCommas(source, offset);
  const char = source[cursor];
  if (char === "{") {
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
    const complete = depth === 0;
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
  if (char === '"') {
    let end = cursor + 1;
    let complete = false;
    while (end < source.length) {
      if (looksLikeEntryStart(source, end)) break;
      if (source[end] === "\\") {
        end += 2;
        continue;
      }
      if (source[end] === '"') {
        complete = true;
        break;
      }
      end++;
    }
    const valueTo = end;
    return {
      field: {
        value: source.slice(cursor + 1, valueTo).replace(/\s+/g, " ").trim(),
        valueRange: rangeFromOffsets(starts, cursor + 1, valueTo),
        valueStyle: "quoted",
        complete,
      },
      // If a new top-level entry starts before the quote closes, recover at
      // that entry instead of swallowing the rest of the bibliography.
      next: complete ? end + 1 : end,
      complete,
    };
  }
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

export function parseBibtexIntelligence(
  file: string,
  source: string,
  sourceRevision: number,
): FileIntelligence {
  const starts = lineStarts(source);
  const entries: BibliographyEntry[] = [];
  const definitions: ProjectDefinition[] = [];
  const uses: ProjectUse[] = [];
  const outline: OutlineNode[] = [];
  const diagnostics: ProjectDiagnostic[] = [];
  let partial = false;
  let cursor = 0;

  definitions.push({
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

  const malformed = (
    from: number,
    to: number,
    message: string,
  ) => {
    partial = true;
    const diagnosticLocation = location(file, starts, from, to);
    diagnostics.push({
      id: stableId("diag", file, from, to, "malformed-bibtex"),
      source: "project-intelligence",
      severity: "error",
      code: "malformed-bibtex",
      message,
      location: diagnosticLocation,
      related: [],
    });
  };
  const validationFinding = (
    range: ReturnType<typeof rangeFromOffsets>,
    severity: "error" | "warning",
    message: string,
    discriminator: string,
  ) => {
    diagnostics.push({
      id: stableId(
        "diag",
        file,
        range.from,
        "bibtex-validation",
        discriminator,
      ),
      source: "project-intelligence",
      severity,
      code: "bibtex-validation",
      message,
      location: { file, range },
      related: [],
    });
  };

  while (cursor < source.length) {
    const at = source.indexOf("@", cursor);
    if (at < 0) break;
    const typeMatch = /^@([A-Za-z][A-Za-z0-9_-]*)\s*/.exec(
      source.slice(at),
    );
    if (!typeMatch) {
      malformed(
        at,
        Math.min(source.length, at + 1),
        "Malformed BibTeX directive or entry type.",
      );
      cursor = at + 1;
      continue;
    }
    const type = typeMatch[1].toLowerCase();
    const typeFrom = at + 1;
    let position = at + typeMatch[0].length;
    const open = source[position];
    if (open !== "{" && open !== "(") {
      malformed(
        at,
        Math.min(source.length, position + 1),
        `@${type} must be followed by "{" or "(".`,
      );
      cursor = position + 1;
      continue;
    }
    if (DIRECTIVE_TYPES.has(type)) {
      const directiveEnd = findDirectiveEnd(source, position, open);
      if (
        directiveEnd === source.length &&
        source[directiveEnd - 1] !== closingFor(open)
      ) {
        malformed(
          at,
          directiveEnd,
          `@${type} directive is not closed.`,
        );
      }
      cursor = directiveEnd;
      continue;
    }

    const entryFrom = at;
    const close = closingFor(open);
    position++;
    const keyDelimiter = (() => {
      for (let index = position; index < source.length; index++) {
        const char = source[index];
        if (char === "," || char === close || char === "@") return index;
      }
      return source.length;
    })();
    const [keyFrom, keyTo] = trimRange(
      source,
      position,
      keyDelimiter,
    );
    const key = source.slice(keyFrom, keyTo);
    if (!key) {
      malformed(
        position,
        Math.min(source.length, Math.max(position + 1, keyDelimiter)),
        `@${type} is missing a citation key.`,
      );
    }
    if (source[keyDelimiter] !== ",") {
      malformed(
        entryFrom,
        Math.min(source.length, Math.max(keyDelimiter + 1, entryFrom + 1)),
        key
          ? `Bibliography entry "${key}" has no field list.`
          : `Incomplete @${type} entry.`,
      );
    }

    position =
      source[keyDelimiter] === "," ? keyDelimiter + 1 : keyDelimiter;
    const fields: BibliographyField[] = [];
    let complete = source[keyDelimiter] === ",";
    let entryTo = position;

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
      const nameMatch = /^([A-Za-z][A-Za-z0-9_-]*)\s*/.exec(
        source.slice(position),
      );
      if (!nameMatch) {
        complete = false;
        const recovery = (() => {
          const comma = source.indexOf(",", position + 1);
          const end = source.indexOf(close, position + 1);
          if (comma < 0) return end < 0 ? source.length : end;
          if (end < 0) return comma;
          return Math.min(comma, end);
        })();
        malformed(
          position,
          Math.max(position + 1, recovery),
          key
            ? `Could not parse a field in "${key}".`
            : `Could not parse an @${type} field.`,
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
          fieldFrom,
          Math.min(source.length, Math.max(position + 1, fieldFrom + 1)),
          `Field "${name}" is missing "=".`,
        );
        const comma = source.indexOf(",", position);
        const end = source.indexOf(close, position);
        if (comma < 0 && end < 0) {
          position = source.length;
          break;
        }
        position =
          comma < 0 ? end : end < 0 ? comma : Math.min(comma, end);
        continue;
      }
      position++;
      const parsed = fieldValue(source, starts, position);
      position = parsed.next;
      complete &&= parsed.complete;
      if (!parsed.complete) {
        malformed(
          fieldFrom,
          Math.max(fieldFrom + 1, position),
          `Field "${name}" has an incomplete value.`,
        );
      }
      fields.push({
        name,
        range: rangeFromOffsets(starts, fieldFrom, position),
        ...parsed.field,
      });
      entryTo = position;
    }

    if (entryTo <= entryFrom) entryTo = Math.max(entryFrom + 1, position);
    if (source[entryTo - 1] !== close) {
      complete = false;
      malformed(
        entryFrom,
        entryTo,
        key
          ? `Bibliography entry "${key}" is not closed.`
          : `@${type} entry is not closed.`,
      );
    }

    if (key) {
      const entryId = stableId("bib", file, keyFrom, keyTo, key);
      const entry: BibliographyEntry = {
        id: entryId,
        key,
        type,
        file,
        range: rangeFromOffsets(starts, entryFrom, entryTo),
        keyRange: rangeFromOffsets(starts, keyFrom, keyTo),
        typeRange: rangeFromOffsets(
          starts,
          typeFrom,
          typeFrom + typeMatch[1].length,
        ),
        fields,
        complete,
        duplicate: false,
        duplicateIndex: 0,
        duplicateCount: 1,
      };
      entries.push(entry);
      const required = BIBTEX_REQUIRED_FIELDS[type];
      if (!required) {
        validationFinding(
          entry.typeRange,
          "warning",
          `Unknown bibliography entry type @${type}.`,
          `unknown-type:${type}`,
        );
      } else {
        const present = new Set(fields.map((field) => field.name));
        for (const alternatives of required) {
          if (alternatives.some((name) => present.has(name))) continue;
          validationFinding(
            entry.keyRange,
            "error",
            `@${type}{${key}} is missing required field ${alternatives.join(" or ")}.`,
            `missing-field:${alternatives.join("|")}`,
          );
        }
      }
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
            field.range,
            "error",
            `Field "${name}" is repeated in bibliography entry "${key}".`,
            `duplicate-field:${name}:${field.range.from}`,
          );
        }
      }
      for (const field of fields) {
        if (
          ![
            "crossref",
            "xref",
            "xdata",
            "related",
            "entryset",
          ].includes(field.name)
        ) {
          continue;
        }
        // `field.value` is normalized for metadata display. Resolution ranges
        // must instead be derived from the untouched source slice or whitespace
        // folding would shift every key after the first newline.
        const originalValue = source.slice(
          field.valueRange.from,
          field.valueRange.to,
        );
        for (const match of originalValue.matchAll(/[^,]+/g)) {
          const raw = match[0];
          const targetKey = raw.trim();
          if (!targetKey) continue;
          const leading = raw.length - raw.trimStart().length;
          const from = field.valueRange.from + match.index + leading;
          uses.push({
            id: stableId(
              "use",
              "local",
              file,
              from,
              "citation",
              targetKey,
            ),
            source: "local",
            engine: "bibtex",
            kind: "citation",
            name: targetKey,
            location: {
              file,
              range: rangeFromOffsets(
                starts,
                from,
                from + targetKey.length,
              ),
            },
            syntax: "explicit",
            resolution: "unresolved",
            definitionIds: [],
          });
        }
      }
      const year = fields.find((field) => field.name === "year");
      if (year?.value && !/^\d{4}[a-z]?$/.test(year.value)) {
        validationFinding(
          year.valueRange,
          "warning",
          `Year "${year.value}" is not a four-digit BibTeX year.`,
          "invalid-year",
        );
      }
      const definitionId = stableId(
        "def",
        "local",
        file,
        keyFrom,
        "bibentry",
        key,
      );
      definitions.push({
        id: definitionId,
        source: "local",
        engine: "bibtex",
        kind: "bibentry",
        name: key,
        location: { file, range: entry.keyRange },
        detail: `@${type}`,
      });
      outline.push({
        id: stableId("outline", file, keyFrom, "bibentry"),
        file,
        title: key,
        kind: "bibentry",
        level: 0,
        parentId: null,
        range: entry.range,
        definitionId,
      });
    }
    cursor = Math.max(position, at + 1);
  }

  return {
    file,
    engine: "bibtex",
    sourceRevision,
    contentHash: sourceHash(source),
    status: partial ? "partial" : "success",
    ...(partial
      ? {
          statusReason:
            "BibTeX recovery retained entries around malformed source.",
        }
      : {}),
    outline,
    definitions,
    uses,
    edges: [],
    diagnostics,
    bibliographyEntries: entries,
  };
}
