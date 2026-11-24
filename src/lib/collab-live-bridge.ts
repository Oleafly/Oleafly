import { create } from "zustand";
import type { DocumentSession } from "@oleafly/editor/document-session";
import type { OverleafLinkedFile, OverleafLiveProject, OverleafPauseOutcome } from "@/lib/overleaf-live";
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

export interface NoteCommentRange {
  from: number;
  to: number;
}

export interface NoteCommentSpan extends NoteCommentRange {
  id: string;
  resolved: boolean;
}

export interface NoteCommentView {
  spans: readonly NoteCommentSpan[];
  selected: string | null;
  draft: NoteCommentRange | null;
}

export interface NoteCommentTarget extends NoteCommentRange {
  quote: string;
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
  setComments?(view: NoteCommentView): void;
  commentDraft?(): NoteCommentRange | null;
  commentTarget?(): NoteCommentTarget | null;
  revealComment?(threadId: string): boolean;
}

export type NoteCommentOpenedFrom = "marker" | "text";

export interface NoteCommentSurface {
  readonly projectId: string;
  readonly path: string;
  readonly session: DocumentSession;
  flush(): void;
  show(view: NoteCommentView): void;
  draft(): NoteCommentRange | null;
  target(): NoteCommentTarget | null;
  reveal(threadId: string): boolean;
}

const noteCommentSurfaces = new Set<NoteCommentSurface>();
const noteCommentListeners = new Set<() => void>();
let noteCommentOpener: ((threadId: string, from: NoteCommentOpenedFrom) => void) | null = null;

export function registerNoteCommentSurface(surface: NoteCommentSurface): () => void {
  noteCommentSurfaces.add(surface);
  for (const listener of noteCommentListeners) listener();
  return () => {
    if (!noteCommentSurfaces.delete(surface)) return;
    for (const listener of noteCommentListeners) listener();
  };
}

export function noteCommentSurface(projectId: string | null, path?: string | null): NoteCommentSurface | null {
  if (projectId === null) return null;
  for (const surface of noteCommentSurfaces) {
    if (surface.projectId === projectId && (path === undefined || surface.path === path)) return surface;
  }
  return null;
}

export function onNoteCommentSurfaces(listener: () => void): () => void {
  noteCommentListeners.add(listener);
  return () => {
    noteCommentListeners.delete(listener);
  };
}

export function installNoteCommentOpener(open: (threadId: string, from: NoteCommentOpenedFrom) => void): () => void {
  noteCommentOpener = open;
  return () => {
    if (noteCommentOpener === open) noteCommentOpener = null;
  };
}

export function openNoteComment(threadId: string, from: NoteCommentOpenedFrom): void {
  noteCommentOpener?.(threadId, from);
}

export const useNoteCommentsRequest = create<{ count: number }>(() => ({ count: 0 }));

export function requestNoteComments(): void {
  useNoteCommentsRequest.setState((state) => ({ count: state.count + 1 }));
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
  document?: DocumentSession;
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

interface LiveBackendState {
  projectId: string | null;
  backend: "server" | "overleaf" | null;
  overleaf: OverleafLiveProject | null;
  pendingPaths: readonly string[];
  storedAsFiles: readonly string[];
  linked: readonly OverleafLinkedFile[];
}

export const useLiveBackend = create<LiveBackendState>(() => ({
  projectId: null,
  backend: null,
  overleaf: null,
  pendingPaths: [],
  storedAsFiles: [],
  linked: [],
}));

function overleafLive(live: LiveBackendState, projectId: string | null): boolean {
  return projectId !== null && live.projectId === projectId && live.backend === "overleaf";
}

export function useNotOnOverleafYet(projectId: string | null, path: string): boolean {
  return useLiveBackend((live) => overleafLive(live, projectId) && live.pendingPaths.includes(path));
}

export function useStoredAsFileOnOverleaf(projectId: string | null, path: string): boolean {
  return useLiveBackend((live) => overleafLive(live, projectId) && live.storedAsFiles.includes(path));
}

const NO_LINKED: readonly OverleafLinkedFile[] = [];

export function useOverleafLinkedFiles(projectId: string | null): readonly OverleafLinkedFile[] {
  return useLiveBackend((live) => (overleafLive(live, projectId) ? live.linked : NO_LINKED));
}

const linkedAt = (live: LiveBackendState, projectId: string | null, path: string | null) =>
  path !== null && overleafLive(live, projectId) ? (live.linked.find((file) => file.path === path) ?? null) : null;

export function overleafLinkedAt(projectId: string | null, path: string | null): OverleafLinkedFile | null {
  return linkedAt(useLiveBackend.getState(), projectId, path);
}

export function useOverleafLinked(projectId: string | null, path: string | null): OverleafLinkedFile | null {
  return useLiveBackend((live) => linkedAt(live, projectId, path));
}

export interface OverleafLiveActions {
  pause(projectId: string, anyway: boolean): Promise<OverleafPauseOutcome>;
  resume(projectId: string): Promise<void>;
  unlink(projectId: string): Promise<void>;
  errorText?(error: unknown): string;
}

let overleafActions: OverleafLiveActions | null = null;

const notRunning = () => Promise.reject<never>(new Error("live editing with the online service isn't running"));

const NOT_RUNNING: OverleafLiveActions = { pause: notRunning, resume: notRunning, unlink: notRunning };

export function installOverleafLiveActions(next: OverleafLiveActions): () => void {
  overleafActions = next;
  return () => {
    if (overleafActions === next) overleafActions = null;
  };
}

export function overleafLiveActions(): OverleafLiveActions {
  return overleafActions ?? NOT_RUNNING;
}

export function liveOnOverleaf(projectId: string | null): boolean {
  return overleafLive(useLiveBackend.getState(), projectId);
}

export interface CollabEditorPort {
  documentSession(path: string): DocumentSession | null;
  holds?(path: string): boolean;
  flush(projectId: string): Promise<void>;
  handBack?(projectId: string): Promise<void>;
  relive?(path: string): void;
}

interface CollabEditorGate {
  projectId: string | null;
  viewer: boolean;
  locked: boolean;
  connecting: boolean;
  suggesting: boolean;
}

export const useCollabEditorGate = create<CollabEditorGate>(() => ({
  projectId: null,
  viewer: false,
  locked: false,
  connecting: false,
  suggesting: false,
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

const relived = new Set<(path: string) => void>();

export function collabRelive(path: string): void {
  port?.relive?.(path);
  for (const listener of Array.from(relived)) listener(path);
}

export function onCollabRelive(listener: (path: string) => void): () => void {
  relived.add(listener);
  return () => {
    relived.delete(listener);
  };
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

const projectLive = (gate: CollabEditorGate, projectId: string | null) =>
  projectId !== null && gate.projectId === projectId;

const projectReadOnly = (gate: CollabEditorGate, projectId: string | null) =>
  projectLive(gate, projectId) && (gate.viewer || gate.connecting);

export type RichTextLock = "view" | "connecting" | "suggest";

const richTextLock = (gate: CollabEditorGate, projectId: string | null): RichTextLock | null => {
  if (!projectLive(gate, projectId)) return null;
  if (gate.connecting) return "connecting";
  if (gate.viewer) return "view";
  return gate.locked || gate.suggesting ? "suggest" : null;
};

export function collabProjectReadOnly(projectId: string | null): boolean {
  return projectReadOnly(useCollabEditorGate.getState(), projectId);
}

export function useCollabProjectReadOnly(projectId: string | null): boolean {
  return useCollabEditorGate((gate) => projectReadOnly(gate, projectId));
}

export function collabRichTextLock(projectId: string | null): RichTextLock | null {
  return richTextLock(useCollabEditorGate.getState(), projectId);
}

export function useCollabRichTextLock(projectId: string | null): RichTextLock | null {
  return useCollabEditorGate((gate) => richTextLock(gate, projectId));
}

const settingsLocked = (gate: CollabEditorGate, projectId: string | null) =>
  projectLive(gate, projectId) && (gate.viewer || gate.locked);

export function collabSettingsLocked(projectId: string | null): boolean {
  return settingsLocked(useCollabEditorGate.getState(), projectId);
}

export function useCollabSettingsLocked(projectId: string | null): boolean {
  return useCollabEditorGate((gate) => settingsLocked(gate, projectId));
}

export function collabProjectShared(projectId: string | null): boolean {
  return projectLive(useCollabEditorGate.getState(), projectId);
}

export function useCollabProjectShared(projectId: string | null): boolean {
  return useCollabEditorGate((gate) => projectLive(gate, projectId));
}

export const useOverleafFilling = create<{ projectId: string | null }>(() => ({ projectId: null }));

export function useProjectFilling(projectId: string | null): boolean {
  return useOverleafFilling((state) => projectId !== null && state.projectId === projectId);
}
