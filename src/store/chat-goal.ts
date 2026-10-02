import { create } from "zustand";
import { readString, removeKey, writeString } from "@/lib/local-storage";

export interface ChatGoalState {
  goalsByProject: Record<string, string>;
  loaded: Record<string, boolean>;
  load: (projectId: string | null) => string;
  goal: (projectId: string | null) => string;
  setGoal: (projectId: string | null, goal: string) => void;
  clearGoal: (projectId: string | null) => void;
}

const storageKey = (projectId: string) => `oleafly.chat-goal.${projectId}`;

function readStored(projectId: string): string {
  return (readString(storageKey(projectId)) ?? "").trim();
}

function writeStored(projectId: string, goal: string): void {
  if (goal) {
    writeString(storageKey(projectId), goal);
  } else {
    removeKey(storageKey(projectId));
  }
}

export function goalForProject(
  goalsByProject: Readonly<Record<string, string>>,
  projectId: string | null,
): string {
  return projectId ? goalsByProject[projectId] ?? "" : "";
}

export const useChatGoalStore = create<ChatGoalState>((set, get) => ({
  goalsByProject: {},
  loaded: {},
  load: (projectId) => {
    if (!projectId) return "";
    if (get().loaded[projectId]) {
      return goalForProject(get().goalsByProject, projectId);
    }
    const goal = readStored(projectId);
    set((state) => ({
      goalsByProject: { ...state.goalsByProject, [projectId]: goal },
      loaded: { ...state.loaded, [projectId]: true },
    }));
    return goal;
  },
  goal: (projectId) => {
    if (!projectId) return "";
    if (!get().loaded[projectId]) return get().load(projectId);
    return goalForProject(get().goalsByProject, projectId);
  },
  setGoal: (projectId, value) => {
    if (!projectId) return;
    const goal = value.trim();
    writeStored(projectId, goal);
    set((state) => ({
      goalsByProject: { ...state.goalsByProject, [projectId]: goal },
      loaded: { ...state.loaded, [projectId]: true },
    }));
  },
  clearGoal: (projectId) => {
    get().setGoal(projectId, "");
  },
}));
