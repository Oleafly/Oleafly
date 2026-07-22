import { registerConnector } from "./connectors";

type RawSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
};

type RawToolDef = {
  description: string;
  inputSchema: RawSchema;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

// The app builds one adapter over its Tauri client; this package stays free
// of Tauri/store imports, matching the AiToolsHost split in tools.ts.
export interface ResearchToolsHost {
  getConnectorKey(connectorId: string): Promise<string | null>;
  fetchJson(url: string, init?: { headers?: Record<string, string> }): Promise<unknown>;
}

const ALPHAXIV_API_BASE = "https://api.alphaxiv.org/mcp/v1";

registerConnector({
  id: "alphaxiv",
  name: "alphaXiv",
  capability: "read",
  auth: "api-key",
  docsUrl: "https://www.alphaxiv.org/assistant",
  toolNames: ["alphaxiv_search", "alphaxiv_paper_content"],
});

async function requireKey(
  host: ResearchToolsHost,
  connectorId: string,
  displayName: string,
): Promise<string | { error: string }> {
  const key = await host.getConnectorKey(connectorId);
  if (!key) {
    return { error: `Connect ${displayName} in Settings before using this tool.` };
  }
  return key;
}

export function createResearchTools(host: ResearchToolsHost): Record<string, RawToolDef> {
  return {
    alphaxiv_search: {
      description:
        "Search alphaXiv's paper index by natural-language query. Returns paper ids, titles, and short summaries. Use this to find literature relevant to a topic.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const keyOrError = await requireKey(host, "alphaxiv", "alphaXiv");
        if (typeof keyOrError !== "string") return keyOrError;
        const query = String(input.query ?? "");
        if (!query.trim()) return { error: "query must not be empty" };
        try {
          return await host.fetchJson(
            `${ALPHAXIV_API_BASE}/search?q=${encodeURIComponent(query)}`,
            { headers: { Authorization: `Bearer ${keyOrError}` } },
          );
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e) };
        }
      },
    },

    alphaxiv_paper_content: {
      description:
        "Fetch the full text/content of a specific paper from alphaXiv by its paper id (as returned by alphaxiv_search).",
      inputSchema: {
        type: "object",
        properties: {
          paper_id: { type: "string", description: "alphaXiv/arXiv paper id, e.g. '2410.16464'" },
        },
        required: ["paper_id"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const paperId = input.paper_id;
        if (typeof paperId !== "string" || !paperId.trim()) {
          return { error: "paper_id is required" };
        }
        const keyOrError = await requireKey(host, "alphaxiv", "alphaXiv");
        if (typeof keyOrError !== "string") return keyOrError;
        try {
          return await host.fetchJson(
            `${ALPHAXIV_API_BASE}/papers/${encodeURIComponent(paperId)}`,
            { headers: { Authorization: `Bearer ${keyOrError}` } },
          );
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e) };
        }
      },
    },
  };
}
