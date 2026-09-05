import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ProjectStateChanged } from "@/lib/tauri";

export type ResearchTaskStatus =
  | "queued"
  | "running"
  | "awaiting_review"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskIsolationKind = "git_worktree" | "staged_project";
export type TaskFileChangeKind = "added" | "modified" | "deleted";

export interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface TaskIsolation {
  kind: TaskIsolationKind;
  executionRoot: string;
  baselineRoot: string;
  sourceRevision: string;
  baselineHash: string;
  baseline: ManifestEntry[];
  allowedPaths: string[];
  createdAt: number;
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
  isolation: TaskIsolation | null;
  error: string | null;
  result: TaskResultMetadata | null;
  review: TaskReviewResult | null;
  startRequested: boolean;
  cancelRequested: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
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
}

export type ResearchTaskEdit = Omit<ResearchTaskDraft, "projectId">;

export type TaskRuntimeEvent =
  | { kind: "sessionBound"; nativeSessionId: string }
  | { kind: "status"; message: string }
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "artifact"; artifact: TaskArtifact }
  | { kind: "usage"; inputTokens: number | null; outputTokens: number | null };

export interface TaskTranscriptEvent {
  taskId: string;
  executionGeneration: number;
  sequence: number;
  event: TaskRuntimeEvent;
  createdAt: number;
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
}

export interface TaskArtifactPreview {
  artifact: TaskArtifact;
  content: TaskPreviewContent;
}

export const listResearchTasks = (projectId: string) =>
  invoke<ResearchTask[]>("research_task_list", { projectId });

export const createResearchTask = (draft: ResearchTaskDraft) =>
  invoke<ResearchTask>("research_task_create", { draft });

export const editResearchTask = (taskId: string, edit: ResearchTaskEdit) =>
  invoke<ResearchTask>("research_task_edit", { taskId, edit });

export const startResearchTask = (taskId: string) =>
  invoke<ResearchTask>("research_task_start", { taskId });

export const cancelResearchTask = (taskId: string) =>
  invoke<ResearchTask>("research_task_cancel", { taskId });

export const retryResearchTask = (taskId: string) =>
  invoke<ResearchTask>("research_task_retry", { taskId });

export const acceptResearchTaskResult = (taskId: string) =>
  invoke<ResearchTask>("research_task_accept_result", { taskId });

export const applyResearchTask = (
  taskId: string,
  expectedProjectGeneration: number,
  selectedPaths: string[],
) =>
  invoke<TaskApplyResult>("research_task_apply", {
    request: { taskId, expectedProjectGeneration, selectedPaths },
  });

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

export const readProjectMutationGeneration = (projectId: string) =>
  invoke<number>("project_mutation_generation", { projectId });

export const listenForResearchTaskChanges = (
  onTask: (task: ResearchTask) => void,
): Promise<UnlistenFn> =>
  listen<ResearchTask>("research-task-changed", (event) => onTask(event.payload));

export const listenForResearchTaskEvents = (
  onEvent: (event: TaskTranscriptEvent) => void,
): Promise<UnlistenFn> =>
  listen<TaskTranscriptEvent>("research-task-event", (event) => onEvent(event.payload));
