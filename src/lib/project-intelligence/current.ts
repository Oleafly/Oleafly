import { getEditorDocumentPath } from "@oleafly/editor";
import type {
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
} from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

export interface CurrentProjectIntelligence {
  path: string;
  snapshot: ProjectIntelligenceSnapshot;
}

function sameIdentity(
  state: ProjectIntelligenceState,
  snapshot: ProjectIntelligenceSnapshot,
  projectId: string,
): boolean {
  const identity = state.identity;
  return (
    identity !== null &&
    identity.projectId === projectId &&
    identity.projectId === snapshot.identity.projectId &&
    identity.projectRevision === snapshot.identity.projectRevision &&
    identity.requestGeneration === snapshot.identity.requestGeneration
  );
}

/**
 * Returns only an accepted current-revision project snapshot. Unlike the PDF
 * preview, navigation surfaces must never retain stale ranges because a click
 * could jump to the wrong source after an edit or filesystem mutation.
 */
export function acceptedProjectSnapshot(
  state: ProjectIntelligenceState,
  projectId: string | null,
): ProjectIntelligenceSnapshot | null {
  const snapshot = state.data;
  if (
    !projectId ||
    !snapshot ||
    state.stale ||
    (state.status !== "success" && state.status !== "partial") ||
    !sameIdentity(state, snapshot, projectId)
  ) {
    return null;
  }
  return snapshot;
}

/**
 * Returns analysis only when it belongs to the active project and the exact
 * active-file text. Retained running/error snapshots are deliberately
 * unavailable to editor decorations, completion, and navigation.
 */
export function currentProjectIntelligence(
  editorText?: string,
): CurrentProjectIntelligence | null {
  const files = useFilesStore.getState();
  const path = files.activePath;
  const projectId = files.projectId;
  if (!path || !projectId) return null;

  const indexed = useIndexStore.getState();
  const state = indexed.intelligenceState;
  const snapshot = acceptedProjectSnapshot(state, projectId);
  if (!snapshot) return null;

  const text = editorText ?? files.files[path]?.content;
  if (
    text === undefined ||
    indexed.texts[path] !== text ||
    snapshot.files[path] === undefined
  ) {
    return null;
  }
  return { path, snapshot };
}

export function currentSourceProjectIntelligence(
  editorText: string,
): CurrentProjectIntelligence | null {
  const current = currentProjectIntelligence(editorText);
  return current && getEditorDocumentPath() === current.path
    ? current
    : null;
}
