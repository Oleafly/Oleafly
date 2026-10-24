// Checks that run before the files store closes a project or switches to
// another one, such as asking whether to stop programs running in its
// terminals. Small on purpose: the store imports it on every project change.
import { logError } from "@/lib/log";

export interface ProjectLeave {
  projectId: string;
  reason: "close" | "switch";
  /** The project being opened when switching; null when closing. */
  targetProjectId: string | null;
}

/** Resolves false to keep the project open. */
export type ProjectLeaveGuard = (leave: ProjectLeave) => Promise<boolean>;

const guards: ProjectLeaveGuard[] = [];

export function registerProjectLeaveGuard(guard: ProjectLeaveGuard): () => void {
  guards.push(guard);
  return () => {
    const index = guards.indexOf(guard);
    if (index >= 0) guards.splice(index, 1);
  };
}

/**
 * Runs the guards in order; the first that says no wins. A guard that throws
 * counts as yes, so a broken check never traps the user in a project.
 */
export async function projectLeaveAllowed(leave: ProjectLeave): Promise<boolean> {
  // A guard can unregister while it awaits; walking the live list would skip the next one.
  const snapshot = [...guards];
  for (const guard of snapshot) {
    try {
      if (!(await guard(leave))) return false;
    } catch (error) {
      void logError("project leave guard", error);
    }
  }
  return true;
}
