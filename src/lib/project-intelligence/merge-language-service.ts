import { stableId } from "./source";
import type {
  ExternalProjectIntelligence,
  OutlineNode,
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectUse,
} from "./types";
import { sameProjectIntelligenceIdentity } from "./worker-protocol";

function definitionSignature(definition: ProjectDefinition): string {
  return [
    definition.kind,
    definition.name,
    definition.location.file,
    definition.location.range.from,
    definition.location.range.to,
  ].join("\0");
}

function useSignature(use: ProjectUse): string {
  return [
    use.kind,
    use.name,
    use.location.file,
    use.location.range.from,
    use.location.range.to,
  ].join("\0");
}

function deduplicateDefinitions(
  local: readonly ProjectDefinition[],
  external: readonly ProjectDefinition[],
): ProjectDefinition[] {
  const signatures = new Set(local.map(definitionSignature));
  const localRangesBySymbol = new Map<
    string,
    ProjectDefinition[]
  >();
  for (const definition of local) {
    const key = [
      definition.kind,
      definition.name,
      definition.location.file,
    ].join("\0");
    const existing = localRangesBySymbol.get(key);
    if (existing) existing.push(definition);
    else localRangesBySymbol.set(key, [definition]);
  }
  const semanticallyLocal = (
    candidate: ProjectDefinition,
  ): boolean => {
    const key = [
      candidate.kind,
      candidate.name,
      candidate.location.file,
    ].join("\0");
    return (localRangesBySymbol.get(key) ?? []).some(
      (definition) =>
        definition.location.range.from <
          candidate.location.range.to &&
        candidate.location.range.from <
          definition.location.range.to,
    );
  };
  return [
    ...local,
    ...external.filter((definition) => {
      const signature = definitionSignature(definition);
      if (
        signatures.has(signature) ||
        semanticallyLocal(definition)
      ) {
        return false;
      }
      signatures.add(signature);
      return true;
    }),
  ].sort(
    (left, right) =>
      left.location.file.localeCompare(right.location.file) ||
      left.location.range.from - right.location.range.from ||
      left.id.localeCompare(right.id),
  );
}

function definitionCandidates(
  use: ProjectUse,
  definitionsByKey: ReadonlyMap<
    string,
    readonly ProjectDefinition[]
  >,
): readonly ProjectDefinition[] {
  if (use.kind === "reference") {
    return definitionsByKey.get(`reference:${use.name}`) ?? [];
  }
  if (use.kind === "citation") {
    return definitionsByKey.get(`citation:${use.name}`) ?? [];
  }
  if (use.kind === "macro") {
    return definitionsByKey.get(`macro:${use.name}`) ?? [];
  }
  if (use.kind === "environment") {
    return definitionsByKey.get(`environment:${use.name}`) ?? [];
  }
  return [];
}

function resolveAgainstMergedDefinitions(
  use: ProjectUse,
  definitionsByKey: ReadonlyMap<
    string,
    readonly ProjectDefinition[]
  >,
): ProjectUse {
  if (
    use.kind !== "reference" &&
    use.kind !== "citation" &&
    use.kind !== "macro" &&
    use.kind !== "environment"
  ) {
    return use;
  }
  const candidates = definitionCandidates(use, definitionsByKey);
  if (candidates.length === 0) return use;
  return {
    ...use,
    resolution:
      candidates.length === 1 ? "resolved" : "duplicate",
    definitionIds: candidates.map((definition) => definition.id),
  };
}

function deduplicateUses(
  local: readonly ProjectUse[],
  external: readonly ProjectUse[],
  definitions: readonly ProjectDefinition[],
): ProjectUse[] {
  const signatures = new Set(local.map(useSignature));
  const definitionsByKey = new Map<string, ProjectDefinition[]>();
  for (const definition of definitions) {
    const namespace =
      definition.kind === "label" || definition.kind === "anchor"
        ? "reference"
        : definition.kind === "bibentry"
          ? "citation"
          : definition.kind;
    if (
      namespace !== "reference" &&
      namespace !== "citation" &&
      namespace !== "macro" &&
      namespace !== "environment"
    ) {
      continue;
    }
    const key = `${namespace}:${definition.name}`;
    const values = definitionsByKey.get(key);
    if (values) values.push(definition);
    else definitionsByKey.set(key, [definition]);
  }
  return [
    ...local,
    ...external.filter((use) => {
      const signature = useSignature(use);
      if (signatures.has(signature)) return false;
      signatures.add(signature);
      return true;
    }),
  ]
    .map((use) =>
      resolveAgainstMergedDefinitions(use, definitionsByKey),
    )
    .sort(
      (left, right) =>
        left.location.file.localeCompare(right.location.file) ||
        left.location.range.from - right.location.range.from ||
        left.id.localeCompare(right.id),
    );
}

function mergeOutlines(
  snapshot: ProjectIntelligenceSnapshot,
  externalDefinitions: readonly ProjectDefinition[],
): Readonly<Record<string, readonly OutlineNode[]>> {
  const outlines = Object.fromEntries(
    Object.entries(snapshot.outlines).map(([file, nodes]) => [
      file,
      [...nodes],
    ]),
  );
  for (const definition of externalDefinitions) {
    if (
      definition.kind !== "section" &&
      definition.kind !== "macro" &&
      definition.kind !== "environment"
    ) {
      continue;
    }
    const nodes = outlines[definition.location.file] ?? [];
    const duplicate = nodes.some(
      (node) =>
        node.kind === definition.kind &&
        node.title === definition.name &&
        node.range.from === definition.location.range.from &&
        node.range.to === definition.location.range.to,
    );
    if (duplicate) continue;
    nodes.push({
      id: stableId(
        "outline",
        definition.source,
        definition.location.file,
        definition.location.range.from,
        definition.kind,
      ),
      file: definition.location.file,
      title: definition.name,
      kind: definition.kind,
      level: definition.level ?? 0,
      parentId: null,
      range: definition.location.range,
      definitionId: definition.id,
    });
    outlines[definition.location.file] = nodes;
  }
  for (const nodes of Object.values(outlines)) {
    nodes.sort(
      (left, right) =>
        left.range.from - right.range.from ||
        left.id.localeCompare(right.id),
    );
  }
  return outlines;
}

/**
 * Merges already-normalized, current-revision language-service contributions
 * with the local Markdown/BibTeX/project graph. Exact source signatures win
 * over provider identity, so a TexLab/Tinymist symbol already recovered by
 * the local parser is represented exactly once.
 */
export function mergeLanguageServiceIntelligence(
  snapshot: ProjectIntelligenceSnapshot,
  external: ExternalProjectIntelligence,
): ProjectIntelligenceSnapshot {
  if (
    !sameProjectIntelligenceIdentity(
      snapshot.identity,
      external.identity,
    )
  ) {
    return snapshot;
  }
  const acceptedDefinitions = external.definitions.filter(
    (definition) =>
      definition.source === "texlab" ||
      definition.source === "tinymist",
  );
  const acceptedUses = external.uses.filter(
    (use) =>
      use.source === "texlab" || use.source === "tinymist",
  );
  const definitions = deduplicateDefinitions(
    snapshot.definitions,
    acceptedDefinitions,
  );
  const uses = deduplicateUses(
    snapshot.uses,
    acceptedUses,
    definitions,
  );
  const unresolvedLocations = new Set(
    uses
      .filter(
        (use) =>
          (use.kind === "reference" || use.kind === "citation") &&
          use.resolution === "unresolved",
      )
      .map(
        (use) =>
          `${use.location.file}:${use.location.range.from}:${use.location.range.to}`,
      ),
  );
  const diagnostics = snapshot.diagnostics.filter((diagnostic) => {
    if (
      diagnostic.code !== "unresolved-reference" &&
      diagnostic.code !== "unresolved-citation"
    ) {
      return true;
    }
    return unresolvedLocations.has(
      `${diagnostic.location.file}:${diagnostic.location.range.from}:${diagnostic.location.range.to}`,
    );
  });
  return {
    ...snapshot,
    definitions,
    uses,
    diagnostics,
    outlines: mergeOutlines(snapshot, acceptedDefinitions),
  };
}
