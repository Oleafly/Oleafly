import { createContext, useContext, type ReactNode } from "react";
import type { NoteEdit } from "./note-edits";
import type {
  ArtifactItem,
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
  readonly agents: readonly string[];
  readonly citations: readonly CitationItem[];
  readonly papers: readonly PaperTarget[];
  proposeEdits(request: EditRequest, signal: AbortSignal): Promise<readonly NoteEdit[]>;
  loadNote(id: string): Promise<NoteSource>;
  saveNote(id: string, text: string, version: string): Promise<NoteSource>;
  renameNote?(id: string, title: string): Promise<void>;
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

export function artifactsForNote(artifacts: readonly ArtifactItem[], noteId: string): ArtifactItem[] {
  return artifacts.filter((artifact) => artifact.noteIds.includes(noteId));
}
