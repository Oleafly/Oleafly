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

export interface OverleafToolProject {
  id: string;
  name: string;
  ownerName: string | null;
  owned: boolean;
  lastUpdated: string | null;
  archived: boolean;
  importedAs: string | null;
}

export interface OverleafToolOutcome {
  remoteId: string;
  projectId: string | null;
  error: string | null;
}

export interface OverleafToolsHost {
  listProjects(): Promise<{ email: string | null; server: string; projects: OverleafToolProject[] }>;
  importProjects(ids: string[]): Promise<OverleafToolOutcome[]>;
  describeError(error: unknown): string;
}

const MAX_LISTED = 200;
const MAX_IMPORTED = 25;

export function createOverleafTools(
  host: OverleafToolsHost,
  opts?: { confirm?: ConfirmFn },
): Record<string, RawToolDef> {
  const confirm = opts?.confirm;
  return {
    list_overleaf_projects: {
      description:
        "List the projects in the user's Overleaf account, newest first, with each project's id, name, owner, last edit time and whether it is already imported into Oleafly. Opens Overleaf's sign-in window first when the user is not signed in. Use it before import_overleaf_projects to find the ids of the projects the user names.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional words to match against project names and owners",
          },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = typeof input.query === "string" ? input.query.trim().toLocaleLowerCase() : "";
        try {
          const listed = await host.listProjects();
          const matches = listed.projects.filter((project) =>
            !query || `${project.name} ${project.ownerName ?? ""}`.toLocaleLowerCase().includes(query),
          );
          return {
            server: listed.server,
            account: listed.email,
            total: matches.length,
            projects: matches.slice(0, MAX_LISTED).map((project) => ({
              id: project.id,
              name: project.name,
              owner: project.owned ? "you" : project.ownerName,
              lastUpdated: project.lastUpdated,
              archived: project.archived,
              importedAs: project.importedAs,
            })),
            truncated: matches.length > MAX_LISTED,
          };
        } catch (error) {
          return { error: host.describeError(error) };
        }
      },
    },

    import_overleaf_projects: {
      description:
        "Import projects from the user's Overleaf account into the Oleafly library. Each project keeps its files, compiler and main file, and compiles locally afterwards with no link back to Overleaf. Comments, tracked changes, chat and history are not carried over. Pass the ids from list_overleaf_projects. A project that is already imported comes in again as a new copy.",
      inputSchema: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: `Overleaf project ids to import (at most ${MAX_IMPORTED})`,
          },
        },
        required: ["ids"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const ids = Array.isArray(input.ids)
          ? [...new Set(input.ids.filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim()))]
          : [];
        if (ids.length === 0) return { error: "Provide at least one Overleaf project id." };
        if (ids.length > MAX_IMPORTED) return { error: `Import at most ${MAX_IMPORTED} projects at a time.` };
        if (
          confirm &&
          !(await confirm({
            tool: "import_overleaf_projects",
            summary: ids.length === 1 ? "Import 1 project from Overleaf" : `Import ${ids.length} projects from Overleaf`,
          }))
        ) {
          return { declined: true, status: "declined", message: "The user declined the import." };
        }
        try {
          const outcomes = await host.importProjects(ids);
          return {
            success: outcomes.every((outcome) => outcome.projectId !== null),
            imported: outcomes
              .filter((outcome) => outcome.projectId)
              .map((outcome) => ({ overleafId: outcome.remoteId, projectId: outcome.projectId })),
            failed: outcomes
              .filter((outcome) => !outcome.projectId)
              .map((outcome) => ({ overleafId: outcome.remoteId, error: host.describeError(outcome.error) })),
          };
        } catch (error) {
          return { error: host.describeError(error) };
        }
      },
    },
  };
}
