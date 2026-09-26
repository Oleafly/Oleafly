import { create } from "zustand";
import { decodeAppError } from "@/lib/app-error";
import type { ProjectAvailability, ProjectAvailabilityEvent } from "@/lib/tauri";

export type { ProjectAvailability, ProjectAvailabilityEvent };

const LOCATION_ERROR_AVAILABILITY = new Map<string, ProjectAvailability>([
  ["project.linked_missing", "missing"],
  ["project.linked_replaced", "replaced"],
  ["project.linked_permission_denied", "permission_denied"],
]);

interface ProjectAvailabilityState {
  projectId: string | null;
  availability: ProjectAvailability;
  locationGeneration: number;
  relocations: number;
  grantResets: number;
  reset: (projectId: string | null) => void;
  report: (projectId: string, availability: ProjectAvailability) => void;
  apply: (event: ProjectAvailabilityEvent) => void;
}

export const useProjectAvailabilityStore = create<ProjectAvailabilityState>((set, get) => ({
  projectId: null,
  availability: "ok",
  locationGeneration: 0,
  relocations: 0,
  grantResets: 0,
  reset: (projectId) =>
    set({ projectId, availability: "ok", locationGeneration: 0, relocations: 0, grantResets: 0 }),
  report: (projectId, availability) => {
    const current = get();
    if (availability === "unknown") return;
    if (current.projectId !== projectId || current.availability === availability) return;
    set({ availability });
  },
  apply: (event) => {
    const current = get();
    if (current.projectId !== event.projectId) return;
    if (event.locationGeneration < current.locationGeneration) return;
    set({
      availability: event.availability,
      locationGeneration: event.locationGeneration,
      relocations: event.relocated ? current.relocations + 1 : current.relocations,
      grantResets: event.grantsReset ? current.grantResets + 1 : current.grantResets,
    });
  },
}));

export function folderReachable(availability: ProjectAvailability): boolean {
  return availability === "ok" || availability === "unknown";
}

export function projectFolderAvailable(projectId: string | null): boolean {
  const state = useProjectAvailabilityStore.getState();
  return projectId === null || state.projectId !== projectId || folderReachable(state.availability);
}

export function locationErrorAvailability(error: unknown): ProjectAvailability | null {
  const code = decodeAppError(error)?.code;
  return code ? (LOCATION_ERROR_AVAILABILITY.get(code) ?? null) : null;
}

export function reportLocationError(projectId: string, error: unknown): boolean {
  const availability = locationErrorAvailability(error);
  if (!availability) return false;
  useProjectAvailabilityStore.getState().report(projectId, availability);
  return true;
}
