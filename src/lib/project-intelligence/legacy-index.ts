import { indexFromSymbols } from "@/lib/index/build";
import type {
  FileSymbols,
  Sym,
  SymKind,
} from "@/lib/index/types";
import type {
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

function definitionSymbol(
  definition: ProjectDefinition,
  snapshot: ProjectIntelligenceSnapshot,
): Sym | null {
  const kind = definitionKind(definition);
  if (!kind) return null;
  const outline = snapshot.outlines[definition.location.file]?.find(
    (node) => node.definitionId === definition.id,
  );
  const range = outline?.range ?? definition.location.range;
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
): {
  readonly index: ReturnType<typeof indexFromSymbols>;
  readonly parsed: Record<string, FileSymbols>;
} {
  const definitions = snapshot.definitions
    .map((definition) => definitionSymbol(definition, snapshot))
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
  const definitionsByFile = new Map<string, Sym[]>();
  for (const definition of definitions) {
    if (definition.kind === "file") continue;
    const values = definitionsByFile.get(definition.file) ?? [];
    values.push(definition);
    definitionsByFile.set(definition.file, values);
  }
  const usesByFile = new Map<string, Sym[]>();
  for (const use of uses) {
    const values = usesByFile.get(use.file) ?? [];
    values.push(use);
    usesByFile.set(use.file, values);
  }
  const parsed: Record<string, FileSymbols> = {};
  for (const file of Object.keys(snapshot.files)) {
    parsed[file] = {
      file,
      defs: definitionsByFile.get(file) ?? [],
      uses: usesByFile.get(file) ?? [],
    };
  }
  return {
    index: indexFromSymbols(definitions, uses),
    parsed,
  };
}
