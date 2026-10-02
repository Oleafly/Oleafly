import { type HayagrivaField, hayagrivaEntries } from "@/lib/citation/hayagriva";
import { bibliographyEntrySummary } from "./bibliography-summary";
import { lineStarts, rangeFromOffsets, sourceHash, stableId } from "./source";
import type {
  BibliographyEntryDetail,
  BibliographyField,
  FileAnalysis,
  OutlineNode,
  ProjectDefinition,
} from "./types";

function bibliographyField(
  starts: readonly number[],
  field: HayagrivaField | undefined,
  name: string,
  value: string | undefined,
): BibliographyField[] {
  if (!field || !value) return [];
  const range = rangeFromOffsets(starts, field.from, field.to);
  return [{ name, value, range, valueRange: range, valueStyle: "bare", complete: true }];
}

export function parseHayagrivaIntelligence(
  file: string,
  source: string,
  sourceRevision: number,
): FileAnalysis {
  const starts = lineStarts(source);
  const entries: BibliographyEntryDetail[] = [];
  const definitions: ProjectDefinition[] = [];
  const outline: OutlineNode[] = [];

  for (const entry of hayagrivaEntries(source)) {
    if (!entry.isEntry) continue;
    const type = (entry.type ?? "misc").toLowerCase();
    const year = /^\d{4}/.exec(entry.date?.value ?? "")?.[0];
    const fields = [
      ...bibliographyField(starts, entry.title, "title", entry.title?.value),
      ...bibliographyField(starts, entry.author, "author", entry.author?.value),
      ...bibliographyField(starts, entry.date, "year", year),
    ];
    const keyRange = rangeFromOffsets(starts, entry.keyFrom, entry.keyTo);
    const range = rangeFromOffsets(starts, entry.from, entry.to);
    const definitionId = stableId("def", "local", file, entry.keyFrom, "bibentry", entry.key);
    entries.push({
      id: stableId("bib", file, entry.keyFrom, entry.keyTo, entry.key),
      key: entry.key,
      type,
      file,
      range,
      keyRange,
      typeRange: keyRange,
      fields,
      complete: true,
      duplicate: false,
      duplicateIndex: 0,
      duplicateCount: 1,
      ...bibliographyEntrySummary(type, file, fields),
    });
    definitions.push({
      id: definitionId,
      source: "local",
      engine: "bibtex",
      kind: "bibentry",
      name: entry.key,
      location: { file, range: keyRange },
      detail: `@${type}`,
    });
    outline.push({
      id: stableId("outline", file, entry.keyFrom, "bibentry"),
      file,
      title: entry.key,
      kind: "bibentry",
      level: 0,
      parentId: null,
      range,
      definitionId,
    });
  }

  if (entries.length > 0) {
    definitions.unshift({
      id: stableId("def", "local", file, 0, "file", file),
      source: "local",
      engine: "bibtex",
      kind: "file",
      name: file,
      location: { file, range: rangeFromOffsets(starts, 0, 0) },
      detail: "Project bibliography file",
    });
  }

  return {
    file,
    engine: "bibtex",
    sourceRevision,
    contentHash: sourceHash(source),
    status: "success",
    outline,
    definitions,
    uses: [],
    edges: [],
    diagnostics: [],
    bibliographyEntries: entries,
  };
}
