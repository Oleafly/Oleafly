import { createContext, useContext, type ReactNode } from "react";
import type { NoteLinkRecord, NoteSearchHit, NoteTagCount } from "@/lib/tauri";
import type { ArtifactItem, ArtifactPreview, CitationItem, ExperimentItem, NoteItem, NoteSource, PaperTarget, NoteColor } from "./types";

export interface NoteDraft {
  title: string;
  body?: string;
  tags?: readonly string[];
  properties?: string;
  relatedProject?: string | null;
  icon?: string;
  color?: NoteColor;
}

export interface NotesData {
  readonly notes: readonly NoteItem[];
  readonly revision?: number;
  noteTextChanged?(id: string, text: string): void;
  readonly artifacts: readonly ArtifactItem[];
  readonly experiments: readonly ExperimentItem[];
  readonly researchTasks?: boolean;
  openSettings?(): void;
  shareNote?(noteId: string): void;
  openProject?(projectId: string): void;
  readonly citations?: readonly CitationItem[];
  projectCitations?(projectId: string): Promise<readonly CitationItem[]>;
  readonly papers: readonly PaperTarget[];
  readonly projects?: readonly { id: string; name: string }[];
  setRelatedProject?(noteId: string, projectId: string | null): Promise<void>;
  latestRun?(noteId: string): string | null;
  previewArtifact?(artifact: ArtifactItem): Promise<ArtifactPreview>;
  copyArtifact?(noteId: string, artifact: ArtifactItem): Promise<string>;
  resolveAsset?(noteId: string, path: string): Promise<string | null>;
  importNotebook?(noteId: string): Promise<string | null>;
  loadNote(id: string): Promise<NoteSource>;
  saveNote(id: string, text: string, version: string, base?: string): Promise<NoteSource>;
  renameNote?(id: string, title: string): Promise<void>;
  deleteNote?(id: string): Promise<void>;
  createNote?(): Promise<string>;
  watchNote?(id: string, onChange: () => void): () => void;
  noteLinks?(): Promise<readonly NoteLinkRecord[]>;
  searchNotes?(query: string, limit?: number): Promise<readonly NoteSearchHit[]>;
  noteTags?(): Promise<readonly NoteTagCount[]>;
  createNoteFrom?(draft: NoteDraft): Promise<string>;
  refreshNotes?(): Promise<void>;
}

const NotesDataContext = createContext<NotesData | null>(null);

export function NotesDataProvider({ value, children }: Readonly<{ value: NotesData; children: ReactNode }>) {
  return <NotesDataContext.Provider value={value}>{children}</NotesDataContext.Provider>;
}

export function useOptionalNotesData(): NotesData | null {
  return useContext(NotesDataContext);
}

export function useNotesData(): NotesData {
  const data = useContext(NotesDataContext);
  if (!data) throw new Error("useNotesData needs a NotesDataProvider");
  return data;
}
