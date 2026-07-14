// See docs/planning/specs/2026-07-09-project-index-language-service-design.md for design rationale.

export type DefKind = "label" | "macro" | "bibentry" | "theorem" | "glossary" | "environment" | "section" | "file";
export type UseKind = "ref" | "cite" | "macrouse" | "envuse" | "glossaryuse" | "inputedge";
export type SymKind = DefKind | UseKind;

export interface Sym {
  kind: SymKind;
  // Label key, macro name (no backslash), bib key, env name, section title, or file path,
  // depending on `kind`.
  name: string;
  file: string;
  // 1-based.
  line: number;
  // Full token span within `file` (for hit-testing and jump targets).
  from: number;
  to: number;
  // The name-only span within `file` (what rename edits) — distinct from `from`/`to`.
  nameFrom: number;
  nameTo: number;
  // Only set for `section` symbols.
  level?: number;
  // Only set for `inputedge` symbols.
  target?: string;
}

export interface FileSymbols {
  file: string;
  defs: Sym[];
  uses: Sym[];
}

export interface Edit {
  file: string;
  from: number;
  to: number;
  newText: string;
}

export interface RenamePlan {
  edits: Edit[];
  fileCount: number;
  collision: boolean;
}

export interface ProjectIndex {
  defs: Sym[];
  uses: Sym[];
  symbolAt: (file: string, offset: number) => Sym | null;
  definitionFor: (sym: Sym) => Sym | null;
  references: (name: string, kind: UseKind) => Sym[];
  allReferences: (sym: Sym) => Sym[];
  renamePlan: (sym: Sym, newName: string) => RenamePlan;
}
