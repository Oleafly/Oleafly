import { logError } from "@/lib/log";

export interface ProjectLeave {
  projectId: string;
  reason: "close" | "switch";
  targetProjectId: string | null;
}

export type ProjectLeaveGuard = (leave: ProjectLeave) => Promise<boolean>;

const guards: ProjectLeaveGuard[] = [];

export function registerProjectLeaveGuard(guard: ProjectLeaveGuard): () => void {
  guards.push(guard);
  return () => {
    const index = guards.indexOf(guard);
    if (index >= 0) guards.splice(index, 1);
  };
}

export async function projectLeaveAllowed(leave: ProjectLeave): Promise<boolean> {
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
