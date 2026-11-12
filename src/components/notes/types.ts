
export type Author = "agent" | "you";
export type ArtifactKind = "figure" | "report" | "data" | "html" | "notebook" | "file";
export type NoteColor =
  | "blue"
  | "cream"
  | "peach"
  | "rose"
  | "pink"
  | "lilac"
  | "sky"
  | "aqua"
  | "cyan"
  | "mint"
  | "spring";

export interface NoteItem {
  id: string;
  noteId?: string;
  title: string;
  project: string;
  relatedProjectId?: string;
  updatedAt: number;
  author: Author;
  agent?: string;
  icon?: string;
  color?: NoteColor;
  summary: string;
  createdAt?: number;
  preview?: string;
  aliases?: readonly string[];
  tags?: readonly string[];
  properties?: Readonly<Record<string, unknown>>;
  shared?: boolean;
  home?: { projectId: string; path: string };
}

export interface NoteSource {
  text: string;
  version: string;
}

export class NoteConflictError extends Error {
  constructor(readonly disk: NoteSource) {
    super("The note changed on disk.");
    this.name = "NoteConflictError";
  }
}

export type ArtifactPreview =
  | { type: "image"; src: string }
  | { type: "text"; text: string; truncated: boolean }
  | { type: "table"; rows: readonly (readonly string[])[]; truncated: boolean }
  | { type: "notebook"; text: string }
  | { type: "none"; reason: "html" | "binary" | "missing" | "large" };

export interface ArtifactItem {
  id: string;
  taskId: string;
  path: string;
  title: string;
  kind: ArtifactKind;
  projectId: string;
  project: string;
  updatedAt: number;
  agent?: string;
  chat: string;
  summary: string;
}

export interface ExperimentItem {
  projectId: string;
  project: string;
  tasks: number;
  figures: number;
  reports: number;
  updatedAt: number;
  noteId: string;
}

export interface CitationItem {
  key: string;
  label: string;
  fields?: Readonly<Record<string, string>>;
}

export interface PaperTarget {
  id: string;
  label: string;
}

export type ResearchActionId =
  | "latestRun"
  | "claims"
  | "citations"
  | "proofread"
  | "rewrite"
  | "shorter"
  | "paragraph"
  | "table"
  | "figure"
  | "abstract";
