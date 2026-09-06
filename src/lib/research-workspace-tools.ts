import type { ToolSet } from "@/lib/chat-types";
import { getResearchWorkspace, listResearchRootFiles, readResearchRootFile } from "@/lib/research-workspace";

function field(input: unknown, key: string): string {
  if (!input || typeof input !== "object") return "";
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function createResearchWorkspaceTools(projectId: string | null): ToolSet {
  if (!projectId) return {};
  return {
    list_research_roots: {
      description: "List the research folders linked to this project. Use their stable root IDs to read reference, data, or analysis files.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const workspace = await getResearchWorkspace(projectId);
        return workspace.roots.map(({ id, label, role }) => ({ rootId: id, label, role, access: "read_only" }));
      },
    },
    list_research_root_files: {
      description: "List files in a linked research folder using its root ID. Returns a bounded listing. Linked source files are read-only to the assistant.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["rootId"],
        properties: { rootId: { type: "string" }, path: { type: "string", description: "Relative directory inside the linked folder; empty for its root." } },
      },
      execute: (input: unknown) => listResearchRootFiles(projectId, field(input, "rootId"), field(input, "path"), 3),
    },
    read_research_root_file: {
      description: "Read a text file inside a linked research folder using its root ID and relative path. Binary and oversized files are reported explicitly.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["rootId", "path"],
        properties: { rootId: { type: "string" }, path: { type: "string" } },
      },
      execute: (input: unknown) => readResearchRootFile(projectId, field(input, "rootId"), field(input, "path"), 128 * 1024),
    },
  };
}
