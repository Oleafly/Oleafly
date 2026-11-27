import { createOverleafTools, type OverleafToolsHost } from "@oleafly/ai-tools";
import { describeError } from "@/lib/app-error";

const loadHost = () => import("@/features/collab/live/overleaf-ai-host");

const HOST: OverleafToolsHost = {
  listProjects: async () => (await loadHost()).listProjects(),
  importProjects: async (ids) => (await loadHost()).importProjects(ids),
  findLive: async (id) => (await loadHost()).findLive(id),
  openLive: async (target, shouldContinue) => (await loadHost()).openLive(target, shouldContinue),
  describeError,
};

export function createOverleafAiTools(opts?: Parameters<typeof createOverleafTools>[1]) {
  return createOverleafTools(HOST, opts);
}
