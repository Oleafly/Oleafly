import { indexFromSymbols } from "@/lib/index/build";
import type {
  ProjectIndex,
  Sym,
  SymKind,
} from "@/lib/index/types";
import type {
  OutlineNode,
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectUse,
} from "./types";

function definitionKind(
  definition: ProjectDefinition,
): SymKind | null {
  switch (definition.kind) {
    case "section":
    case "label":
    case "macro":
    case "environment":
    case "bibentry":
      return definition.kind;
    case "anchor":
      return "label";
    default:
      return null;
  }
}

function useKind(use: ProjectUse): SymKind | null {
  switch (use.kind) {
    case "reference":
      return "ref";
    case "citation":
      return "cite";
    case "macro":
      return "macrouse";
    case "environment":
      return "envuse";
    case "include":
    case "import":
      return "inputedge";
    default:
      return null;
  }
}

function outlineNodesByDefinition(
  snapshot: ProjectIntelligenceSnapshot,
): ReadonlyMap<string, OutlineNode> {
  const nodes = new Map<string, OutlineNode>();
  for (const outline of Object.values(snapshot.outlines)) {
    for (const node of outline) {
      if (node.definitionId !== undefined && !nodes.has(node.definitionId)) {
        nodes.set(node.definitionId, node);
      }
    }
  }
  return nodes;
}

function definitionSymbol(
  definition: ProjectDefinition,
  outlineNodes: ReadonlyMap<string, OutlineNode>,
): Sym | null {
  const kind = definitionKind(definition);
  if (!kind) return null;
  const outline = outlineNodes.get(definition.id);
  const range =
    outline?.file === definition.location.file
      ? outline.range
      : definition.location.range;
  return {
    kind,
    name: definition.name,
    file: definition.location.file,
    line: definition.location.range.startLine,
    from: range.from,
    to: range.to,
    nameFrom: definition.location.range.from,
    nameTo: definition.location.range.to,
    ...(definition.level === undefined
      ? {}
      : { level: definition.level }),
  };
}

function useSymbol(use: ProjectUse): Sym | null {
  const kind = useKind(use);
  if (!kind) return null;
  return {
    kind,
    name: use.name,
    file: use.location.file,
    line: use.location.range.startLine,
    from: use.location.range.from,
    to: use.location.range.to,
    nameFrom: use.location.range.from,
    nameTo: use.location.range.to,
    ...(kind === "inputedge" && use.target
      ? { target: use.target }
      : {}),
  };
}

export function legacyIndexFromProjectIntelligence(
  snapshot: ProjectIntelligenceSnapshot,
): ProjectIndex {
  const outlineNodes = outlineNodesByDefinition(snapshot);
  const definitions = snapshot.definitions
    .map((definition) => definitionSymbol(definition, outlineNodes))
    .filter((symbol): symbol is Sym => symbol !== null);
  for (const node of snapshot.hierarchy.nodes) {
    definitions.push({
      kind: "file",
      name: node.file,
      file: node.file,
      line: 1,
      from: 0,
      to: 0,
      nameFrom: 0,
      nameTo: 0,
    });
  }
  const uses = snapshot.uses
    .map(useSymbol)
    .filter((symbol): symbol is Sym => symbol !== null);
  return indexFromSymbols(definitions, uses);
}

const lazyIndexes = new WeakMap<ProjectIntelligenceSnapshot, ProjectIndex>();

export function lazyLegacyIndex(
  snapshot: ProjectIntelligenceSnapshot,
): ProjectIndex {
  const cached = lazyIndexes.get(snapshot);
  if (cached) return cached;
  let built: ProjectIndex | null = null;
  const build = (): ProjectIndex => {
    built ??= legacyIndexFromProjectIntelligence(snapshot);
    return built;
  };
  const index: ProjectIndex = {
    get defs() {
      return build().defs;
    },
    get uses() {
      return build().uses;
    },
    symbolAt: (file, offset) => build().symbolAt(file, offset),
    definitionFor: (symbol) => build().definitionFor(symbol),
    references: (name, kind) => build().references(name, kind),
    allReferences: (symbol) => build().allReferences(symbol),
    renamePlan: (symbol, newName) => build().renamePlan(symbol, newName),
  };
  lazyIndexes.set(snapshot, index);
  return index;
}
