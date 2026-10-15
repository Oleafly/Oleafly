import { create } from "zustand";
import { logError } from "@/lib/log";
import type {
  CollabErrorCode,
  CollabLiveEndedReason,
  CollabLiveRemoved,
  CollabLiveRemovedFile,
} from "@/lib/tauri";
import {
  collabLiveFlush,
  collabLiveRemovedDismiss,
  collabLiveRemovedList,
  collabTrashRestore,
  onCollabLiveRemoved,
} from "@/lib/tauri-collab";
import { useFilesStore } from "@/store/files";
import { collabErrorCode } from "../errors";
import { useCollabLiveStore } from "./live-store";

export interface RemovedNotice {
  id: string;
  path: string;
  kind: "dir" | "text" | "blob";
  by: string | null;
  yours: boolean;
}

export interface RemovedNoticesState {
  projectId: string | null;
  notices: readonly RemovedNotice[];
  restoring: string | null;
  failure: { id: string; code: CollabErrorCode } | null;
  forget: (id: string) => void;
  dismiss: (id: string) => void;
  restore: (id: string) => Promise<void>;
}

const NONE: readonly RemovedNotice[] = [];
let returned = new Set<string>();
const LOCAL_COPY: ReadonlySet<CollabLiveEndedReason> = new Set(["removed", "archived", "access_ended"]);

function covers(parent: string, path: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function notice(file: CollabLiveRemovedFile): RemovedNotice {
  return { id: file.id, path: file.path, kind: file.kind, by: file.by, yours: file.yours };
}

async function reopen(projectId: string, restored: RemovedNotice): Promise<void> {
  if (restored.kind !== "text") return;
  try {
    await collabLiveFlush(projectId);
    if (useFilesStore.getState().projectId !== projectId) return;
    await useFilesStore.getState().refreshTree();
    const files = useFilesStore.getState();
    if (files.projectId !== projectId) return;
    if (files.tree.some((entry) => entry.path === restored.path && !entry.is_dir)) {
      await files.openFile(restored.path);
    }
  } catch (error) {
    void logError("reopen a restored file", error);
  }
}

export const useRemovedNotices = create<RemovedNoticesState>((set, get) => ({
  projectId: null,
  notices: NONE,
  restoring: null,
  failure: null,
  forget: (id) =>
    set((state) => ({
      notices: state.notices.filter((candidate) => candidate.id !== id),
      failure: state.failure?.id === id ? null : state.failure,
    })),
  dismiss: (id) => {
    const projectId = get().projectId;
    get().forget(id);
    if (projectId) {
      Promise.resolve()
        .then(() => collabLiveRemovedDismiss(projectId, id))
        .catch((error) => logError("forget a removed-file notice", error));
    }
  },
  restore: async (id) => {
    const { projectId, notices, restoring } = get();
    const restored = notices.find((candidate) => candidate.id === id);
    if (!projectId || !restored || restoring !== null) return;
    set({ restoring: id, failure: null });
    try {
      await collabTrashRestore(projectId, id);
    } catch (error) {
      set({ restoring: null, failure: { id, code: collabErrorCode(error) } });
      return;
    }
    set((state) => ({
      restoring: null,
      notices: state.notices.filter((candidate) => candidate.id !== id),
    }));
    await reopen(projectId, restored);
  },
}));

function cameBack(projectId: string, ids: readonly string[]): void {
  for (const id of ids) returned.add(id);
  useRemovedNotices.setState((state) => {
    if (state.projectId !== projectId) return state;
    const notices = state.notices.filter((notice) => !returned.has(notice.id));
    if (notices.length === state.notices.length) return state;
    const failure = state.failure && returned.has(state.failure.id) ? null : state.failure;
    return { notices, failure };
  });
}

function removed(payload: CollabLiveRemoved): void {
  const files = useFilesStore.getState();
  if (files.projectId !== payload.projectId) return;
  for (const file of payload.files) returned.delete(file.id);
  if (payload.restored.length > 0) cameBack(payload.projectId, payload.restored);
  const open = (path: string) => files.openTabs.some((tab) => covers(path, tab));
  const told = payload.files.filter((file) => file.yours || open(file.path));
  for (const file of payload.files) {
    if (open(file.path)) {
      useFilesStore.getState().applyExternalDelete(payload.projectId, file.path, { leaveEmpty: true });
    }
  }
  if (told.length === 0) return;
  const live = useCollabLiveStore.getState();
  const unknown = told.some(
    (file) => file.by && !live.members.some((member) => member.person.account_id === file.by),
  );
  if (unknown) void live.refreshMembers();
  useRemovedNotices.setState((state) => {
    const fresh = told.map(notice);
    const kept =
      state.projectId === payload.projectId
        ? state.notices.filter((existing) => !fresh.some((added) => added.id === existing.id))
        : NONE;
    return { projectId: payload.projectId, notices: [...fresh, ...kept] };
  });
}

function recall(projectId: string): void {
  Promise.resolve()
    .then(() => collabLiveRemovedList(projectId))
    .then((files) => {
      if (files.length === 0) return;
      useRemovedNotices.setState((state) => {
        if (state.projectId !== projectId) return state;
        const shown = new Set(state.notices.map((existing) => existing.id));
        const kept = files.filter((file) => !shown.has(file.id) && !returned.has(file.id)).map(notice);
        return kept.length === 0 ? state : { notices: [...state.notices, ...kept] };
      });
    })
    .catch((error) => logError("load removed-file notices", error));
}

function openProject(projectId: string | null): void {
  returned = new Set();
  useRemovedNotices.setState({ projectId, notices: NONE, restoring: null, failure: null });
  if (projectId) recall(projectId);
}

export async function followLocalCopies(projectIds: readonly string[]): Promise<void> {
  try {
    await useFilesStore.getState().refreshProjects();
    const files = useFilesStore.getState();
    if (!files.projectId || !projectIds.includes(files.projectId)) return;
    const project = files.projects.find((candidate) => candidate.id === files.projectId);
    if (project && files.projectName !== project.name) useFilesStore.setState({ projectName: project.name });
    if (useCollabLiveStore.getState().projectId === files.projectId) await useCollabLiveStore.getState().refreshShare();
  } catch (error) {
    void logError("show the local copy name", error);
  }
}

export function startRemovedNotices(): () => void {
  const unlisten = onCollabLiveRemoved(removed).catch((error) => {
    void logError("collab removed listen", error);
    return () => {};
  });
  let projectId = useFilesStore.getState().projectId;
  openProject(projectId);
  const stopFiles = useFilesStore.subscribe((state) => {
    if (state.projectId === projectId) return;
    projectId = state.projectId;
    openProject(projectId);
  });
  const stopEnded = useCollabLiveStore.subscribe((state, previous) => {
    if (state.ended === previous.ended || state.ended === null || state.projectId === null) return;
    if (LOCAL_COPY.has(state.ended)) void followLocalCopies([state.projectId]);
  });
  return () => {
    stopFiles();
    stopEnded();
    void unlisten.then((stop) => stop());
    useRemovedNotices.setState({ projectId: null, notices: NONE, restoring: null, failure: null });
  };
}
