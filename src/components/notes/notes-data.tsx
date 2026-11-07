import { createContext, useContext, type ReactNode } from "react";
import type { ModelSelectorGroup } from "@/components/ai/ModelSelector";
import type { NoteEdit } from "./note-edits";
import type {
  ArtifactItem,
  ArtifactPreview,
  CitationItem,
  EditRequest,
  ExperimentItem,
  NoteItem,
  NoteSource,
  PaperTarget,
} from "./types";

export interface NotesData {
  readonly notes: readonly NoteItem[];
  readonly artifacts: readonly ArtifactItem[];
  readonly experiments: readonly ExperimentItem[];
  readonly agents: readonly ModelSelectorGroup[];
  readonly preferredAgent?: { providerId: string; modelId: string } | null;
  openAgentSettings?(): void;
  openSettings?(): void;
  readonly citations: readonly CitationItem[];
  readonly papers: readonly PaperTarget[];
  readonly projects?: readonly { id: string; name: string }[];
  setRelatedProject?(noteId: string, projectId: string | null): Promise<void>;
  latestRun?(noteId: string): string | null;
  previewArtifact?(artifact: ArtifactItem): Promise<ArtifactPreview>;
  copyArtifact?(noteId: string, artifact: ArtifactItem): Promise<string>;
  resolveAsset?(noteId: string, path: string): Promise<string | null>;
  proposeEdits(request: EditRequest, signal: AbortSignal): Promise<readonly NoteEdit[]>;
  loadNote(id: string): Promise<NoteSource>;
  saveNote(id: string, text: string, version: string): Promise<NoteSource>;
  renameNote?(id: string, title: string): Promise<void>;
  deleteNote?(id: string): Promise<void>;
  createNote?(): Promise<string>;
  watchNote?(id: string, onChange: () => void): () => void;
}

const NotesDataContext = createContext<NotesData | null>(null);

export function NotesDataProvider({ value, children }: Readonly<{ value: NotesData; children: ReactNode }>) {
  return <NotesDataContext.Provider value={value}>{children}</NotesDataContext.Provider>;
}

export function useNotesData(): NotesData {
  const data = useContext(NotesDataContext);
  if (!data) throw new Error("useNotesData needs a NotesDataProvider");
  return data;
}
