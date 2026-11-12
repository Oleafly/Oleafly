import { keepPreviousData, type QueryKey, useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { appQueryClient } from "@/lib/query";
import type { NoteLinkRecord, NoteSearchHit, NoteSearchOptions, NoteTagCount, NoteTaskRecord } from "@/lib/tauri";
import type { ArtifactItem, ArtifactPreview, CitationItem, ExperimentItem, NoteItem, NoteSource, PaperTarget, NoteColor } from "./types";

export interface AttachFilter {
  title: string;
  name: string;
  extensions: readonly string[];
}

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
  readonly taskRevision?: number;
  readonly changedNotes?: readonly string[] | null;
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
  openAsset?(noteId: string, path: string): Promise<void>;
  revealAsset?(noteId: string, path: string): Promise<void>;
  attachFile?(noteId: string, filter: AttachFilter): Promise<string | null>;
  loadNote(id: string): Promise<NoteSource>;
  saveNote(id: string, text: string, version: string, base?: string): Promise<NoteSource>;
  renameNote?(id: string, title: string): Promise<void>;
  deleteNote?(id: string): Promise<void>;
  duplicateNote?(id: string, title: string): Promise<string>;
  createNote?(): Promise<string>;
  watchNote?(id: string, onChange: () => void): () => void;
  noteLinks?(ids?: readonly string[]): Promise<readonly NoteLinkRecord[]>;
  searchNotes?(query: string, limit?: number, options?: NoteSearchOptions): Promise<readonly NoteSearchHit[]>;
  noteTags?(): Promise<readonly NoteTagCount[]>;
  noteTasks?(): Promise<readonly NoteTaskRecord[]>;
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

export interface VaultLoad<T> {
  data: T | null;
  failed: boolean;
}

export const VAULT_QUERY = { placeholderData: keepPreviousData, gcTime: 30_000, retryDelay: 500 } as const;

const owners = new WeakMap<object, number>();
let owned = 0;

export function vaultOwner(value: object | undefined): number {
  if (!value) return 0;
  let owner = owners.get(value);
  if (owner === undefined) {
    owned += 1;
    owner = owned;
    owners.set(value, owner);
  }
  return owner;
}

export function useVaultKey(kind: string, load: object | undefined, ...rest: unknown[]): QueryKey {
  const { notes, revision } = useNotesData();
  return ["notes", kind, vaultOwner(load), revision ?? `list:${vaultOwner(notes)}`, ...rest];
}

function useVaultQuery<T>(queryKey: QueryKey, load: (() => Promise<T>) | undefined, enabled: boolean): VaultLoad<T> {
  const query = useQuery({ queryKey, queryFn: () => (load as () => Promise<T>)(), enabled: enabled && load !== undefined, ...VAULT_QUERY }, appQueryClient());
  return { data: query.data ?? null, failed: query.isError };
}

export function useVaultLoad<T>(kind: string, load: (() => Promise<T>) | undefined, enabled = true): VaultLoad<T> {
  return useVaultQuery(useVaultKey(kind, load), load, enabled);
}

export function useNoteTasks(): VaultLoad<readonly NoteTaskRecord[]> {
  const { notes, revision, taskRevision, noteTasks } = useNotesData();
  return useVaultQuery(["notes", "tasks", vaultOwner(noteTasks), taskRevision ?? revision ?? `list:${vaultOwner(notes)}`], noteTasks, true);
}
