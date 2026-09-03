import type {
  BibliographyEntry,
  BibliographyEntryDetail,
  BibliographyEntrySummary,
  BibliographyField,
} from "./types";

function fieldValue(
  fields: readonly BibliographyField[],
  name: string,
): string | undefined {
  return fields.find((field) => field.name === name)?.value;
}

export function bibliographyEntrySummary(
  type: string,
  file: string,
  fields: readonly BibliographyField[],
): BibliographyEntrySummary {
  const author =
    fieldValue(fields, "author") ?? fieldValue(fields, "editor");
  const title = fieldValue(fields, "title");
  const year = fieldValue(fields, "year") ?? fieldValue(fields, "date");
  const display =
    [author, year, title].filter(Boolean).join(" · ") ||
    `@${type} in ${file}`;
  return {
    ...(author ? { author } : {}),
    ...(title ? { title } : {}),
    ...(year ? { year } : {}),
    display,
  };
}

export function summarizeBibliographyEntry(
  entry: BibliographyEntryDetail,
): BibliographyEntry {
  return {
    id: entry.id,
    key: entry.key,
    type: entry.type,
    file: entry.file,
    range: entry.range,
    keyRange: entry.keyRange,
    complete: entry.complete,
    duplicate: entry.duplicate,
    duplicateIndex: entry.duplicateIndex,
    duplicateCount: entry.duplicateCount,
    ...(entry.author ? { author: entry.author } : {}),
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.year ? { year: entry.year } : {}),
    display: entry.display,
  };
}
