import { create } from "zustand";
import type { DocumentSession } from "@oleafly/editor/document-session";
import type { CollabProjectRole } from "@/lib/tauri";

export interface LiveNoteSession {
  projectId: string;
  role: CollabProjectRole;
  accountId: string;
  deviceId: string;
}

interface CollabLiveNote {
  noteId: string | null;
  session: LiveNoteSession | null;
}

export const useCollabLiveNote = create<CollabLiveNote>(() => ({ noteId: null, session: null }));

export function claimLiveNote(noteId: string | null): void {
  if (useCollabLiveNote.getState().noteId !== noteId) useCollabLiveNote.setState({ noteId });
}

export const useCollabLiveProject = create<{ session: LiveNoteSession | null }>(() => ({ session: null }));

export function publishLiveProject(session: LiveNoteSession): () => void {
  useCollabLiveProject.setState({ session: { ...session } });
  return () => {
    if (useCollabLiveProject.getState().session?.projectId === session.projectId) {
      useCollabLiveProject.setState({ session: null });
    }
  };
}

export interface NotePeerMark {
  id: string;
  name: string;
  hue: number;
  index: number;
}

export interface NotePeerCaret {
  id: string;
  name: string | null;
  hue: number;
  head: number;
  anchor: number;
}

export interface NoteSelectionOffsets {
  head: number;
  anchor: number;
}

export interface NoteLiveEditor {
  serialize(): string;
  show(previous: string, next: string, keepLocal: boolean): void;
  composing(): boolean;
  selectionOffsets(): NoteSelectionOffsets;
  blockAt(offset: number): number;
  setPeerMarks(marks: readonly NotePeerMark[]): void;
  setPeerCarets(carets: readonly NotePeerCaret[], replace?: ReadonlySet<string>): void;
  revealBlock(index: number): void;
  onCaret(listener: () => void): () => void;
  batch(run: () => void): void;
  shown?(): boolean;
}

export type NoteLiveEndReason = "released" | "dropped";

export interface NoteHandBack {
  text: string;
  base: string;
  edited: boolean;
  reason?: NoteLiveEndReason;
}

export type NoteLiveNotice = "read_only" | "refused";

export const useCollabNoteNotices = create<{ notices: Readonly<Record<string, NoteLiveNotice>> }>(() => ({
  notices: {},
}));

export function showNoteLiveNotice(noteId: string, notice: NoteLiveNotice): void {
  useCollabNoteNotices.setState((state) =>
    state.notices[noteId] === notice ? state : { notices: { ...state.notices, [noteId]: notice } },
  );
}

export function dismissNoteLiveNotice(noteId: string): void {
  useCollabNoteNotices.setState((state) => {
    if (!(noteId in state.notices)) return state;
    const notices = { ...state.notices };
    delete notices[noteId];
    return { notices };
  });
}

const heldNotePaths = new Map<string, Map<string, number>>();
const heldNoteListeners = new Set<() => void>();

export function holdNoteLivePath(projectId: string, path: string): () => void {
  const paths = heldNotePaths.get(projectId) ?? new Map<string, number>();
  heldNotePaths.set(projectId, paths);
  paths.set(path, (paths.get(path) ?? 0) + 1);
  for (const listener of heldNoteListeners) listener();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (paths.get(path) ?? 1) - 1;
    if (left > 0) paths.set(path, left);
    else paths.delete(path);
    if (paths.size === 0 && heldNotePaths.get(projectId) === paths) heldNotePaths.delete(projectId);
    for (const listener of heldNoteListeners) listener();
  };
}

export function noteLiveHolds(projectId: string | null, path: string | null): boolean {
  return projectId !== null && path !== null && (heldNotePaths.get(projectId)?.has(path) ?? false);
}

export function onNoteLiveHoldsChange(listener: () => void): () => void {
  heldNoteListeners.add(listener);
  return () => {
    heldNoteListeners.delete(listener);
  };
}

export interface NoteLiveBindRequest {
  noteId: string;
  noticeId?: string;
  path: string;
  session: LiveNoteSession;
  editor: NoteLiveEditor;
  baseline: { text: string; serialized: string };
  onOpen?(): void;
  onEnd(state: NoteHandBack): void;
}

export interface NoteLiveHandle {
  localChanged(): void;
  compositionEnd(): void;
  resync(): void;
  flush(waitMs: number): Promise<void>;
  end(): void;
}

export interface NoteLivePort {
  bind(request: NoteLiveBindRequest): NoteLiveHandle;
  handBack?(noteId: string): Promise<void>;
}

export async function collabNoteHandBack(noteId: string | null): Promise<void> {
  const port = useCollabNoteLivePort.getState().port;
  if (noteId && port?.handBack) await port.handBack(noteId);
}

export const useCollabNoteLivePort = create<{ port: NoteLivePort | null }>(() => ({ port: null }));

export function installNoteLivePort(port: NoteLivePort): () => void {
  useCollabNoteLivePort.setState({ port });
  return () => {
    if (useCollabNoteLivePort.getState().port === port) useCollabNoteLivePort.setState({ port: null });
  };
}

export interface CollabEditorPort {
  documentSession(path: string): DocumentSession | null;
  holds?(path: string): boolean;
  flush(projectId: string): Promise<void>;
  handBack?(projectId: string): Promise<void>;
}

interface CollabEditorGate {
  projectId: string | null;
  viewer: boolean;
  locked: boolean;
  connecting: boolean;
}

export const useCollabEditorGate = create<CollabEditorGate>(() => ({
  projectId: null,
  viewer: false,
  locked: false,
  connecting: false,
}));

let port: CollabEditorPort | null = null;

export function installCollabEditorPort(next: CollabEditorPort): () => void {
  port = next;
  return () => {
    if (port === next) port = null;
  };
}

export function collabDocumentSession(path: string): DocumentSession | null {
  return port?.documentSession(path) ?? null;
}

export function collabHoldsDocument(path: string, projectId: string | null): boolean {
  return (port?.holds?.(path) ?? false) || noteLiveHolds(projectId, path);
}

export async function collabCompileBarrier(projectId: string | null): Promise<void> {
  if (projectId && port) await port.flush(projectId);
}

export type ReviewAction = "compile" | "export";

let reviewNotice: ((projectId: string, action: ReviewAction) => void) | null = null;

export function installReviewNotice(next: (projectId: string, action: ReviewAction) => void): () => void {
  reviewNotice = next;
  return () => {
    if (reviewNotice === next) reviewNotice = null;
  };
}

export function noteUnreviewedSuggestions(projectId: string | null, action: ReviewAction): void {
  if (projectId) reviewNotice?.(projectId, action);
}

export async function collabHandBack(projectId: string | null): Promise<void> {
  if (projectId && port?.handBack) await port.handBack(projectId);
}

const projectReadOnly = (gate: CollabEditorGate, projectId: string | null) =>
  projectId !== null && gate.projectId === projectId && (gate.viewer || gate.connecting);

const visualReadOnly = (gate: CollabEditorGate, projectId: string | null) =>
  projectId !== null && gate.projectId === projectId;

export function collabProjectReadOnly(projectId: string | null): boolean {
  return projectReadOnly(useCollabEditorGate.getState(), projectId);
}

export function useCollabProjectReadOnly(projectId: string | null): boolean {
  return useCollabEditorGate((gate) => projectReadOnly(gate, projectId));
}

export function collabVisualReadOnly(projectId: string | null): boolean {
  return visualReadOnly(useCollabEditorGate.getState(), projectId);
}

export function useCollabVisualReadOnly(projectId: string | null): boolean {
  return useCollabEditorGate((gate) => visualReadOnly(gate, projectId));
}

const settingsLocked = (gate: CollabEditorGate, projectId: string | null) =>
  projectId !== null && gate.projectId === projectId && (gate.viewer || gate.locked);

export function collabSettingsLocked(projectId: string | null): boolean {
  return settingsLocked(useCollabEditorGate.getState(), projectId);
}

export function useCollabSettingsLocked(projectId: string | null): boolean {
  return useCollabEditorGate((gate) => settingsLocked(gate, projectId));
}

export function collabProjectShared(projectId: string | null): boolean {
  return collabVisualReadOnly(projectId);
}

export function useCollabProjectShared(projectId: string | null): boolean {
  return useCollabVisualReadOnly(projectId);
}
