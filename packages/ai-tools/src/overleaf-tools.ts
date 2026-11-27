import { declined, type ConfirmFn } from "./tools";

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

type OverleafLiveRefusalReason =
  | "switch_off"
  | "share_link"
  | "other_server"
  | "not_found"
  | "busy"
  | "not_linked"
  | "shared_on_server"
  | "cancelled"
  | "not_opened"
  | "project_changed"
  | "live_elsewhere"
  | "ended";

interface OverleafLiveRefusal {
  refused: OverleafLiveRefusalReason;
  detail?: string | null;
}

export interface OverleafLiveTarget {
  remoteId: string;
  name: string;
  importedAs: string | null;
  stops: string | null;
}

interface OverleafLiveOpened {
  projectId: string;
  status: string;
  role: string | null;
}

export interface OverleafToolsHost {
  listProjects(): Promise<{ email: string | null; server: string; projects: OverleafToolProject[] }>;
  importProjects(ids: string[]): Promise<OverleafToolOutcome[]>;
  findLive(id: string): Promise<OverleafLiveTarget | OverleafLiveRefusal>;
  openLive(target: OverleafLiveTarget, shouldContinue: () => boolean): Promise<OverleafLiveOpened | OverleafLiveRefusal>;
  describeError(error: unknown): string;
}

type OverleafToolName = "list_overleaf_projects" | "import_overleaf_projects" | "open_overleaf_live";

const MAX_LISTED = 200;
const MAX_IMPORTED = 25;
const MAX_LIVE_ID = 2048;

const REFUSALS: Readonly<Record<OverleafLiveRefusalReason, string>> = {
  switch_off:
    "Live editing with Overleaf is turned off. Ask the user to turn it on in Settings, under Experimentation, then try again.",
  share_link:
    "That is a share link, not a project address. Ask the user to paste it into the search field under Import from Overleaf in the Library and click Join first.",
  other_server: "That address is on a different Overleaf server from the one the user signed in to.",
  not_found: "That project isn't in the user's Overleaf account. Check the id or the address.",
  busy: "Oleafly is already importing or opening projects from Overleaf. Try again when that finishes.",
  not_linked: "The local copy of this project is no longer linked to Overleaf, so it can't go live.",
  shared_on_server: "This project is shared on an Oleafly Server, so it goes live there and not with Overleaf.",
  cancelled: "The request was cancelled before the project opened.",
  not_opened: "Oleafly didn't open the project. The Oleafly window shows why.",
  project_changed: "Another project was opened, or this one was closed, before live editing started.",
  live_elsewhere: "This project is already live in another Oleafly window or on the command line.",
  ended: "Live editing stopped before it connected.",
};

const STILL_CONNECTING =
  "The project is open, but live editing hasn't connected yet. It keeps trying in the background.";

function refusalResult({ refused, detail }: OverleafLiveRefusal) {
  return { error: detail ? `${REFUSALS[refused]} (${detail})` : REFUSALS[refused], code: refused };
}

function openLiveSummary(target: OverleafLiveTarget): string {
  const opening = `Open “${target.name}” from Overleaf with live editing`;
  return target.stops ? `${opening}. Live editing stops in “${target.stops}”.` : opening;
}

function openLiveIdSummary(id: string): string {
  return `Open the Overleaf project “${id}” with live editing. Live editing in any other project stops.`;
}

const OPEN_LIVE_ABOUT =
  "Open a project from the user's Overleaf account in Oleafly with live editing, so edits reach Overleaf as they are made and coauthors' edits arrive in the project folder. Pass the project's address as shown in the browser, or its id (list_overleaf_projects gives the ids, when that tool is available). A project with no local copy is imported first. Only one project is live at a time, so a project that is live now stops. Needs the Live editing with Overleaf switch in Settings, under Experimentation.";
const ENDS_CHAT_RUN = "Opening another project ends the current run, so make this the last call.";

export function createOverleafTools(
  host: OverleafToolsHost,
  opts?: { confirm?: ConfirmFn; mutationAllowed?: () => boolean; endsChatRun?: boolean; approveBeforeLookup?: boolean },
): Record<OverleafToolName, RawToolDef> {
  const confirm = opts?.confirm;
  const approveFirst = opts?.approveBeforeLookup === true;
  const shouldContinue = opts?.mutationAllowed ?? (() => true);
  const openLiveAbout = opts?.endsChatRun === false ? OPEN_LIVE_ABOUT : `${OPEN_LIVE_ABOUT} ${ENDS_CHAT_RUN}`;
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
          return declined("import_overleaf_projects", "The user declined the import.");
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

    open_overleaf_live: {
      description: openLiveAbout,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            maxLength: MAX_LIVE_ID,
            description: "The Overleaf project id, or the project's address",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const id = typeof input.id === "string" ? input.id.trim() : "";
        if (!id || id.length > MAX_LIVE_ID) return { error: "Provide the Overleaf project id or the project's address." };
        const approve = (summary: string) => !confirm || confirm({ tool: "open_overleaf_live", summary });
        const declinedOpen = () => declined("open_overleaf_live", "The user declined opening the project.");
        try {
          if (approveFirst && !(await approve(openLiveIdSummary(id)))) return declinedOpen();
          const target = await host.findLive(id);
          if ("refused" in target) return refusalResult(target);
          if (!approveFirst && !(await approve(openLiveSummary(target)))) return declinedOpen();
          if (!shouldContinue()) return refusalResult({ refused: "cancelled" });
          const opened = await host.openLive(target, shouldContinue);
          if ("refused" in opened) return refusalResult(opened);
          const result = { projectId: opened.projectId, status: opened.status, role: opened.role };
          return opened.status === "online" ? { success: true, ...result } : { ...result, message: STILL_CONNECTING };
        } catch (error) {
          return { error: host.describeError(error) };
        }
      },
    },
  };
}
