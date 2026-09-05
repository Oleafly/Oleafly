import { getConfig } from "@/lib/tauri";
import { createResearchTask, listResearchTasks } from "@/lib/research-tasks";

const pending = new Map<string, Promise<void>>();

export function ensureResearchStarterTask({ projectId, title, prompt }: {
  projectId: string;
  title: string;
  prompt: string;
  starter: string;
}): Promise<void> {
  const existing = pending.get(projectId);
  if (existing) return existing;
  const work = (async () => {
    const tasks = await listResearchTasks(projectId);
    if (tasks.some((task) => task.title === title && task.prompt === prompt)) return;
    const config = await getConfig();
    await createResearchTask({
      projectId,
      title,
      prompt,
      runtimeId: "builtin",
      agentId: config.ai_provider || "openai",
      modelId: config.ai_model || "",
      skillIds: [],
      dependencyIds: [],
    });
  })();
  pending.set(projectId, work);
  void work.finally(() => {
    if (pending.get(projectId) === work) pending.delete(projectId);
  }).catch(() => {});
  return work;
}
