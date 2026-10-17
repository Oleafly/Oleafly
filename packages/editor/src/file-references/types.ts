export type FileReferenceLanguage = "latex" | "typst" | "markdown";

export type PathReferenceKind =
  | "tex-input"
  | "tex-include"
  | "tex-subfile"
  | "tex-import"
  | "tex-subimport"
  | "tex-graphics"
  | "tex-svg"
  | "tex-pdf"
  | "tex-exact"
  | "tex-bibtex"
  | "tex-biblatex"
  | "tex-package"
  | "tex-class"
  | "tex-graphicspath"
  | "tex-svgpath"
  | "typst"
  | "markdown";

export interface TextSpan {
  readonly from: number;
  readonly to: number;
  readonly raw: string;
}

export interface PathReference extends TextSpan {
  readonly language: FileReferenceLanguage;
  readonly kind: PathReferenceKind;
  readonly command: string;
  readonly directory?: TextSpan;
  readonly wrapped?: boolean;
}

export interface ProjectFiles {
  readonly files: readonly string[];
  readonly directories?: readonly string[];
  readonly mainDoc: string;
}

export interface ReferenceSource {
  readonly path: string;
  readonly text: string;
}

export interface LatexSearchPaths {
  readonly graphics: readonly string[];
  readonly svg: readonly string[];
}

export interface ResolveContext {
  readonly sourcePath: string;
  readonly project: ProjectFiles;
  readonly searchPaths?: LatexSearchPaths;
}

export interface ResolvedPathReference {
  readonly path: string;
  readonly directory: boolean;
}

export interface FileReferenceEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface FileReferenceFileEdits {
  readonly path: string;
  readonly text: string;
  readonly edits: readonly FileReferenceEdit[];
  readonly references: number;
}

export interface FileReferencePlan {
  readonly files: readonly FileReferenceFileEdits[];
  readonly references: number;
}

export interface FileMove {
  readonly from: string;
  readonly to: string;
}

export interface PlanInput {
  readonly move: FileMove;
  readonly before: ProjectFiles;
  readonly after: ProjectFiles;
  readonly sources: readonly ReferenceSource[];
}
