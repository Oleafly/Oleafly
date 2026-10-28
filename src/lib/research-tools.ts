import { invoke } from "@tauri-apps/api/core";
import {
  createResearchTaskTools,
  createResearchTools,
  type ConfirmFn,
  type ResearchTaskToolsHost,
  type ResearchToolsHost,
} from "@oleafly/ai-tools";
// Not components/ai/provider-config: it adds a window listener when imported,
// and this module is imported by the MCP bridge at startup.
import { hasConfiguredProvider, pickActiveProvider } from "@/lib/ai-providers";
import { getConfig, type AppConfig } from "@/lib/tauri";
import { retrieveProjectChunks } from "@/lib/ai-rag";
import { verifyCitation } from "@/lib/research-literature";
import {
  createResearchTask,
  defaultBrief,
  listResearchTasks,
  startResearchTask,
  type ResearchTask,
} from "@/lib/research-tasks";
import { useFilesStore } from "@/store/files";
import { researchTasksEnabled } from "@/store/research-tasks-flag";

const MAX_SUMMARY = 2_000;
/** What an agent reads when it asks for a task while the switch is off (0.4.8: experimental). */
export const TASKS_OFF =
  "Research tasks are turned off. They are experimental in this version; the user can turn them on under Settings, Research, at their own risk.";
/** The longest goal the composer takes; the task store refuses one over 4,000 characters. */
const MAX_DEFAULT_GOAL = 2_000;

function openProject(): string {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) throw new Error("Open a project first.");
  return projectId;
}

/** The goal of a task created without one: the start of its prompt, cut where a character ends. */
export function defaultGoal(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= MAX_DEFAULT_GOAL) return trimmed;
  const cut = trimmed.slice(0, MAX_DEFAULT_GOAL);
  // A lone high surrogate is not text the backend can read.
  const last = cut.codePointAt(cut.length - 1) ?? 0;
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trimEnd();
}

/**
 * The built-in agent a task created by a tool runs on: the AI provider the
 * assistant uses (one with a key, or a custom provider that needs none), and its
 * model. A task without one fails as soon as it starts.
 */
export function builtinTaskAgent(config: AppConfig): { agentId: string; modelId: string } {
  const { providerId, modelId } = pickActiveProvider(config);
  if (!hasConfiguredProvider(config)) {
    throw new Error(
      "No AI provider has an API key in Oleafly's settings, so a research task has no agent to run it. Ask the user to add a key in Settings, AI, or to create the task from the Research panel.",
    );
  }
  if (!modelId.trim()) {
    throw new Error(
      `No model is chosen for ${providerId} in Oleafly's settings, so a research task can't run. Ask the user to choose one in Settings, AI.`,
    );
  }
  return { agentId: providerId, modelId };
}

function taskStatus(task: ResearchTask) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    phase: task.phase,
    budgetUsedMinutes: Math.round(task.activeMs / 60_000),
    timeBudgetMinutes: task.brief.budget.wallClockMinutes,
    pendingApprovals: task.pendingApprovals,
    resultSummary: (task.result?.summary ?? "").slice(0, MAX_SUMMARY),
    changedFiles: task.result?.changedFiles.length ?? 0,
    recordDir: task.recordDir,
    error: task.error,
  };
}

const HOST: ResearchToolsHost & ResearchTaskToolsHost = {
  searchLiterature: (query, { limit, sources }) =>
    invoke("literature_search_all", { query: { query, limit, sources: sources ?? [] } }),
  verifyCitation,
  retrieveProjectChunks,
  createResearchTask: async (input) => {
    if (!researchTasksEnabled()) throw new Error(TASKS_OFF);
    const projectId = openProject();
    const config = await getConfig();
    const agent = builtinTaskAgent(config);
    // A whole prompt can be longer than a goal may be.
    const brief = defaultBrief(input.brief.goal ?? defaultGoal(input.prompt));
    brief.successCriteria = input.brief.successCriteria ?? [];
    brief.reviewPlanFirst = input.brief.reviewPlanFirst ?? false;
    // A task an agent creates asks before each command it runs, and has no network unless
    // the agent asked for it and the user saw that in the confirmation.
    brief.permissions.commands = "ask";
    brief.permissions.network = input.brief.network ?? false;
    brief.budget.wallClockMinutes =
      input.brief.timeBudgetMinutes ?? config.research_time_budget_minutes ?? brief.budget.wallClockMinutes;
    let task = await createResearchTask({
      projectId,
      title: input.title,
      prompt: input.prompt,
      runtimeId: "builtin",
      agentId: agent.agentId,
      modelId: agent.modelId,
      skillIds: input.skillIds,
      dependencyIds: [],
      brief,
    });
    if (input.start) task = await startResearchTask(task.id);
    return { id: task.id, title: task.title, status: task.status };
  },
  researchTaskStatus: async (id) => {
    const tasks = await listResearchTasks(openProject());
    if (id) {
      const task = tasks.find((candidate) => candidate.id === id);
      return task ? taskStatus(task) : { error: "No task with that id in this project." };
    }
    return { tasks: tasks.slice(0, 10).map(taskStatus) };
  },
};

/** The literature tools, and the task tools while research tasks are on. */
export function createResearchAiTools(opts?: { confirm?: ConfirmFn }) {
  return { ...createResearchTools(HOST, opts), ...createResearchTaskAiTools(opts) };
}

/** The research task tools alone (the app's MCP server offers these); none while tasks are off. */
export function createResearchTaskAiTools(opts?: { confirm?: ConfirmFn }) {
  return researchTasksEnabled() ? createResearchTaskTools(HOST, opts) : {};
}
