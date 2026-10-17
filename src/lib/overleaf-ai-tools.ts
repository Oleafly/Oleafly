import { createOverleafTools, type ConfirmFn, type OverleafToolsHost } from "@oleafly/ai-tools";
import { describeError } from "@/lib/app-error";

const loadHost = () => import("@/lib/overleaf-ai-host");

const HOST: OverleafToolsHost = {
  listProjects: async () => (await loadHost()).listProjects(),
  importProjects: async (ids) => (await loadHost()).importProjects(ids),
  describeError,
};

export function createOverleafAiTools(opts?: { confirm?: ConfirmFn }) {
  return createOverleafTools(HOST, opts);
}
