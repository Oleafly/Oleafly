import { create } from "zustand";
import {
  DEFAULT_APPROVAL_MODE,
  type ApprovalMode,
} from "@oleafly/ai-tools";
import { approvalsModeGet, approvalsModeSet } from "@/lib/tauri";

interface ApprovalModeState {
  modes: Record<string, ApprovalMode>;
  loaded: Record<string, boolean>;
  persisted: Record<string, ApprovalMode>;
  load(projectId: string | null): Promise<ApprovalMode>;
  setMode(projectId: string | null, mode: ApprovalMode): Promise<void>;
  ready(projectId: string | null): Promise<ApprovalMode>;
}

const loads = new Map<string, Promise<ApprovalMode>>();
const writes = new Map<string, Promise<void>>();
const revisions = new Map<string, number>();

export function approvalModeForProject(
  modes: Readonly<Record<string, ApprovalMode>>,
  projectId: string | null,
): ApprovalMode {
  return (projectId && modes[projectId]) || DEFAULT_APPROVAL_MODE;
}

export const useApprovalModeStore = create<ApprovalModeState>((set, get) => ({
  modes: {},
  loaded: {},
  persisted: {},
  async load(projectId) {
    if (!projectId) return DEFAULT_APPROVAL_MODE;
    if (get().loaded[projectId]) {
      return approvalModeForProject(get().modes, projectId);
    }
    const existing = loads.get(projectId);
    if (existing) return existing;
    const request = approvalsModeGet(projectId)
      .then((mode) => {
        if (!get().loaded[projectId]) {
          set((state) => ({
            modes: { ...state.modes, [projectId]: mode },
            loaded: { ...state.loaded, [projectId]: true },
            persisted: { ...state.persisted, [projectId]: mode },
          }));
        }
        return approvalModeForProject(get().modes, projectId);
      })
      .finally(() => {
        if (loads.get(projectId) === request) loads.delete(projectId);
      });
    loads.set(projectId, request);
    return request;
  },
  async setMode(projectId, mode) {
    if (!projectId) return;
    if (!get().loaded[projectId]) await get().load(projectId);
    const revision = (revisions.get(projectId) ?? 0) + 1;
    revisions.set(projectId, revision);
    set((state) => ({
      modes: { ...state.modes, [projectId]: mode },
      loaded: { ...state.loaded, [projectId]: true },
    }));
    const priorWrite = writes.get(projectId) ?? Promise.resolve();
    const write = priorWrite
      .catch(() => undefined)
      .then(() => approvalsModeSet(projectId, mode));
    writes.set(projectId, write);
    try {
      await write;
      set((state) => ({
        persisted: { ...state.persisted, [projectId]: mode },
      }));
    } catch (error) {
      if ((revisions.get(projectId) ?? 0) === revision) {
        const persisted = approvalModeForProject(get().persisted, projectId);
        set((state) => ({
          modes: { ...state.modes, [projectId]: persisted },
        }));
      }
      throw error;
    } finally {
      if (writes.get(projectId) === write) writes.delete(projectId);
    }
  },
  async ready(projectId) {
    if (!projectId) return DEFAULT_APPROVAL_MODE;
    const pending = writes.get(projectId);
    if (pending) {
      await pending;
      return approvalModeForProject(get().modes, projectId);
    }
    while (true) {
      const revision = revisions.get(projectId) ?? 0;
      const mode = await approvalsModeGet(projectId);
      const laterWrite = writes.get(projectId);
      if (laterWrite) {
        await laterWrite;
        return approvalModeForProject(get().modes, projectId);
      }
      if ((revisions.get(projectId) ?? 0) !== revision) continue;
      set((state) => ({
        modes: { ...state.modes, [projectId]: mode },
        loaded: { ...state.loaded, [projectId]: true },
        persisted: { ...state.persisted, [projectId]: mode },
      }));
      return mode;
    }
  },
}));
