import type { ProjectIndex } from "@/lib/index/types";

type ReferenceKind = "label" | "citation";

const kinds = new WeakMap<ProjectIndex, Map<string, ReferenceKind>>();

function kindsOf(index: ProjectIndex): Map<string, ReferenceKind> {
  const cached = kinds.get(index);
  if (cached) return cached;
  const map = new Map<string, ReferenceKind>();
  for (const definition of index.defs) {
    if (definition.kind === "label") map.set(definition.name, "label");
    else if (definition.kind === "bibentry" && !map.has(definition.name)) map.set(definition.name, "citation");
  }
  kinds.set(index, map);
  return map;
}

export function referenceKindIn(index: ProjectIndex | null, key: string): ReferenceKind | null {
  return index ? (kindsOf(index).get(key) ?? null) : null;
}
