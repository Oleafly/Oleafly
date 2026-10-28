import { create } from "zustand";
import type { DocumentSession } from "@oleafly/editor/document-session";

export interface CollabEditorPort {
  documentSession(path: string): DocumentSession | null;
  // True while a live document session holds the file's text, without
  // opening one. Disk writes of such a file only mirror text the window has.
  holds?(path: string): boolean;
  flush(projectId: string): Promise<void>;
  // Before the project closes: typing the shared document hasn't confirmed
  // goes back to the buffers as unsaved, so the save that follows keeps it.
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

export function collabHoldsDocument(path: string): boolean {
  return port?.holds?.(path) ?? false;
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

// Called by the files store before it saves and leaves a project.
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
