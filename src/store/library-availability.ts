import { create } from "zustand";
import { logError } from "@/lib/log";
import { probeProjectAvailability, type ProjectAvailability } from "@/lib/tauri";

const RECHECK_AFTER_MS = 15_000;

const inFlight = new Map<string, Promise<void>>();
const lastChecked = new Map<string, number>();

interface LibraryAvailabilityState {
  checked: Record<string, ProjectAvailability>;
  checking: Record<string, true>;
  check: (
    projectIds: readonly string[],
    options?: { force?: boolean },
  ) => Promise<Record<string, ProjectAvailability>>;
  reset: () => void;
}

type SetState = (
  update: (state: LibraryAvailabilityState) => Partial<LibraryAvailabilityState>,
) => void;

function without(
  checking: Record<string, true>,
  projectIds: readonly string[],
): Record<string, true> {
  const next = { ...checking };
  for (const projectId of projectIds) delete next[projectId];
  return next;
}

async function runCheck(projectIds: string[], set: SetState): Promise<void> {
  set((state) => ({
    checking: { ...state.checking, ...Object.fromEntries(projectIds.map((id) => [id, true])) },
  }));
  try {
    const reports = await probeProjectAvailability(projectIds);
    const found: Record<string, ProjectAvailability> = {};
    const checkedAt = Date.now();
    for (const report of reports) {
      if (report.availability === "unknown") continue;
      found[report.project_id] = report.availability;
      lastChecked.set(report.project_id, checkedAt);
    }
    set((state) => ({ checked: { ...state.checked, ...found } }));
  } catch (error) {
    void logError("check library folders", error);
  } finally {
    for (const projectId of projectIds) inFlight.delete(projectId);
    set((state) => ({ checking: without(state.checking, projectIds) }));
  }
}

export const useLibraryAvailabilityStore = create<LibraryAvailabilityState>((set, get) => ({
  checked: {},
  checking: {},
  check: async (projectIds, options = {}) => {
    const now = Date.now();
    const waiting = new Set<Promise<void>>();
    const fresh: string[] = [];
    for (const projectId of new Set(projectIds)) {
      const running = inFlight.get(projectId);
      if (running) {
        waiting.add(running);
        continue;
      }
      const last = lastChecked.get(projectId);
      if (!options.force && last !== undefined && now - last < RECHECK_AFTER_MS) continue;
      fresh.push(projectId);
    }
    if (fresh.length > 0) {
      const run = runCheck(fresh, set);
      for (const projectId of fresh) inFlight.set(projectId, run);
      waiting.add(run);
    }
    await Promise.all(waiting);
    const { checked } = get();
    return Object.fromEntries(
      projectIds
        .filter((projectId) => checked[projectId] !== undefined)
        .map((projectId) => [projectId, checked[projectId]]),
    );
  },
  reset: () => {
    inFlight.clear();
    lastChecked.clear();
    set({ checked: {}, checking: {} });
  },
}));
