import { create } from "zustand";
import { type FileReferencePlan, remapPath } from "@oleafly/editor/file-references";

export interface PendingReferenceUpdate {
  readonly id: number;
  readonly projectId: string;
  readonly from: string;
  readonly to: string;
  readonly plan: FileReferencePlan;
}

export type ReferenceUpdatePhase = "ask" | "applying" | "failed";

interface FileReferencesState {
  queue: PendingReferenceUpdate[];
  phase: ReferenceUpdatePhase;
  failed: string[];
  enqueue: (update: Omit<PendingReferenceUpdate, "id">) => void;
  remap: (projectId: string, from: string, to: string) => void;
  startApplying: () => void;
  fail: (paths: readonly string[]) => void;
  finish: () => void;
  clear: () => void;
}

let nextId = 1;

export function remapPlan(plan: FileReferencePlan, from: string, to: string): FileReferencePlan {
  return {
    ...plan,
    files: plan.files.map((file) => ({ ...file, path: remapPath(file.path, from, to) })),
  };
}

export const useFileReferencesStore = create<FileReferencesState>((set) => ({
  queue: [],
  phase: "ask",
  failed: [],
  enqueue: (update) => set((state) => ({ queue: [...state.queue, { ...update, id: nextId++ }] })),
  remap: (projectId, from, to) =>
    set((state) => ({
      queue: state.queue.map((pending) =>
        pending.projectId === projectId
          ? { ...pending, to: remapPath(pending.to, from, to), plan: remapPlan(pending.plan, from, to) }
          : pending,
      ),
    })),
  startApplying: () => set({ phase: "applying", failed: [] }),
  fail: (paths) => set({ phase: "failed", failed: [...paths] }),
  finish: () => set((state) => ({ queue: state.queue.slice(1), phase: "ask", failed: [] })),
  clear: () => set({ queue: [], phase: "ask", failed: [] }),
}));
