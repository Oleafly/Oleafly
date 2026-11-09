import { publishLiveProject, useCollabEditorGate, useCollabLiveNote } from "@/lib/collab-live-bridge";
import type { CollabProjectRole } from "@/lib/tauri";
import { canEditProjectRole, isReadOnlyProjectRole } from "../roles";
import { startLiveEditing } from "./live-editing";
import { type LiveSession, useCollabLiveStore } from "./live-store";

function access(role: CollabProjectRole | null) {
  return { viewer: isReadOnlyProjectRole(role), locked: !canEditProjectRole(role) };
}

export function isNoteSession(live: LiveSession): boolean {
  return useCollabLiveNote.getState().noteId === live.projectId;
}

export function startNoteLive(live: LiveSession): () => void {
  const { projectId } = live;
  useCollabEditorGate.setState({ projectId, ...access(useCollabLiveStore.getState().role), connecting: false });
  const unsubscribeRole = useCollabLiveStore.subscribe((state, previous) => {
    if (state.role !== previous.role && useCollabEditorGate.getState().projectId === projectId) {
      useCollabEditorGate.setState(access(state.role));
    }
  });
  useCollabLiveNote.setState({ session: { ...live } });
  return () => {
    unsubscribeRole();
    if (useCollabLiveNote.getState().session?.projectId === projectId) useCollabLiveNote.setState({ session: null });
    if (useCollabEditorGate.getState().projectId === projectId) {
      useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
    }
  };
}

export function startLiveTarget(live: LiveSession): () => void {
  if (isNoteSession(live)) return startNoteLive(live);
  const stopEditing = startLiveEditing(live);
  const unpublish = publishLiveProject(live);
  return () => {
    unpublish();
    stopEditing();
  };
}
