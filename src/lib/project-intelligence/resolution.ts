import type { LatexUnitScope } from "./latex-units";
import { engineForPath } from "./source";
import type {
  ProjectDefinition,
  ProjectIntelligenceEngine,
  ProjectUse,
  ResolutionStatus,
} from "./types";

export const THEOREM_ENVIRONMENT_DETAIL = "theorem environment";

/**
 * The pool a label or anchor name lives in. LaTeX `\label`, Typst `<label>`
 * and a Markdown anchor are resolved by different compilers, so a name in one
 * engine never satisfies, or duplicates, the same name in another. Markdown
 * anchors belong to the file that declares them.
 *
 * Two LaTeX documents in one project still share a pool here. What a use can
 * see inside it is decided per compilation unit, by the `LatexUnitScope`
 * passed to `definitionCandidatesForUse`.
 *
 * The legacy rename index (`@/lib/index/build`) scopes labels through this
 * too, so rename and resolution agree.
 */
export function labelScope(
  engine: ProjectIntelligenceEngine | null,
  file: string,
): string {
  return engine === "markdown" ? `markdown:${file}` : (engine ?? "unknown");
}

export function referenceTargetFile(target: string | undefined): string | null {
  const hash = target?.indexOf("#") ?? -1;
  return target && hash >= 0 ? target.slice(0, hash) : null;
}

function referenceKey(scope: string, name: string): string {
  return `reference:${scope}:${name}`;
}

function definitionKey(
  definition: ProjectDefinition,
): string | null {
  if (definition.kind === "label" || definition.kind === "anchor") {
    return referenceKey(
      labelScope(definition.engine, definition.location.file),
      definition.name,
    );
  }
  // Every .bib file is read by LaTeX, Typst and Markdown alike, so citation
  // keys share one project-wide pool. Two copies of one .bib (one per
  // document) therefore still count as duplicates until bibliography edges
  // scope them.
  if (definition.kind === "bibentry") {
    return `citation:${definition.name}`;
  }
  if (definition.kind === "macro") return `macro:${definition.name}`;
  if (definition.kind === "environment") {
    return `environment:${definition.name}`;
  }
  if (definition.kind === "glossary") {
    return `glossary:${definition.name}`;
  }
  return null;
}

export function definitionsByKey(
  definitions: readonly ProjectDefinition[],
): Map<string, ProjectDefinition[]> {
  const byKey = new Map<string, ProjectDefinition[]>();
  for (const definition of definitions) {
    const key = definitionKey(definition);
    if (!key) continue;
    const values = byKey.get(key);
    if (values) values.push(definition);
    else byKey.set(key, [definition]);
  }
  return byKey;
}

export function definitionFile(definition: ProjectDefinition): string {
  return definition.location.file;
}

export type DefinitionLookup = Pick<
  ReadonlyMap<string, readonly ProjectDefinition[]>,
  "get"
>;

function visibleFrom(
  use: ProjectUse,
  pool: readonly ProjectDefinition[],
  scope: LatexUnitScope | undefined,
  citation = false,
): readonly ProjectDefinition[] {
  if (!scope) return pool;
  return scope.select(use.location.file, pool, definitionFile, citation).items;
}

function referenceCandidates(
  use: ProjectUse,
  byKey: DefinitionLookup,
  scope: LatexUnitScope | undefined,
): readonly ProjectDefinition[] {
  const file = referenceTargetFile(use.target);
  let candidates: readonly ProjectDefinition[];
  if (file !== null) {
    const name = use.target?.slice(file.length + 1) || use.name;
    candidates = (
      byKey.get(referenceKey(labelScope(engineForPath(file), file), name)) ??
      []
    ).filter((definition) => definition.location.file === file);
  } else {
    candidates = visibleFrom(
      use,
      byKey.get(
        referenceKey(labelScope(use.engine, use.location.file), use.name),
      ) ?? [],
      scope,
    );
  }
  if (use.syntax === "typst-at") {
    const citations = byKey.get(`citation:${use.name}`) ?? [];
    if (candidates.length === 0) return citations;
    if (citations.length > 0) return [...candidates, ...citations];
  }
  return candidates;
}

/** A language server knows this definition by its whole extent, not its name. */
export function isWholeExtent(definition: ProjectDefinition): boolean {
  const { from, to } = definition.location.range;
  // A heading's range holds its text, which need not match its anchor or slug.
  return (
    definition.source === "texlab" &&
    definition.kind !== "section" &&
    to - from !== definition.name.length
  );
}

/**
 * texlab lists each `\\begin{thm}` by its whole extent as well as the
 * `\\newtheorem`, so an instance only stands in when nothing names the
 * environment. A counter belongs to a theorem, not to an environment that
 * happens to share its name.
 */
function environmentCandidates(
  use: ProjectUse,
  byKey: DefinitionLookup,
  scope: LatexUnitScope | undefined,
): readonly ProjectDefinition[] {
  const seen = visibleFrom(use, byKey.get(`environment:${use.name}`) ?? [], scope);
  if (use.syntax === "counter") {
    return seen.filter((definition) => definition.detail === THEOREM_ENVIRONMENT_DETAIL);
  }
  const named = seen.filter((definition) => !isWholeExtent(definition));
  return named.length > 0 ? named : seen;
}

function macroCandidates(
  use: ProjectUse,
  byKey: DefinitionLookup,
  scope: LatexUnitScope | undefined,
): readonly ProjectDefinition[] {
  const candidates = visibleFrom(use, byKey.get(`macro:${use.name}`) ?? [], scope);
  if (use.syntax !== "candidate") return candidates;
  return candidates.filter(
    (definition) =>
      definition.location.file !== use.location.file ||
      definition.location.range.from !== use.location.range.from ||
      definition.location.range.to !== use.location.range.to,
  );
}

export function definitionCandidatesForUse(
  use: ProjectUse,
  byKey: DefinitionLookup,
  scope: LatexUnitScope | undefined,
): readonly ProjectDefinition[] {
  if (use.kind === "reference") return referenceCandidates(use, byKey, scope);
  if (use.kind === "macro") return macroCandidates(use, byKey, scope);
  if (use.kind === "environment") return environmentCandidates(use, byKey, scope);
  if (use.kind === "citation" || use.kind === "glossary") {
    return visibleFrom(
      use,
      byKey.get(`${use.kind}:${use.name}`) ?? [],
      scope,
      use.kind === "citation",
    );
  }
  return [];
}

/**
 * Several candidates are only a problem when two of them collide. A `\\ref`
 * in a file shared by two documents, with one matching label in each, is
 * resolved in both and keeps both as navigation targets.
 */
export function resolutionForUse(
  use: ProjectUse,
  candidates: readonly ProjectDefinition[],
  scope: LatexUnitScope | undefined,
): ResolutionStatus {
  if (candidates.length === 0) return "unresolved";
  if (candidates.length === 1) return "resolved";
  if (!scope) return "duplicate";
  return scope.isAmbiguous(use.location.file, candidates, definitionFile)
    ? "duplicate"
    : "resolved";
}
