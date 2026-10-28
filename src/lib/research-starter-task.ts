import { currentLocale } from "@/i18n";
import { pickActiveProvider, suggestedProviderId } from "@/lib/ai-providers";
import { getConfig } from "@/lib/tauri";
import { createResearchTask, defaultBrief, listResearchTasks } from "@/lib/research-tasks";

const pending = new Map<string, Promise<void>>();

export function ensureResearchStarterTask({ projectId, title, prompt }: {
  projectId: string;
  title: string;
  prompt: string;
}): Promise<void> {
  const existing = pending.get(projectId);
  if (existing) return existing;
  const work = (async () => {
    const tasks = await listResearchTasks(projectId);
    if (tasks.some((task) => task.title === title && task.prompt === prompt)) return;
    const config = await getConfig();
    const { providerId, modelId } = pickActiveProvider(config, suggestedProviderId(currentLocale()));
    await createResearchTask({
      projectId,
      title,
      prompt,
      runtimeId: "builtin",
      agentId: providerId,
      modelId,
      skillIds: [],
      dependencyIds: [],
      brief: (() => {
        const brief = defaultBrief(prompt);
        brief.permissions.network = config.research_command_network ?? false;
        brief.budget.wallClockMinutes = config.research_time_budget_minutes ?? brief.budget.wallClockMinutes;
        return brief;
      })(),
    });
  })();
  pending.set(projectId, work);
  void work.finally(() => {
    if (pending.get(projectId) === work) pending.delete(projectId);
  }).catch(() => {});
  return work;
}
