export type InsightsEngine = "typst" | "latex" | "markdown";

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
}

export type InsightEntryKind = "heading" | "figure" | "table" | "equation";

export interface InsightEntry {
  id: string;
  kind: InsightEntryKind;
  text: string;
  label: string | null;
  level: number | null;
  figureKind: string | null;
  page: number | string | null;
  number?: string | null;
  numbered: boolean;
  location: SourceLocation | null;
}

export interface LabelEntry {
  name: string;
  kind: InsightEntryKind | "other";
  location: SourceLocation | null;
}

export interface CitationEntry {
  key: string;
  count: number;
  location: SourceLocation | null;
  unresolved?: boolean;
}

export interface TodoEntry {
  text: string;
  location: SourceLocation;
}

export interface SubmissionMetadata {
  title: string | null;
  authors: string[];
  abstract: string | null;
  keywords: string[];
  date: string | null;
}

export interface DocumentInsightsBase {
  headings: InsightEntry[];
  figures: InsightEntry[];
  tables: InsightEntry[];
  equations: InsightEntry[];
  labels: LabelEntry[];
  citations: CitationEntry[];
  todos: TodoEntry[];
  metadata: SubmissionMetadata;
}

export const TODO_MARKER = /\b(?:TODO|FIXME|XXX)\b/u;
const MAX_TODO_CHARS = 160;

export function emptyMetadata(): SubmissionMetadata {
  return { title: null, authors: [], abstract: null, keywords: [], date: null };
}

export function emptyInsights(): DocumentInsightsBase {
  return {
    headings: [],
    figures: [],
    tables: [],
    equations: [],
    labels: [],
    citations: [],
    todos: [],
    metadata: emptyMetadata(),
  };
}

export function todoText(rest: string): string {
  const text = rest.replaceAll(/\s+/gu, " ").trim();
  return text.length > MAX_TODO_CHARS ? `${text.slice(0, MAX_TODO_CHARS)}…` : text;
}

export function lineLocator(text: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
}

export function citationList(
  uses: readonly { key: string; location: SourceLocation }[],
  bibliographyKeys: ReadonlySet<string> | null,
): CitationEntry[] {
  const byKey = new Map<string, CitationEntry>();
  for (const use of uses) {
    const existing = byKey.get(use.key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const entry: CitationEntry = { key: use.key, count: 1, location: use.location };
    if (bibliographyKeys) entry.unresolved = !bibliographyKeys.has(use.key);
    byKey.set(use.key, entry);
  }
  return [...byKey.values()];
}

export function bibtexKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(/@([A-Za-z]+)\s*[{(]\s*([^,\s{}()]+)\s*,/gu)) {
    const type = match[1].toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble") continue;
    keys.push(match[2]);
  }
  return keys;
}

export function formatSubmissionMetadata(metadata: SubmissionMetadata, labels: {
  title: string;
  authors: string;
  keywords: string;
  abstract: string;
}): string {
  const lines: string[] = [];
  if (metadata.title) lines.push(`${labels.title}: ${metadata.title}`);
  if (metadata.authors.length > 0) lines.push(`${labels.authors}: ${metadata.authors.join(", ")}`);
  if (metadata.keywords.length > 0) lines.push(`${labels.keywords}: ${metadata.keywords.join(", ")}`);
  if (metadata.abstract) lines.push("", `${labels.abstract}:`, metadata.abstract);
  return lines.join("\n").trim();
}

export function hasSubmissionMetadata(metadata: SubmissionMetadata): boolean {
  return !!metadata.title || metadata.authors.length > 0 || !!metadata.abstract || metadata.keywords.length > 0;
}
