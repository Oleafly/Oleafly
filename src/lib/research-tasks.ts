import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ProjectStateChanged } from "@/lib/tauri";

export type ResearchTaskStatus =
  | "queued"
  | "running"
  | "awaiting_review"
  | "completed"
  | "failed"
  | "cancelled"
  | "plan_ready";

export type TaskIsolationKind = "git_worktree" | "staged_project";
export type TaskFileChangeKind = "added" | "modified" | "deleted";

export type SkipReason = "too_large" | "link_outside" | "link_to_folder" | "broken_link" | "not_unicode";

/** The task's workspace, without its file manifest. */
export interface TaskIsolationSummary {
  kind: TaskIsolationKind;
  executionRoot: string;
  sourceRevision: string;
  baselineHash: string;
  fileCount: number;
  createdAt: number;
  /** Project files the copy left out. */
  skipped?: { path: string; reason: SkipReason }[];
}

export type MetricGoal = "maximize" | "minimize";
export type CommandPolicy = "allow" | "ask" | "off";
export type RunProfile = "analysis" | "training";
export type TaskPhase =
  | "preparing"
  | "planning"
  | "working"
  | "waiting_runs"
  | "waiting_approval"
  | "wrapping_up"
  | "checking_evidence";
export type StopReason = "budget_time" | "budget_cost" | "budget_runs";
export type RetryMode = "resume" | "fresh";
export type OwnerKind = "app" | "daemon";

export interface PrimaryMetric {
  name: string;
  goal: MetricGoal;
}

export interface TaskBudget {
  wallClockMinutes: number;
  usdCap: number | null;
  maxRuns: number | null;
  runTimeoutMinutes: number;
}

export interface ComputeResources {
  timeMinutes: number | null;
  partition: string | null;
  gpus: number | null;
  cpus: number | null;
  memoryGb: number | null;
  account: string | null;
  qos: string | null;
}

export interface ResearchBrief {
  goal: string;
  successCriteria: string[];
  scope: string;
  constraints: string;
  primaryMetric: PrimaryMetric | null;
  reviewPlanFirst: boolean;
  permissions: { network: boolean; commands: CommandPolicy; desktopApps: boolean };
  budget: TaskBudget;
  profile: RunProfile;
  compute: { executor: string; target: string | null; resources: ComputeResources | null };
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export type EvidenceCheckId = "build" | "references" | "bibliography" | "numbers" | "figures";
export type EvidenceStatus = "pass" | "warn" | "skipped";

export interface EvidenceItem {
  code: string;
  file: string | null;
  line: number | null;
  params: Record<string, string>;
}

export interface EvidenceReport {
  checkedAt: number;
  checks: { id: EvidenceCheckId; status: EvidenceStatus; items: EvidenceItem[] }[];
}

export type RunState = "starting" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "lost";

export interface RunRecord {
  taskId: string;
  runId: string;
  executionGeneration: number;
  name: string;
  executor: string;
  command: string;
  cwdRel: string;
  state: RunState;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  runDir: string;
  metrics: Record<string, number>;
  reported: boolean;
}

export type ApprovalKind = "command" | "run" | "mcp";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "withdrawn";

export interface ApprovalRecord {
  id: string;
  taskId: string;
  executionGeneration: number;
  kind: ApprovalKind;
  summary: string;
  detail: string;
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
}

/** The brief a new task gets unless the composer changes it. */
export function defaultBrief(goal = ""): ResearchBrief {
  return {
    goal,
    successCriteria: [],
    scope: "",
    constraints: "",
    primaryMetric: null,
    reviewPlanFirst: false,
    permissions: { network: false, commands: "allow", desktopApps: false },
    budget: { wallClockMinutes: 120, usdCap: null, maxRuns: null, runTimeoutMinutes: 60 },
    profile: "analysis",
    compute: { executor: "local", target: null, resources: null },
  };
}

export interface TaskFileChange {
  path: string;
  kind: TaskFileChangeKind;
  beforeSha256: string | null;
  afterSha256: string | null;
  beforeSize: number | null;
  afterSize: number | null;
}

export interface TaskArtifact {
  path: string;
  label: string;
  mediaType: string | null;
}

export interface TaskResultMetadata {
  summary: string;
  changedFiles: TaskFileChange[];
  artifacts: TaskArtifact[];
  nativeSessionId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface TaskReviewResult {
  selectedPaths: string[];
  appliedAt: number;
  projectMutationGeneration: number;
}

export interface ResearchTask {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  runtimeId: string;
  agentId: string;
  modelId: string;
  skillIds: string[];
  dependencyIds: string[];
  status: ResearchTaskStatus;
  executionGeneration: number;
  sessionId: string | null;
  nativeSessionId: string | null;
  sourceRevision: string | null;
  isolation: TaskIsolationSummary | null;
  error: string | null;
  result: TaskResultMetadata | null;
  review: TaskReviewResult | null;
  startRequested: boolean;
  cancelRequested: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  brief: ResearchBrief;
  recordSlug: string;
  /** `research/<recordSlug>` in the task workspace. */
  recordDir: string;
  runAfter: number | null;
  keepRunningAfterQuit: boolean;
  owner: OwnerKind;
  phase: TaskPhase | null;
  planApproved: boolean;
  stopReason: StopReason | null;
  evidence: EvidenceReport | null;
  pendingApprovals: number;
  activeMs: number;
  todos: TodoItem[];
  /** 0.4.8 L: Oleafly asked the background helper for this task back. */
  reclaimRequested: boolean;
  /** 0.4.8 L: the generation this one continues, when it resumed. */
  resumedFrom: number | null;
}

export interface ResearchTaskDraft {
  projectId: string;
  title: string;
  prompt: string;
  runtimeId: string;
  agentId: string;
  modelId: string;
  skillIds: string[];
  dependencyIds: string[];
  brief?: ResearchBrief;
  runAfter?: number | null;
  keepRunningAfterQuit?: boolean;
}

type RawTask = Partial<ResearchTask> & Pick<ResearchTask, "id" | "projectId" | "status">;

/**
 * Fills fields a task from an older app version lacks (during an update the
 * webview can briefly talk to the previous backend).
 */
export function normalizeTask(raw: RawTask): ResearchTask {
  const brief = { ...defaultBrief(), ...raw.brief };
  return {
    title: "",
    prompt: "",
    runtimeId: "",
    agentId: "",
    modelId: "",
    skillIds: [],
    dependencyIds: [],
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
    createdAt: 0,
    updatedAt: 0,
    startedAt: null,
    finishedAt: null,
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
    ...raw,
    brief: {
      ...brief,
      permissions: { ...defaultBrief().permissions, ...raw.brief?.permissions },
      budget: { ...defaultBrief().budget, ...raw.brief?.budget },
      compute: { ...defaultBrief().compute, ...raw.brief?.compute },
    },
  };
}

export type ResearchTaskEdit = Omit<ResearchTaskDraft, "projectId">;

export type TaskToolPhase = "request" | "result" | "update";

export interface TaskToolEvent {
  kind: "tool";
  name: string;
  detail: string;
  callId?: string | null;
  phase?: TaskToolPhase;
  status?: string | null;
}

export type TaskRuntimeEvent =
  | { kind: "sessionBound"; nativeSessionId: string }
  | { kind: "status"; message: string }
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | TaskToolEvent
  | { kind: "artifact"; artifact: TaskArtifact }
  | { kind: "usage"; inputTokens: number | null; outputTokens: number | null }
  | { kind: "run"; runId: string; name: string; state: RunState; exitCode: number | null }
  | { kind: "approval"; approvalId: string; approvalKind: ApprovalKind; status: ApprovalStatus; summary: string }
  | { kind: "phase"; phase: TaskPhase };

export interface TaskTranscriptEvent {
  taskId: string;
  executionGeneration: number;
  sequence: number;
  event: TaskRuntimeEvent;
  createdAt: number;
  /**
   * Set by this window on a text row it built from live text that began
   * after the row did: where its text starts in the row (UTF-16 units).
   */
  textStart?: number;
}

export interface TaskTranscriptPage {
  events: TaskTranscriptEvent[];
  nextSequence: number | null;
}

export interface TaskApplyResult {
  task: ResearchTask;
  projectState: ProjectStateChanged;
}

export interface TaskPreviewContent {
  exists: boolean;
  text: string | null;
  base64: string | null;
  mediaType: string | null;
  binary: boolean;
  truncated: boolean;
  size: number | null;
  sha256: string | null;
}

export interface TaskFilePreview {
  path: string;
  change: TaskFileChangeKind;
  before: TaskPreviewContent;
  after: TaskPreviewContent;
  projectSha256: string | null;
  baseIsCurrent: boolean;
  mergesWithShared: boolean;
}

export interface TaskArtifactPreview {
  artifact: TaskArtifact;
  content: TaskPreviewContent;
}

const normalized = (task: Promise<ResearchTask>) => task.then(normalizeTask);

export const listResearchTasks = (projectId: string) =>
  invoke<ResearchTask[]>("research_task_list", { projectId }).then((tasks) => tasks.map(normalizeTask));

export const createResearchTask = (draft: ResearchTaskDraft) =>
  normalized(invoke<ResearchTask>("research_task_create", { draft }));

export const editResearchTask = (taskId: string, edit: ResearchTaskEdit) =>
  normalized(invoke<ResearchTask>("research_task_edit", { taskId, edit }));

export const startResearchTask = (taskId: string) =>
  normalized(invoke<ResearchTask>("research_task_start", { taskId }));

export const cancelResearchTask = (taskId: string) =>
  normalized(invoke<ResearchTask>("research_task_cancel", { taskId }));

/** Resume continues in the saved workspace; fresh (the default) starts over. */
export const retryResearchTask = (taskId: string, mode: RetryMode = "fresh") =>
  normalized(invoke<ResearchTask>("research_task_retry", { taskId, mode }));

export const acceptResearchTaskResult = (taskId: string) =>
  normalized(invoke<ResearchTask>("research_task_accept_result", { taskId }));

export const deleteResearchTask = (taskId: string) =>
  invoke<void>("research_task_delete", { taskId });

/** 0.4.8 L: "Keep running when Oleafly is closed" for a task that has not finished. */
export const setResearchTaskKeepRunning = (taskId: string, keep: boolean) =>
  normalized(invoke<ResearchTask>("research_task_set_keep_running", { taskId, keep }));

export const applyResearchTask = (
  taskId: string,
  expectedProjectGeneration: number,
  selectedPaths: string[],
) =>
  invoke<TaskApplyResult>("research_task_apply", {
    request: { taskId, expectedProjectGeneration, selectedPaths },
  }).then((result) => ({ ...result, task: normalizeTask(result.task) }));

export const loadResearchTaskEvents = (
  taskId: string,
  executionGeneration: number,
  afterSequence?: number,
  limit = 100,
) =>
  invoke<TaskTranscriptPage>("research_task_events", {
    taskId,
    executionGeneration,
    afterSequence: afterSequence ?? null,
    limit,
  });

export const previewResearchTaskFile = (taskId: string, path: string) =>
  invoke<TaskFilePreview>("research_task_file_preview", { taskId, path });

export const previewResearchTaskArtifact = (taskId: string, path: string) =>
  invoke<TaskArtifactPreview>("research_task_artifact_preview", { taskId, path });

export const listenForResearchTaskChanges = (
  onTask: (task: ResearchTask) => void,
): Promise<UnlistenFn> =>
  listen<ResearchTask>("research-task-changed", (event) => onTask(normalizeTask(event.payload)));

export const listenForResearchTaskEvents = (
  onEvent: (event: TaskTranscriptEvent) => void,
): Promise<UnlistenFn> =>
  listen<TaskTranscriptEvent>("research-task-event", (event) => onEvent(event.payload));

/** Text added to a transcript row, sent only to windows watching the task. */
export interface TaskTranscriptDelta {
  taskId: string;
  executionGeneration: number;
  sequence: number;
  kind: "text" | "reasoning";
  append: string;
  createdAt: number;
  /** The row's text length after this append, in UTF-16 units. */
  textLength?: number;
}

export const listenForResearchTaskDeltas = (
  onDelta: (delta: TaskTranscriptDelta) => void,
): Promise<UnlistenFn> =>
  listen<TaskTranscriptDelta>("research-task-delta", (event) => onDelta(event.payload));

/** Transcript rows and deltas reach this window only for the watched task. */
export const watchResearchTask = (taskId: string | null) =>
  invoke<void>("research_task_watch", { taskId });

export const loadResearchTaskPlan = (taskId: string) =>
  invoke<string>("research_task_plan", { taskId });

/** Approves the plan, replacing it first when `editedPlan` is given. */
export const approveResearchTaskPlan = (taskId: string, editedPlan?: string) =>
  normalized(
    invoke<ResearchTask>("research_task_approve_plan", { taskId, editedPlan: editedPlan ?? null }),
  );

export interface PlanItem {
  text: string;
  done: boolean;
}

export interface LedgerRow {
  id: string;
  time: string;
  hypothesis: string;
  change: string;
  command: string;
  metrics: Record<string, number>;
  verdict: string;
  notes: string;
}

export interface BestMetric {
  name: string;
  value: number;
  runId: string;
  /** The metric over the last 30 finished runs, oldest first. */
  series: number[];
}

export interface BudgetUsage {
  activeMinutes: number;
  limitMinutes: number;
  spentUsd: number | null;
  usdCap: number | null;
  runsStarted: number;
  maxRuns: number | null;
}

export interface TaskProgress {
  phase: TaskPhase | null;
  plan: PlanItem[];
  todos: TodoItem[];
  ledger: LedgerRow[];
  best: BestMetric | null;
  runsInFlight: RunRecord[];
  recentRuns: RunRecord[];
  budget: BudgetUsage;
  evidence: EvidenceReport | null;
  recordDir: string;
}

export const progressResearchTask = (taskId: string) =>
  invoke<TaskProgress>("research_task_progress", { taskId });

export const cancelResearchTaskRun = (taskId: string, runId: string) =>
  invoke<void>("research_task_run_cancel", { taskId, runId });

export const researchTaskRunLog = (taskId: string, runId: string, tail = 200) =>
  invoke<string>("research_task_run_log", { taskId, runId, tail });

export const listResearchTaskApprovals = (projectId: string) =>
  invoke<ApprovalRecord[]>("research_task_approvals", { projectId });

export const decideResearchTaskApproval = (approvalId: string, approve: boolean) =>
  invoke<ApprovalRecord>("research_task_approval_decide", { approvalId, approve });

export const refreshResearchTaskEvidence = (taskId: string) =>
  normalized(invoke<ResearchTask>("research_task_evidence_refresh", { taskId }));

export interface AttentionSummary {
  byProject: Record<string, number>;
}

export const loadResearchAttention = () => invoke<AttentionSummary>("research_task_attention");

export const listenForResearchAttention = (
  onSummary: (summary: AttentionSummary) => void,
): Promise<UnlistenFn> =>
  listen<AttentionSummary>("research-attention", (event) => onSummary(event.payload));

export type NotificationPermission = "granted" | "denied" | "prompt";

/** The notification permission; `request` asks the system first. */
export const researchNotificationPermission = (request = false) =>
  invoke<NotificationPermission>("research_notification_permission", { request });
