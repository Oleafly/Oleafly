import {
  createResearchTools,
  type ConfirmFn,
  type ResearchToolsHost,
} from "@oleafly/ai-tools";
import { crossrefSearch, fetchDoiBibtex, literatureSearch } from "@/lib/tauri";
import { retrieveProjectChunks } from "@/lib/ai-rag";

const HOST: ResearchToolsHost = {
  searchOpenAlex: async (query, limit) =>
    JSON.parse(await literatureSearch("openalex", query, { limit })) as unknown,
  crossrefSearch,
  fetchDoiBibtex,
  retrieveProjectChunks,
};

export function createResearchAiTools(opts?: { confirm?: ConfirmFn }) {
  return createResearchTools(HOST, opts);
}
