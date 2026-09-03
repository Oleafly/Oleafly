import type {
  CitationCompletion,
  ProjectDefinition,
  ProjectEdge,
  ProjectHierarchyNode,
  ProjectIntelligenceSnapshot,
  ProjectUse,
  SourceLocation,
} from "./types";

export type ProjectSymbol = ProjectDefinition | ProjectUse;

function contains(
  symbol: ProjectSymbol,
  path: string,
  offset: number,
): boolean {
  return (
    symbol.location.file === path &&
    offset >= symbol.location.range.from &&
    (offset < symbol.location.range.to ||
      (symbol.location.range.from === symbol.location.range.to &&
        offset === symbol.location.range.from))
  );
}

function narrowest<T extends ProjectSymbol>(
  symbols: readonly T[],
): T | null {
  return (
    [...symbols].sort(
      (left, right) =>
        left.location.range.to -
          left.location.range.from -
          (right.location.range.to - right.location.range.from) ||
        left.id.localeCompare(right.id),
    )[0] ?? null
  );
}

export function symbolAt(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
  offset: number,
): ProjectSymbol | null {
  // Uses win an exact tie: at a reference token F12 should navigate to its
  // definition rather than treating a broad containing definition as active.
  return (
    narrowest(snapshot.uses.filter((use) => contains(use, path, offset))) ??
    narrowest(
      snapshot.definitions.filter((definition) =>
        contains(definition, path, offset),
      ),
    )
  );
}

export function definitionAt(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
  offset: number,
): ProjectDefinition | null {
  return narrowest(
    snapshot.definitions.filter((definition) =>
      contains(definition, path, offset),
    ),
  );
}

export function definitionsForUse(
  snapshot: ProjectIntelligenceSnapshot,
  useId: string,
): readonly ProjectDefinition[] {
  const use = snapshot.uses.find((candidate) => candidate.id === useId);
  if (!use) return [];
  const ids = new Set(use.definitionIds);
  return snapshot.definitions.filter((definition) =>
    ids.has(definition.id),
  );
}

export function referencesFor(
  snapshot: ProjectIntelligenceSnapshot,
  definitionId: string,
): readonly ProjectUse[] {
  return snapshot.uses.filter((use) =>
    use.definitionIds.includes(definitionId),
  );
}

export function projectChildren(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
): {
  readonly nodes: readonly ProjectHierarchyNode[];
  readonly edges: readonly ProjectEdge[];
} {
  const edges = snapshot.hierarchy.edges.filter(
    (edge) =>
      edge.fromFile === path &&
      (edge.kind === "include" || edge.kind === "import"),
  );
  const targets = new Set(
    edges.flatMap((edge) =>
      edge.targetFile ? [edge.targetFile] : edge.candidateFiles,
    ),
  );
  return {
    nodes: snapshot.hierarchy.nodes.filter((node) =>
      targets.has(node.file),
    ),
    edges,
  };
}

function completionScore(
  completion: CitationCompletion,
  normalizedQuery: string,
): number {
  if (!normalizedQuery) return 4;
  const key = completion.key.toLocaleLowerCase("en-US");
  const title = completion.title?.toLocaleLowerCase("en-US") ?? "";
  const author = completion.author?.toLocaleLowerCase("en-US") ?? "";
  if (key === normalizedQuery) return 0;
  if (key.startsWith(normalizedQuery)) return 1;
  if (key.includes(normalizedQuery)) return 2;
  if (author.includes(normalizedQuery) || title.includes(normalizedQuery)) {
    return 3;
  }
  return Number.POSITIVE_INFINITY;
}

export function citationCompletions(
  snapshot: ProjectIntelligenceSnapshot,
  query: string,
  limit = 100,
): readonly CitationCompletion[] {
  const safeLimit = Number.isInteger(limit)
    ? Math.max(0, Math.min(500, limit))
    : 100;
  const normalizedQuery = query
    .trim()
    .replace(/^@/, "")
    .toLocaleLowerCase("en-US");
  return snapshot.bibliography.entries
    .map(
      (entry) =>
        ({
          id: entry.id,
          key: entry.key,
          label: entry.key,
          detail: entry.display,
          type: entry.type,
          ...(entry.author ? { author: entry.author } : {}),
          ...(entry.title ? { title: entry.title } : {}),
          ...(entry.year ? { year: entry.year } : {}),
          location: { file: entry.file, range: entry.keyRange },
          duplicate: entry.duplicate,
          duplicateIndex: entry.duplicateIndex,
          duplicateCount: entry.duplicateCount,
        }) satisfies CitationCompletion,
    )
    .map((completion) => ({
      completion,
      score: completionScore(completion, normalizedQuery),
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.completion.key.localeCompare(right.completion.key) ||
        left.completion.location.file.localeCompare(
          right.completion.location.file,
        ) ||
        left.completion.location.range.from -
          right.completion.location.range.from,
    )
    .slice(0, safeLimit)
    .map(({ completion }) => completion);
}

export function safeLinePreview(
  texts: Readonly<Record<string, string>>,
  sourceLocation: SourceLocation,
  maxLength = 240,
): string {
  const safeMaxLength = Number.isInteger(maxLength)
    ? Math.max(16, Math.min(2_000, maxLength))
    : 240;
  const text = texts[sourceLocation.file];
  if (text === undefined) return "";
  const line =
    text.split("\n")[sourceLocation.range.startLine - 1]?.trim() ?? "";
  if (line.length <= safeMaxLength) return line;
  return `${line.slice(0, Math.max(0, safeMaxLength - 1)).trimEnd()}…`;
}
