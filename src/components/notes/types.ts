export type Author = "agent" | "you";
export type ArtifactKind = "figure" | "report" | "run" | "html";

export interface NoteItem {
  id: string;
  title: string;
  project: string;
  updatedAt: number;
  author: Author;
  agent?: string;
  icon?: string;
  summary: string;
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

export interface ArtifactMetric {
  label: string;
  value: string;
}

export type ArtifactPreview =
  | { type: "image"; src: string }
  | { type: "text"; heading: string; body: string }
  | { type: "metrics"; metrics: readonly ArtifactMetric[] };

export interface ArtifactItem {
  id: string;
  title: string;
  kind: ArtifactKind;
  project: string;
  noteIds: readonly string[];
  updatedAt: number;
  author: Author;
  agent?: string;
  chat: string;
  summary: string;
  preview?: ArtifactPreview;
  snippet?: string;
}

export interface ExperimentItem {
  project: string;
  runs: number;
  figures: number;
  reports: number;
  updatedAt: number;
  noteId: string;
}

export interface CitationItem {
  key: string;
  label: string;
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

export interface EditRequest {
  noteId: string;
  agent: string;
  actionId: ResearchActionId | null;
  prompt: string;
  quote: string | null;
  source: string;
}
