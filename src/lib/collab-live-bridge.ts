import { create } from "zustand";
import type { DocumentSession } from "@oleafly/editor/document-session";

export interface CollabEditorPort {
  documentSession(path: string): DocumentSession | null;
  flush(projectId: string): Promise<void>;
}

interface CollabEditorGate {
  projectId: string | null;
  viewer: boolean;
  connecting: boolean;
}

export const useCollabEditorGate = create<CollabEditorGate>(() => ({
  projectId: null,
  viewer: false,
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

export async function collabCompileBarrier(projectId: string | null): Promise<void> {
  if (projectId && port) await port.flush(projectId);
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
  projectId !== null && gate.projectId === projectId && gate.viewer;

export function collabSettingsLocked(projectId: string | null): boolean {
  return settingsLocked(useCollabEditorGate.getState(), projectId);
}

export function useCollabSettingsLocked(projectId: string | null): boolean {
  return useCollabEditorGate((gate) => settingsLocked(gate, projectId));
}
