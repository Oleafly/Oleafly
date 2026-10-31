import type { ResearchBrief, ResearchTask } from "@/lib/research-tasks";

export type TaskFieldsSince047 = Pick<
  ResearchTask,
  | "brief"
  | "recordSlug"
  | "recordDir"
  | "runAfter"
  | "keepRunningAfterQuit"
  | "owner"
  | "phase"
  | "planApproved"
  | "stopReason"
  | "evidence"
  | "pendingApprovals"
  | "activeMs"
  | "todos"
  | "reclaimRequested"
  | "resumedFrom"
>;

export function briefFixture(patch: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    goal: "",
    successCriteria: [],
    scope: "",
    constraints: "",
    primaryMetric: null,
    reviewPlanFirst: false,
    permissions: { network: false, commands: "allow", desktopApps: false },
    budget: { wallClockMinutes: 120, usdCap: null, maxRuns: null, runTimeoutMinutes: 60 },
    profile: "analysis",
    compute: { executor: "local", target: null, resources: null },
    ...patch,
  };
}

export function taskFieldsSince047(patch: Partial<TaskFieldsSince047> = {}): TaskFieldsSince047 {
  return {
    brief: briefFixture(),
    recordSlug: "",
    recordDir: "",
    runAfter: null,
    keepRunningAfterQuit: false,
    owner: "app",
    phase: null,
    planApproved: false,
    stopReason: null,
    evidence: null,
    pendingApprovals: 0,
    activeMs: 0,
    todos: [],
    reclaimRequested: false,
    resumedFrom: null,
    ...patch,
  };
}

export function researchTaskFixture(patch: Partial<ResearchTask> = {}): ResearchTask {
  const id = patch.id ?? "task-1";
  return {
    id,
    projectId: "paper",
    title: `Task ${id}`,
    prompt: `Complete ${id}`,
    runtimeId: "builtin",
    agentId: "provider",
    modelId: "model",
    skillIds: [],
    dependencyIds: [],
    status: "queued",
    executionGeneration: 0,
    sessionId: null,
    nativeSessionId: null,
    sourceRevision: null,
    isolation: null,
    error: null,
    result: null,
    review: null,
    startRequested: false,
    cancelRequested: false,
    createdAt: 1,
    updatedAt: 1,
    startedAt: null,
    finishedAt: null,
    ...taskFieldsSince047(),
    ...patch,
  };
}
