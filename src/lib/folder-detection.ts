export type SourceFamily = "latex" | "typst" | "markdown";

export type DetectionTier = "s" | "a" | "m" | "w";

export type DocumentKind =
  | "document"
  | "book"
  | "presentation"
  | "poster"
  | "standalone"
  | "typst"
  | "markdown"
  | "unknown";

export type DetectionReason =
  | "declared"
  | "top_level"
  | "named_main"
  | "named_after_folder"
  | "includes_files"
  | "has_bibliography"
  | "no_begin_document"
  | "standalone_figure"
  | "placeholder";

export type DetectionDecision = "auto" | "ask" | "no_main";

export type DetectionSource =
  | "saved_choice"
  | "manifest"
  | "latexmkrc"
  | "arxiv_readme"
  | "typst_toml"
  | "subfiles"
  | "tex_root"
  | "root_main"
  | "scan";

export interface DetectionCandidate {
  path: string;
  family: SourceFamily;
  tier: DetectionTier;
  kind: DocumentKind;
  class: string | null;
  title: string | null;
  depth: number;
  reasons: DetectionReason[];
}

export interface FolderDetection {
  main: string | null;
  decision: DetectionDecision;
  source: DetectionSource;
  candidates: DetectionCandidate[];
  truncated: boolean;
  compile_dir: string | null;
}

export interface OpenedFolder {
  project_id: string;
  detection: FolderDetection;
}
