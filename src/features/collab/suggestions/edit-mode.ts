import { create } from "zustand";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import type { CollabEditMode, CollabProjectRole } from "@/lib/tauri";
import { collabEditModeGet, collabEditModeSet } from "@/lib/tauri-collab";
import { collabErrorText } from "../errors";
import { useCollabLiveStore } from "../live/live-store";
import { canEditProjectRole, canSuggestProjectRole, suggestsOnlyProjectRole } from "../roles";

export interface EditModeState {
  projectId: string | null;
  mode: CollabEditMode | null;
  busy: boolean;
}

export const useEditMode = create<EditModeState>(() => ({ projectId: null, mode: null, busy: false }));

function liveRole(): CollabProjectRole | null {
  const live = useCollabLiveStore.getState();
  return live.share ? live.role : null;
}

export function editModeSwitchable(role: CollabProjectRole | null | undefined): boolean {
  return canEditProjectRole(role);
}

let readToken = 0;

async function readMode(projectId: string, role: CollabProjectRole): Promise<void> {
  const token = ++readToken;
  let mode: CollabEditMode;
  try {
    mode = await collabEditModeGet(projectId);
  } catch (error) {
    if (token !== readToken) return;
    void logError("collab edit mode", error);
    mode = suggestsOnlyProjectRole(role) ? "suggesting" : "editing";
  }
  if (token !== readToken || useEditMode.getState().projectId !== projectId) return;
  useEditMode.setState({ mode: suggestsOnlyProjectRole(role) ? "suggesting" : mode });
}

export async function setEditMode(mode: CollabEditMode): Promise<void> {
  const { projectId, mode: current, busy } = useEditMode.getState();
  if (!projectId || busy || current === mode || !editModeSwitchable(liveRole())) return;
  readToken += 1;
  useEditMode.setState({ busy: true, mode });
  try {
    await collabEditModeSet(projectId, mode);
  } catch (error) {
    void logError("collab set edit mode", error);
    if (useEditMode.getState().projectId === projectId) {
      useEditMode.setState({ mode: current });
      toast.error(collabErrorText(error));
    }
  } finally {
    if (useEditMode.getState().projectId === projectId) useEditMode.setState({ busy: false });
  }
}

export function startEditMode(): () => void {
  let seen: { projectId: string | null; role: CollabProjectRole | null } = { projectId: null, role: null };
  const sync = () => {
    const live = useCollabLiveStore.getState();
    const projectId = live.share ? live.projectId : null;
    const role = projectId ? live.role : null;
    if (seen.projectId === projectId && seen.role === role) return;
    const projectChanged = seen.projectId !== projectId;
    seen = { projectId, role };
    readToken += 1;
    if (!projectId || !canSuggestProjectRole(role) || role === null) {
      useEditMode.setState({ projectId, mode: null, busy: false });
      return;
    }
    if (projectChanged) useEditMode.setState({ projectId, mode: null, busy: false });
    else useEditMode.setState({ projectId });
    void readMode(projectId, role);
  };
  const stop = useCollabLiveStore.subscribe(sync);
  sync();
  return () => {
    stop();
    readToken += 1;
    useEditMode.setState({ projectId: null, mode: null, busy: false });
  };
}
