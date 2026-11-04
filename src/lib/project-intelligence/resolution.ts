import { engineForPath } from "./source";
import type {
  CompilationUnits,
  ProjectDefinition,
  ProjectIntelligenceEngine,
  ProjectUse,
  ResolutionStatus,
} from "./types";

/**
 * The pool a label or anchor name lives in. LaTeX `\label`, Typst `<label>`
 * and a Markdown anchor are resolved by different compilers, so a name in one
 * engine never satisfies, or duplicates, the same name in another. Markdown
 * anchors belong to the file that declares them. Within a pool, compilation
 * units keep separate LaTeX documents apart.
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

export const NO_COMPILATION_UNITS: CompilationUnits = {
  rootsByFile: {},
  externalDocuments: {},
};

/**
 * Whether a name defined in one file is visible from another. Two files that
 * both belong to compilation units see each other only when they share one;
 * a file in no unit (a fragment nothing includes yet, or a non-LaTeX file)
 * sees, and is seen from, every file.
 */
export function shareCompilationUnit(
  units: CompilationUnits,
  left: string,
  right: string,
): boolean {
  const leftRoots = units.rootsByFile[left];
  const rightRoots = units.rootsByFile[right];
  if (!leftRoots || !rightRoots) return true;
  return leftRoots.some((root) => rightRoots.includes(root));
}

function inUnit(units: CompilationUnits, file: string, root: string): boolean {
  const roots = units.rootsByFile[file];
  return !roots || roots.includes(root);
}

export interface ExternalLabel {
  /** The root of `file` that imports the label. */
  readonly root: string;
  /** The document it comes from. */
  readonly document: string;
  /** The label's own name, without the prefix. */
  readonly name: string;
}

/**
 * The labels that a LaTeX reference to `name` in `file` can reach in other
 * documents through xr's `\externaldocument[prefix]{document}`: one for each
 * import of a root of `file` whose prefix `name` starts with.
 */
export function externalLabels(
  units: CompilationUnits,
  file: string,
  name: string,
): ExternalLabel[] {
  const labels: ExternalLabel[] = [];
  for (const root of units.rootsByFile[file] ?? []) {
    for (const { root: document, prefix } of units.externalDocuments[root] ?? []) {
      if (name.length > prefix.length && name.startsWith(prefix)) {
        labels.push({ root, document, name: name.slice(prefix.length) });
      }
    }
  }
  return labels;
}

/**
 * `definitions` split by the documents `file` is part of: one group per root
 * whose unit holds `file`, with what that document sees, or a single group
 * of all of them when no root reaches `file`. For a LaTeX label `name`, each
 * group also gets the labels its root imports under that name.
 */
export function definitionsByDocument(
  units: CompilationUnits,
  file: string,
  definitions: readonly ProjectDefinition[],
  label?: {
    readonly name: string;
    readonly byKey: ReadonlyMap<string, readonly ProjectDefinition[]>;
  },
): ProjectDefinition[][] {
  const roots = units.rootsByFile[file];
  if (!roots) return [[...definitions]];
  const imported = label ? externalLabels(units, file, label.name) : [];
  return roots.map((root) => {
    const group = definitions.filter((definition) =>
      inUnit(units, definition.location.file, root),
    );
    for (const external of imported) {
      if (external.root !== root) continue;
      const key = referenceKey(labelScope("latex", file), external.name);
      for (const definition of label?.byKey.get(key) ?? []) {
        if (
          units.rootsByFile[definition.location.file]?.includes(external.document) &&
          !group.includes(definition)
        ) {
          group.push(definition);
        }
      }
    }
    return group;
  });
}

/**
 * The definitions `file` can name, split by document as in
 * `definitionsByDocument`, with each document's xr imports under the name a
 * reference uses, prefix included. Files are paths, so units never hide them.
 */
export function definitionsVisibleFrom(
  units: CompilationUnits,
  file: string,
  definitions: readonly ProjectDefinition[],
): ProjectDefinition[][] {
  const roots = units.rootsByFile[file];
  if (!roots) return [[...definitions]];
  return roots.map((root) => {
    const group = definitions.filter(
      (definition) =>
        definition.kind === "file" ||
        inUnit(units, definition.location.file, root),
    );
    const seen = new Set(group.map((definition) => `${definition.id}\0${definition.name}`));
    for (const { root: document, prefix } of units.externalDocuments[root] ?? []) {
      for (const definition of definitions) {
        if (
          definition.kind !== "label" ||
          definition.engine !== "latex" ||
          !units.rootsByFile[definition.location.file]?.includes(document)
        ) {
          continue;
        }
        const name = `${prefix}${definition.name}`;
        const key = `${definition.id}\0${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        group.push(name === definition.name ? definition : { ...definition, name });
      }
    }
    return group;
  });
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

function candidatesInPool(
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

/**
 * The definitions a use can reach, one group per document its file is part
 * of (see `definitionsByDocument`). A file several documents include can
 * name a different definition in each.
 */
export function definitionGroupsForUse(
  use: ProjectUse,
  byKey: ReadonlyMap<string, readonly ProjectDefinition[]>,
  units: CompilationUnits,
): ProjectDefinition[][] {
  const latexLabel =
    use.kind === "reference" &&
    use.engine === "latex" &&
    referenceTargetFile(use.target) === null;
  return definitionsByDocument(
    units,
    use.location.file,
    candidatesInPool(use, byKey),
    latexLabel ? { name: use.name, byKey } : undefined,
  );
}

export function uniqueDefinitions(
  groups: readonly (readonly ProjectDefinition[])[],
): ProjectDefinition[] {
  return [...new Set(groups.flat())];
}

/** A name is ambiguous only when one document sees more than one definition. */
export function resolutionForGroups(
  groups: readonly (readonly ProjectDefinition[])[],
): Exclude<ResolutionStatus, "external"> {
  if (groups.some((group) => group.length > 1)) return "duplicate";
  return groups.some((group) => group.length > 0) ? "resolved" : "unresolved";
}
