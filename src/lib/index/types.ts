export type DefKind = "label" | "macro" | "bibentry" | "theorem" | "glossary" | "environment" | "section" | "file";
export type UseKind = "ref" | "cite" | "atuse" | "macrouse" | "envuse" | "glossaryuse" | "inputedge";
export type SymKind = DefKind | UseKind;

export interface Sym {
  kind: SymKind;
  name: string;
  file: string;
  line: number;
  from: number;
  to: number;
  nameFrom: number;
  nameTo: number;
  level?: number;
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
