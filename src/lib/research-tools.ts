import { invoke } from "@tauri-apps/api/core";
import {
  createResearchTaskTools,
  createResearchTools,
  type ConfirmFn,
  type ResearchTaskToolsHost,
  type ResearchToolsHost,
} from "@oleafly/ai-tools";
import { getConfig } from "@/lib/tauri";
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

const MAX_SUMMARY = 2_000;

function openProject(): string {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) throw new Error("Open a project first.");
  return projectId;
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
    const projectId = openProject();
    const config = await getConfig();
    const brief = defaultBrief(input.brief.goal ?? input.prompt);
    brief.successCriteria = input.brief.successCriteria ?? [];
    brief.reviewPlanFirst = input.brief.reviewPlanFirst ?? false;
    brief.permissions.network = input.brief.network ?? config.research_command_network ?? false;
    brief.budget.wallClockMinutes =
      input.brief.timeBudgetMinutes ?? config.research_time_budget_minutes ?? brief.budget.wallClockMinutes;
    let task = await createResearchTask({
      projectId,
      title: input.title,
      prompt: input.prompt,
      runtimeId: "builtin",
      agentId: config.ai_provider || "openai",
      modelId: config.ai_model || "",
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

export function createResearchAiTools(opts?: { confirm?: ConfirmFn }) {
  return { ...createResearchTools(HOST, opts), ...createResearchTaskTools(HOST, opts) };
}

/** The research task tools alone (the app's MCP server offers these). */
export function createResearchTaskAiTools(opts?: { confirm?: ConfirmFn }) {
  return createResearchTaskTools(HOST, opts);
}
