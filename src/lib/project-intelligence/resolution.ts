import { engineForPath } from "./source";
import type {
  ProjectDefinition,
  ProjectIntelligenceEngine,
  ProjectUse,
} from "./types";

/**
 * The one place that decides which definitions a use can resolve to. The
 * worker's assembler, the language-service merge and the editor's stale
 * fallback all key definitions through here, so they cannot drift apart.
 */

/**
 * The pool a label or anchor name lives in. LaTeX `\label`, Typst `<label>`
 * and a Markdown anchor are resolved by different compilers, so a name in one
 * engine never satisfies, or duplicates, the same name in another. Markdown
 * anchors belong to the file that declares them.
 *
 * Two LaTeX roots in one project still share a pool; scoping by compilation
 * unit (the `\input`/`#include` closure of each root) is a later step.
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

/**
 * The file a `file#anchor` reference, such as a Markdown
 * `[results](paper.tex#sec:results)`, points into. Null for a reference that
 * names no file.
 */
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

function referenceCandidates(
  use: ProjectUse,
  byKey: ReadonlyMap<string, readonly ProjectDefinition[]>,
): readonly ProjectDefinition[] {
  let candidates =
    byKey.get(
      referenceKey(labelScope(use.engine, use.location.file), use.name),
    ) ?? [];
  const file = referenceTargetFile(use.target);
  if (file !== null) {
    const name = use.target?.slice(file.length + 1) || use.name;
    candidates = (
      byKey.get(referenceKey(labelScope(engineForPath(file), file), name)) ??
      []
    ).filter((definition) => definition.location.file === file);
  }
  if (use.syntax === "typst-at") {
    const citations = byKey.get(`citation:${use.name}`) ?? [];
    if (candidates.length === 0) return citations;
    if (citations.length > 0) return [...candidates, ...citations];
  }
  return candidates;
}

function macroCandidates(
  use: ProjectUse,
  byKey: ReadonlyMap<string, readonly ProjectDefinition[]>,
): readonly ProjectDefinition[] {
  const candidates = byKey.get(`macro:${use.name}`) ?? [];
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
  byKey: ReadonlyMap<string, readonly ProjectDefinition[]>,
): readonly ProjectDefinition[] {
  if (use.kind === "reference") return referenceCandidates(use, byKey);
  if (use.kind === "macro") return macroCandidates(use, byKey);
  if (
    use.kind === "citation" ||
    use.kind === "environment" ||
    use.kind === "glossary"
  ) {
    return byKey.get(`${use.kind}:${use.name}`) ?? [];
  }
  return [];
}
