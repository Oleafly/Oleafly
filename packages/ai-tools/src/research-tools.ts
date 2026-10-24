import { registerConnector } from "./connectors";
import type { ConfirmFn, ToolApprovalRequest } from "./tools";

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
export const LITERATURE_SOURCES = [
  "openalex",
  "semantic-scholar",
  "crossref",
  "pubmed",
  "arxiv",
  "google-scholar",
  "alphaxiv",
] as const;

export interface ResearchToolsHost {
  /**
   * Searches the scholarly indexes at once (all default ones when `sources`
   * is empty) and returns `{ records, failures }`.
   */
  searchLiterature(query: string, opts: { limit: number; sources?: string[] }): Promise<unknown>;
  /** Checks a DOI (and title) or a title against Crossref; returns the verdict as is. */
  verifyCitation(input: { doi?: string; title?: string }): Promise<unknown>;
  retrieveProjectChunks(
    query: string,
    opts?: { topK?: number },
  ): Promise<Array<{ path: string; startLine: number; endLine: number; text: string; score: number }>>;
}

registerConnector({
  id: "openalex",
  name: "Scholarly indexes",
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
        "Search the scholarly indexes at once by natural-language query: OpenAlex, Semantic Scholar, Crossref, arXiv and PubMed, plus alphaXiv when it is connected. The same paper found in several indexes is merged by DOI, arXiv id and title. Returns records (title, authors, year, venue, DOI, arXiv id, abstract, citation count, open access, the indexes that found it) and failures for indexes that did not answer. Keys saved in Settings raise rate limits. Use for literature discovery.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query" },
          limit: { type: "number", description: "Max results per index (default 10, capped at 25)" },
          sources: {
            type: "array",
            items: { type: "string", enum: [...LITERATURE_SOURCES] },
            description: "Search only these indexes. Leave out to search the default ones.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = String((input.query as string | undefined) ?? "");
        if (!query.trim()) return { error: "query must not be empty" };
        const limit = Math.min(Math.max(1, Math.floor(Number(input.limit) || 10)), 25);
        const sources = Array.isArray(input.sources)
          ? input.sources.filter(
              (source): source is string =>
                typeof source === "string" && (LITERATURE_SOURCES as readonly string[]).includes(source),
            )
          : [];
        if (
          confirm &&
          !(await confirm({
            tool: "literature_search",
            summary: `Search scholarly indexes for ${query}`,
          }))
        ) {
          return declined("literature_search");
        }
        try {
          return await host.searchLiterature(query, sources.length > 0 ? { limit, sources } : { limit });
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e) };
        }
      },
    },

    verify_citation: {
      description:
        "Verify a citation is real before it is inserted anywhere. Given a DOI, resolves it to BibTeX and checks that its record carries the title, when one is given. Given only a title, searches Crossref and reports whether a record with that title exists, with the closest candidate when none matches. Never fabricate a citation the agent cannot verify with this tool.",
      inputSchema: {
        type: "object",
        properties: {
          doi: { type: "string", description: "DOI, if known (fastest, most reliable path)" },
          title: { type: "string", description: "Paper title. With a DOI it is checked against the DOI's record." },
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
          return await host.verifyCitation({ ...(doi ? { doi } : {}), ...(title ? { title } : {}) });
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

/** What an agent may set when it creates a research task. */
export interface ResearchTaskRequest {
  title: string;
  prompt: string;
  skillIds: string[];
  brief: {
    goal?: string;
    successCriteria?: string[];
    reviewPlanFirst?: boolean;
    network?: boolean;
    timeBudgetMinutes?: number;
  };
  start: boolean;
}

/** What the user sees before an agent creates a research task: all that it can do on its own. */
export interface ResearchTaskApprovalDetails {
  title: string;
  /** The whole prompt, as the task will get it. */
  prompt: string;
  goal: string | null;
  skills: string[];
  /** A task an agent creates asks before each command it runs. */
  commands: "ask";
  /** Network access for its commands; off unless the agent asked for it. */
  network: boolean;
  reviewPlanFirst: boolean;
  timeBudgetMinutes: number | null;
  start: boolean;
}

/** The prompt as far as a one-line summary shows it. */
const SUMMARY_PROMPT_CHARS = 1_500;

export function researchTaskSummary(details: ResearchTaskApprovalDetails): string {
  const { title, prompt, start, network } = details;
  const shown = prompt.length > SUMMARY_PROMPT_CHARS ? `${prompt.slice(0, SUMMARY_PROMPT_CHARS)}…` : prompt;
  return [
    `Create the research task "${title}"${start ? " and start it" : ""}.`,
    `It works on its own in a copy of the project. Each command it runs asks first; network access is ${network ? "on" : "off"}.`,
    `Prompt:\n${shown}`,
  ].join("\n");
}

export interface ResearchTaskToolsHost {
  createResearchTask(input: ResearchTaskRequest): Promise<{ id: string; title: string; status: string }>;
  /** One task, or the latest ten when `id` is left out. */
  researchTaskStatus(id?: string): Promise<unknown>;
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return "must be a list of strings";
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  if (items.length !== value.length) return "must be a list of strings";
  if (items.length > maxItems) return `can hold at most ${maxItems} items`;
  if (items.some((item) => item.length > maxLength)) return `items can be up to ${maxLength} characters`;
  return items.filter(Boolean);
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validBudgetMinutes(minutes: unknown): boolean {
  return typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 5 && minutes <= 1_440;
}

interface ParsedResearchTask {
  title: string;
  prompt: string;
  skills: string[];
  criteria: string[];
  minutes: number | null;
  start: boolean;
}

/** Checks what the agent passed; returns the parsed task or a message for the agent. */
function parseResearchTaskInput(input: Record<string, unknown>): ParsedResearchTask | { error: string } {
  const title = trimmedString(input.title);
  const prompt = trimmedString(input.prompt);
  if (!title || title.length > 160) return { error: "title must be 1 to 160 characters" };
  if (!prompt || prompt.length > 32_000) return { error: "prompt must be 1 to 32,000 characters" };
  const skills = stringList(input.skills, 32, 120);
  if (typeof skills === "string") return { error: `skills ${skills}` };
  const criteria = stringList(input.success_criteria, 12, 500);
  if (typeof criteria === "string") return { error: `success_criteria ${criteria}` };
  const minutes = input.time_budget_minutes;
  if (minutes !== undefined && !validBudgetMinutes(minutes)) {
    return { error: "time_budget_minutes must be a whole number from 5 to 1440" };
  }
  return {
    title,
    prompt,
    skills,
    criteria,
    minutes: typeof minutes === "number" ? minutes : null,
    start: input.start !== false,
  };
}

/** The goal as the approval card shows it; `null` when it is missing or blank. */
function approvalGoal(goal: unknown): string | null {
  const trimmed = trimmedString(goal);
  return trimmed ? trimmed.slice(0, 2_000) : null;
}

/** The brief the agent set, leaving out what it did not pass. */
function researchTaskBrief(
  input: Record<string, unknown>,
  criteria: string[],
  minutes: number | null,
): ResearchTaskRequest["brief"] {
  return {
    ...(typeof input.goal === "string" ? { goal: input.goal.trim().slice(0, 2_000) } : {}),
    ...(criteria.length > 0 ? { successCriteria: criteria } : {}),
    ...(typeof input.review_plan_first === "boolean" ? { reviewPlanFirst: input.review_plan_first } : {}),
    ...(typeof input.network === "boolean" ? { network: input.network } : {}),
    ...(minutes === null ? {} : { timeBudgetMinutes: minutes }),
  };
}

/** Tools that let an agent queue and check research tasks in the open project. */
export function createResearchTaskTools(
  host: ResearchTaskToolsHost,
  opts?: { confirm?: ConfirmFn },
): Record<string, { description: string; inputSchema: RawSchema; execute: RawToolDef["execute"] }> {
  const confirm = opts?.confirm;
  return {
    research_task_create: {
      description:
        "Create a research task in the open project: an agent that works on its own in an isolated copy of the project, within a time budget, and leaves its changes for the user to review. Use for longer work the user asks to run in the background, such as a literature sweep, an analysis or a series of experiments. The user approves the task before it is created.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short task title (up to 160 characters)" },
          prompt: { type: "string", description: "What the task should do, in full" },
          skills: { type: "array", items: { type: "string" }, description: "Skill ids to give the task" },
          goal: { type: "string", description: "What the task should find out or produce" },
          success_criteria: {
            type: "array",
            items: { type: "string" },
            description: "Checkable criteria, one per item",
          },
          review_plan_first: {
            type: "boolean",
            description: "Write plan.md and wait for the user's approval before working",
          },
          network: { type: "boolean", description: "Allow network access for the task's commands" },
          time_budget_minutes: { type: "number", description: "Active time budget, 5 to 1440 minutes" },
          start: { type: "boolean", description: "Start the task now (default true)" },
        },
        required: ["title", "prompt"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const parsed = parseResearchTaskInput(input);
        if ("error" in parsed) return parsed;
        const { title, prompt, skills, criteria, minutes, start } = parsed;
        if (confirm) {
          // The user approves what the task may do, not only its name: the whole prompt,
          // that its commands ask first, and whether they reach the network.
          const details: ResearchTaskApprovalDetails = {
            title,
            prompt,
            goal: approvalGoal(input.goal),
            skills,
            commands: "ask",
            network: input.network === true,
            reviewPlanFirst: input.review_plan_first === true,
            timeBudgetMinutes: minutes,
            start,
          };
          const request: ToolApprovalRequest & { researchTask: ResearchTaskApprovalDetails } = {
            tool: "research_task_create",
            summary: researchTaskSummary(details),
            researchTask: details,
          };
          if (!(await confirm(request))) {
            return { message: "The user declined.", declined: true, status: "declined", tool: "research_task_create" };
          }
        }
        try {
          return await host.createResearchTask({
            title,
            prompt,
            skillIds: skills,
            brief: researchTaskBrief(input, criteria, minutes),
            start,
          });
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e) };
        }
      },
    },

    research_task_status: {
      description:
        "Report on research tasks in the open project: status, current phase, budget used, requests waiting for the user, the result summary and the number of changed files. Give an id for one task, or leave it out for the latest ten.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task id" },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (input) => {
        const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : undefined;
        try {
          return await host.researchTaskStatus(id);
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e) };
        }
      },
    },
  };
}
