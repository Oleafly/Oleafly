import { create } from "zustand";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import type { CollabEditMode, CollabEditModeScope, CollabEditModeState, CollabProjectRole } from "@/lib/tauri";
import { collabEditModeGet, collabEditModeSet, onCollabCommentsStatus, onCollabLiveRole } from "@/lib/tauri-collab";
import { collabErrorText } from "../errors";
import { liveJoinedProjectId, useCollabLiveStore } from "../live/live-store";
import { canEditProjectRole, canSuggestProjectRole, suggestsOnlyProjectRole } from "../roles";

export interface EditModeState {
  projectId: string | null;
  mode: CollabEditMode | null;
  switchable: boolean;
  locked: CollabEditModeState["locked"];
  everyone: boolean | null;
  guests: boolean | null;
  manage: boolean;
  busy: boolean;
}

type EditModeData = Omit<EditModeState, "projectId" | "busy">;

const UNKNOWN: EditModeData = {
  mode: null,
  switchable: false,
  locked: null,
  everyone: null,
  guests: null,
  manage: false,
};

export const useEditMode = create<EditModeState>(() => ({ projectId: null, ...UNKNOWN, busy: false }));

function assumed(role: CollabProjectRole): CollabEditModeState {
  const reviewer = suggestsOnlyProjectRole(role);
  return {
    mode: reviewer ? "suggesting" : "editing",
    switchable: canEditProjectRole(role),
    locked: reviewer ? "reviewer" : null,
    everyone: null,
    guests: null,
    manage: false,
  };
}

function shown(state: CollabEditModeState, role: CollabProjectRole): EditModeData {
  const { mode, switchable, locked, everyone, guests, manage } = state;
  if (!suggestsOnlyProjectRole(role)) return { mode, switchable, locked, everyone, guests, manage };
  return { mode: "suggesting", switchable: false, locked: "reviewer", everyone, guests, manage };
}

let readToken = 0;

async function readMode(projectId: string, role: CollabProjectRole): Promise<void> {
  const token = ++readToken;
  let state: CollabEditModeState;
  try {
    state = await collabEditModeGet(projectId);
  } catch (error) {
    if (token !== readToken) return;
    void logError("collab edit mode", error);
    state = assumed(role);
  }
  if (token !== readToken || useEditMode.getState().projectId !== projectId) return;
  useEditMode.setState(shown(state, role));
}

function allowed(scope: CollabEditModeScope, state: EditModeState): boolean {
  if (scope === "me") return state.switchable;
  const current = scope === "everyone" ? state.everyone : state.guests;
  return state.manage && current !== null;
}

function changes(scope: CollabEditModeScope, mode: CollabEditMode, state: EditModeState): Partial<EditModeState> | null {
  const on = mode === "suggesting";
  if (scope === "me") return state.mode === mode ? null : { mode };
  if (scope === "everyone") return state.everyone === on ? null : { everyone: on };
  return state.guests === on ? null : { guests: on };
}

export async function setEditMode(mode: CollabEditMode, scope: CollabEditModeScope = "me"): Promise<void> {
  const before = useEditMode.getState();
  const { projectId, busy } = before;
  if (!projectId || busy || !allowed(scope, before)) return;
  const next = changes(scope, mode, before);
  if (!next) return;
  readToken += 1;
  useEditMode.setState({ ...next, busy: true });
  try {
    await collabEditModeSet(projectId, mode, scope);
  } catch (error) {
    void logError("collab set edit mode", error);
    if (useEditMode.getState().projectId === projectId) {
      const { mode: lastMode, everyone, guests } = before;
      useEditMode.setState({ mode: lastMode, everyone, guests });
      toast.error(collabErrorText(error));
    }
  } finally {
    if (useEditMode.getState().projectId === projectId) useEditMode.setState({ busy: false });
  }
}

interface Seen {
  projectId: string | null;
  role: CollabProjectRole | null;
  tracking: boolean;
}

export function startEditMode(): () => void {
  let seen: Seen = { projectId: null, role: null, tracking: false };
  let stopped = false;
  let queued = false;
  const read = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const { projectId, role } = seen;
      if (stopped || projectId === null || role === null || !canSuggestProjectRole(role)) return;
      void readMode(projectId, role);
    });
  };
  const sync = () => {
    const live = useCollabLiveStore.getState();
    const projectId = liveJoinedProjectId(live);
    const role = projectId ? live.role : null;
    const tracking = projectId ? live.tracking : false;
    if (seen.projectId === projectId && seen.role === role && seen.tracking === tracking) return;
    const projectChanged = seen.projectId !== projectId;
    seen = { projectId, role, tracking };
    readToken += 1;
    if (!projectId || !canSuggestProjectRole(role) || role === null) {
      useEditMode.setState({ projectId, ...UNKNOWN, busy: false });
      return;
    }
    if (projectChanged) useEditMode.setState({ projectId, ...UNKNOWN, busy: false });
    else useEditMode.setState({ projectId });
    read();
  };
  const reread = (payload: { projectId: string }) => {
    if (payload.projectId === seen.projectId && !useEditMode.getState().busy) read();
  };
  const stop = useCollabLiveStore.subscribe(sync);
  const listening = [onCollabLiveRole(reread), onCollabCommentsStatus(reread)].map((pending) =>
    pending.catch((error: unknown) => {
      void logError("collab edit mode listen", error);
      return () => undefined;
    }),
  );
  sync();
  return () => {
    stopped = true;
    stop();
    for (const pending of listening) void pending.then((unlisten) => unlisten());
    readToken += 1;
    useEditMode.setState({ projectId: null, ...UNKNOWN, busy: false });
  };
}
