import type { ModelSelectorGroup } from "@/components/ai/ModelSelector";
import { AGENT_DEFAULT_MODEL } from "@/features/tools-ai/tools-choice";
import { i18n } from "@/i18n";
import { acpUsable, type AcpAgentStatus } from "@/lib/acp";
import { streamViaBackend } from "@/lib/agent-backend";
import { configuredModelGroups } from "@/lib/ai-model-groups";
import { CLI_AGENT_PREFIX, withCliAgentErrors } from "@/lib/ai-route";
import type { AppConfig } from "@/lib/tauri";
import type { NoteEdit } from "./note-edits";
import type { CitationItem, EditRequest, NoteAgentChoice, ResearchActionId } from "./types";

export type { NoteAgentChoice } from "./types";

export const NOTE_AGENT_STORAGE_KEY = "oleafly.notes.agent";

export function readSavedAgent(): { providerId: string; modelId: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(NOTE_AGENT_STORAGE_KEY) ?? "null") as unknown;
    if (typeof saved !== "object" || saved === null) return null;
    const { providerId, modelId } = saved as Record<string, unknown>;
    return typeof providerId === "string" && typeof modelId === "string" ? { providerId, modelId } : null;
  } catch {
    return null;
  }
}

export function saveAgent(choice: NoteAgentChoice): void {
  try {
    localStorage.setItem(NOTE_AGENT_STORAGE_KEY, JSON.stringify({ providerId: choice.providerId, modelId: choice.modelId }));
  } catch {
    return;
  }
}

const FIND = "<<<<<<< FIND";
const SPLIT = "=======";
const REPLACE = ">>>>>>> REPLACE";
const NO_CHANGES = "NO CHANGES";

export const NOTE_AGENT_SYSTEM = `You edit a researcher's Markdown note. The note has YAML front matter, $...$ and $$...$$ math, citations like [@key], and fenced blocks: \`\`\`mermaid diagrams, \`\`\`chart blocks holding JSON data (title, description, unit, categories, series with name and values, note), and raw \`\`\`{=latex} and \`\`\`{=typst} blocks.

Reply with edit blocks only, in exactly this format:

${FIND}
text copied exactly from the note
${SPLIT}
the text that replaces it
${REPLACE}

Rules:
- FIND must match the note exactly, character for character, and appear only once in it. Include enough nearby words to make it unique.
- Keep each edit small. Never rewrite text you weren't asked to change.
- To add a paragraph, FIND the paragraph it follows and REPLACE it with that paragraph, a blank line, and the new paragraph.
- To add something at the end of the note, leave FIND empty.
- Keep Markdown, math, citations and fenced blocks valid. Don't edit the front matter.
- Don't invent results, numbers or citations that the note doesn't support.
- If nothing should change, reply with exactly: ${NO_CHANGES}`;

const ACTION_TASKS: Readonly<Record<ResearchActionId, string>> = {
  latestRun:
    "Update the note with the results of the latest research task below. Use only the numbers and facts it reports, and say which task they came from.",
  claims: "Check the note's claims against the code and correct the ones that are wrong.",
  citations:
    "Find statements that need a source. Add [@key] citations where one of the available references supports the statement. For statements with no matching reference, add a section named Citations to find at the end of the note with one bullet per statement and the search terms you would use.",
  proofread: "Fix spelling, grammar and punctuation. Don't change the meaning or the style.",
  rewrite: "Rewrite for clarity and flow. Keep the meaning, every fact and every number.",
  shorter: "Make the text shorter. Keep every fact, number and citation.",
  paragraph: "Write one new paragraph where it fits best, in the note's voice, using only what the note already says.",
  table: "Add a Markdown comparison table where it helps, built only from facts already in the note.",
  figure:
    "Add one figure that explains something in the note: a mermaid diagram for a process or structure, or a chart block with JSON data for numbers already in the note.",
  abstract:
    "Add a section named Summary at the start of the note, after the front matter, with three to five sentences that could open a paper abstract. Use only what the note says.",
};

const WITHOUT_RUN: ReadonlySet<ResearchActionId> = new Set(["latestRun", "claims"]);
const WITH_RUN: ReadonlySet<ResearchActionId> = new Set(["claims"]);

export function hiddenActions(hasLatestRun: boolean): ReadonlySet<ResearchActionId> {
  return hasLatestRun ? WITH_RUN : WITHOUT_RUN;
}

function citationList(citations: readonly CitationItem[]): string {
  if (citations.length === 0) return "There are no references in this project yet.";
  return citations.map((citation) => `- [@${citation.key}] ${citation.label}`).join("\n");
}

export function notePrompt(request: EditRequest, citations: readonly CitationItem[] = []): string {
  const parts: string[] = [];
  if (request.actionId) parts.push(`Task: ${ACTION_TASKS[request.actionId]}`);
  if (request.prompt) parts.push(`Request: ${request.prompt}`);
  if (request.actionId === "citations") parts.push(`Available references:\n${citationList(citations)}`);
  if (request.actionId === "latestRun" && request.latestRun) {
    parts.push(`The latest research task:\n<run>\n${request.latestRun}\n</run>`);
  }
  if (request.quote) parts.push(`Only change this part of the note:\n<selection>\n${request.quote}\n</selection>`);
  parts.push(`The note:\n<note>\n${request.source}\n</note>`);
  return parts.join("\n\n");
}

export function parseNoteEdits(text: string): { edits: NoteEdit[]; noChanges: boolean } {
  const edits: NoteEdit[] = [];
  let state: "outside" | "find" | "replace" = "outside";
  let find: string[] = [];
  let replace: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const marker = line.trim();
    if (state === "outside") {
      if (marker === FIND) {
        state = "find";
        find = [];
        replace = [];
      }
      continue;
    }
    if (state === "find") {
      if (marker === SPLIT) state = "replace";
      else find.push(line);
      continue;
    }
    if (marker === REPLACE) {
      const edit = { find: find.join("\n"), replace: replace.join("\n") };
      if (edit.find !== edit.replace) edits.push(edit);
      state = "outside";
    } else {
      replace.push(line);
    }
  }
  return { edits, noChanges: edits.length === 0 && text.includes(NO_CHANGES) };
}

export function noteAgentGroups(cfg: AppConfig, agents: readonly AcpAgentStatus[]): ModelSelectorGroup[] {
  const hosted = configuredModelGroups({
    keys: cfg.ai_keys ?? {},
    customProviders: cfg.ai_custom_providers ?? [],
    providerModels: cfg.ai_provider_models ?? {},
  });
  const cli = agents
    .filter((agent) => acpUsable(agent) && agent.runtime?.readOnly !== false)
    .map((agent) => {
      const offered = (agent.runtime?.models ?? []).map((model) => ({ id: model.modelId, name: model.name }));
      const models = offered.some((model) => model.id === AGENT_DEFAULT_MODEL)
        ? offered
        : [
            { id: AGENT_DEFAULT_MODEL, name: i18n.t(($) => $.researchTools.converterModel.agentDefaultModel) },
            ...offered,
          ];
      return { id: `${CLI_AGENT_PREFIX}${agent.definition.id}`, name: agent.definition.name, models };
    });
  return [...hosted, ...cli];
}

export function choiceIn(
  groups: readonly ModelSelectorGroup[],
  providerId: string,
  modelId: string,
): NoteAgentChoice | null {
  const group = groups.find((candidate) => candidate.id === providerId);
  const model = group?.models.find((candidate) => candidate.id === modelId);
  if (!group || !model) return null;
  const label = providerId.startsWith(CLI_AGENT_PREFIX) ? group.name : model.name;
  return { providerId, modelId, label };
}

export function defaultChoice(
  groups: readonly ModelSelectorGroup[],
  saved: { providerId: string; modelId: string } | null,
  preferred: { providerId: string; modelId: string } | null,
): NoteAgentChoice | null {
  for (const candidate of [saved, preferred]) {
    const choice = candidate && choiceIn(groups, candidate.providerId, candidate.modelId);
    if (choice) return choice;
  }
  const first = groups.find((group) => group.models.length > 0);
  return first ? choiceIn(groups, first.id, first.models[0].id) : null;
}

export async function runNoteAgent(
  choice: NoteAgentChoice,
  request: EditRequest,
  signal: AbortSignal,
  citations: readonly CitationItem[] = [],
): Promise<NoteEdit[]> {
  let text = "";
  const route = choice.providerId.startsWith(CLI_AGENT_PREFIX)
    ? { provider_id: choice.providerId, model_id: choice.modelId, agent: choice.label }
    : null;
  await withCliAgentErrors(route, () =>
    streamViaBackend(
      {
        system: NOTE_AGENT_SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: notePrompt(request, citations) }] }],
        temperature: 0.2,
      },
      (event) => {
        if (event.kind === "textDelta") text += event.text;
      },
      signal,
      { provider_id: choice.providerId, model_id: choice.modelId },
    ),
  );
  return parseNoteEdits(text).edits;
}
