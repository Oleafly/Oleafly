import { registerConnector } from "./connectors";
import type { ConfirmFn } from "./tools";

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
  searchOpenAlex(query: string, limit: number): Promise<unknown>;
  crossrefSearch(query: string): Promise<string>;
  fetchDoiBibtex(doi: string): Promise<string>;
  retrieveProjectChunks(
    query: string,
    opts?: { topK?: number },
  ): Promise<Array<{ path: string; startLine: number; endLine: number; text: string; score: number }>>;
}

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

export function createResearchTools(
  host: ResearchToolsHost,
  opts?: { confirm?: ConfirmFn },
): Record<string, { description: string; inputSchema: RawSchema; execute: RawToolDef["execute"] }> {
  const declined = (tool: string) => ({
    message: "The user declined internet access.",
    declined: true as const,
    status: "declined" as const,
    tool,
  });
  const confirm = opts?.confirm;
  const tools: Record<string, RawToolDef> = {
    literature_search: {
      description:
        "Search OpenAlex's scholarly-works index by natural-language query, using the OpenAlex API key and contact email saved in Settings when there are any. Results include titles, authors, publication year, and OpenAlex or DOI ids. Use for general literature discovery.",
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
        const query = String((input.query as string | undefined) ?? "");
        if (!query.trim()) return { error: "query must not be empty" };
        const limit = Math.min(Math.max(1, Math.floor(Number(input.limit) || 10)), 25);
        if (
          confirm &&
          !(await confirm({
            tool: "literature_search",
            summary: `Search OpenAlex for ${query}`,
          }))
        ) {
          return declined("literature_search");
        }
        try {
          return await host.searchOpenAlex(query, limit);
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
        if (
          confirm &&
          !(await confirm({
            tool: "verify_citation",
            summary: "Verify citation with Crossref",
          }))
        ) {
          return declined("verify_citation");
        }
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
        const query = String((input.query as string | undefined) ?? "");
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

  return tools;
}
