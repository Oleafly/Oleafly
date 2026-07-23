import { jsonSchema } from "ai";
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
  crossrefSearch(query: string): Promise<string>;
  fetchDoiBibtex(doi: string): Promise<string>;
  retrieveProjectChunks(
    query: string,
    opts?: { topK?: number },
  ): Promise<Array<{ path: string; startLine: number; endLine: number; text: string; score: number }>>;
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

registerConnector({
  id: "openalex",
  name: "OpenAlex / Crossref",
  capability: "read",
  auth: "none",
  toolNames: ["literature_search", "verify_citation"],
});

registerConnector({
  id: "project-library",
  name: "This project's files",
  capability: "read",
  auth: "none",
  toolNames: ["project_library_search"],
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

export function createResearchTools(host: ResearchToolsHost): Record<
  string,
  { description: string; inputSchema: ReturnType<typeof jsonSchema>; execute: RawToolDef["execute"] }
> {
  const tools: Record<string, RawToolDef> = {
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

    literature_search: {
      description:
        "Search OpenAlex's scholarly-works index by natural-language query. Keyless and free; results include titles, authors, publication year, and OpenAlex/DOI ids. Use for general literature discovery.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query" },
          limit: { type: "number", description: "Max results (default 10, capped at 25)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = String(input.query ?? "");
        if (!query.trim()) return { error: "query must not be empty" };
        const limit = Math.min(Math.max(1, Math.floor(Number(input.limit) || 10)), 25);
        try {
          return await host.fetchJson(
            `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`,
          );
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e) };
        }
      },
    },

    verify_citation: {
      description:
        "Verify a citation is real before it is inserted anywhere. Given a DOI, resolves it directly to BibTeX. Given only a title, searches Crossref and reports whether a matching real record was found. Never fabricate a citation the agent cannot verify with this tool.",
      inputSchema: {
        type: "object",
        properties: {
          doi: { type: "string", description: "DOI, if known (fastest, most reliable path)" },
          title: { type: "string", description: "Paper title, used only if doi is not provided" },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (input) => {
        const doi = typeof input.doi === "string" ? input.doi.trim() : "";
        const title = typeof input.title === "string" ? input.title.trim() : "";
        if (!doi && !title) return { error: "Provide either doi or title." };
        try {
          if (doi) {
            const bibtex = await host.fetchDoiBibtex(doi);
            return { verified: true, source: "crossref-doi", doi, bibtex };
          }
          const raw = await host.crossrefSearch(title);
          const parsed = JSON.parse(raw) as { items?: Array<{ title?: string[]; DOI?: string }> };
          const match = parsed.items?.[0];
          if (!match) return { verified: false, reason: "No matching Crossref record found." };
          return {
            verified: true,
            source: "crossref-search",
            doi: match.DOI ?? null,
            matchedTitle: match.title?.[0] ?? null,
          };
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e) };
        }
      },
    },

    project_library_search: {
      description:
        "Search the currently open project's own files (sections, notes, .bib entries) by keyword. This is local and instant, unlike the other research tools which reach external services. Prefer this first when the user asks about something they may have already written or imported.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = String(input.query ?? "");
        if (!query.trim()) return { error: "query must not be empty" };
        try {
          const chunks = await host.retrieveProjectChunks(query, { topK: 5 });
          return { chunks };
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e) };
        }
      },
    },
  };

  const wrapped: Record<
    string,
    { description: string; inputSchema: ReturnType<typeof jsonSchema>; execute: RawToolDef["execute"] }
  > = {};
  for (const [name, def] of Object.entries(tools)) {
    wrapped[name] = { description: def.description, inputSchema: jsonSchema(def.inputSchema), execute: def.execute };
  }
  return wrapped;
}
