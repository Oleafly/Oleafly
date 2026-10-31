import type { ProjectIndexView } from "./tools";

export interface ProjectMap {
  files: string[];
  sections: { title: string; level?: number; file?: string; line?: number }[];
  labels: string[];
  bibKeys: string[];
  macros: string[];
  theorems: string[];
  glossary: string[];
  inputGraph: { from?: string; to?: string }[];
  unresolvedRefs: string[];
  unresolvedCites: string[];
  ambiguousTypstAtUses: string[];
}

export function projectMapFromIndex(index: ProjectIndexView): ProjectMap {
  const of = (kind: string) => index.defs.filter((d) => d.kind === kind);
  return {
    files: of("file").map((d) => d.name),
    sections: of("section").map((d) => ({ title: d.name, level: d.level, file: d.file, line: d.line })),
    labels: of("label").map((d) => d.name),
    bibKeys: of("bibentry").map((d) => d.name),
    macros: of("macro").map((d) => d.name),
    theorems: of("theorem").map((d) => d.name),
    glossary: of("glossary").map((d) => d.name),
    inputGraph: index.uses
      .filter((u) => u.kind === "inputedge")
      .map((u) => ({ from: u.file, to: u.target })),
    unresolvedRefs: [...new Set(index.uses.filter((u) => u.kind === "ref" && !index.definitionFor(u)).map((u) => u.name))],
    unresolvedCites: [...new Set(index.uses.filter((u) => u.kind === "cite" && !index.definitionFor(u)).map((u) => u.name))],
    ambiguousTypstAtUses: [...new Set(index.uses.filter((u) => u.kind === "atuse").map((u) => u.name))],
  };
}
