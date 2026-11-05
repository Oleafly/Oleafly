import type { LatexUnitScope } from "@/lib/project-intelligence/latex-units";

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
  /** A language server knows this definition by its whole extent, not its name. */
  wholeExtent?: true;
  /** Names a theorem's counter, as in `\\newtheorem{lem}[thm]{L}`. */
  counter?: true;
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
  /** The definition a rename from this symbol starts at, when one can be told. */
  renameTarget?: (sym: Sym) => Sym | null;
  /** A use with several candidates that no document tells apart. */
  renameIsAmbiguous?: (sym: Sym) => boolean;
  /** Present when the project holds two or more independent LaTeX documents. */
  unitScope?: LatexUnitScope;
}
