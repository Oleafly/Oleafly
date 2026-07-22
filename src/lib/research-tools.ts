import { createResearchTools, type ResearchToolsHost } from "@oleafly/ai-tools";
import { getConnectorKey, crossrefSearch, fetchDoiBibtex } from "@/lib/tauri";
import { retrieveProjectChunks } from "@/lib/ai-rag";

const HOST: ResearchToolsHost = {
  getConnectorKey,
  fetchJson: async (url, init) => {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`Request to ${new URL(url).host} returned HTTP ${res.status}`);
    return res.json();
  },
  crossrefSearch,
  fetchDoiBibtex,
  retrieveProjectChunks,
};

export function createResearchAiTools() {
  return createResearchTools(HOST);
}
