import type { AssistantScopePrompt } from "@/components/ai/assistant-scope";
import { noteBlockGuide } from "./block-guide";
import { noteLinkHref } from "./note-link-format";
import type { ResearchActionId } from "./types";
import { quoted, UNTRUSTED_RESULTS, untrustedBlock } from "./untrusted-data";

export interface NotePromptFacts {
  title: string;
  noteId: string;
  linkId: string | null;
  relatedProject: { id: string; name: string } | null;
}

export interface NotePassage {
  text: string;
  line: number | null;
}

export interface ResearchTaskContext {
  latestRun?: string | null;
  passage?: NotePassage | null;
}

const RESEARCH_TASKS: Readonly<Record<ResearchActionId, string>> = {
  latestRun:
    "Update the note with the results of the latest research task below. Use only the numbers and facts it reports, and say which task they came from.",
  claims:
    "Check every claim in the note against the linked project's code, data and paper. Read the files that back each claim, then propose corrections for the claims that are wrong and tell me which ones you could not verify.",
  citations:
    "Find statements in the note that need a source. Use only references that exist: search the linked project's bibliography and the literature, and verify each DOI. Add [@key] citations where a reference supports the statement. For statements with no source you could confirm, add a section named Citations to find at the end with one bullet per statement and the search terms you would use.",
  proofread: "Proofread the note. Fix spelling, grammar and punctuation without changing the meaning or the style.",
  rewrite: "Rewrite the note for clarity and flow. Keep the meaning, every fact and every number.",
  shorter: "Make the note shorter. Keep every fact, number and citation.",
  paragraph: "Write one new paragraph where it fits best, in the note's voice, using only what the note and my other notes already say.",
  table: "Add a comparison table where it helps, built only from facts already in the note.",
  figure:
    "Add one figure that explains something in the note: a mermaid diagram for a process or structure, or a chart block with data already in the note.",
  abstract:
    "Add a section named Summary at the start of the note, after the front matter, with three to five sentences that could open a paper abstract. Use only what the note says.",
};

type PassageAction = "proofread" | "rewrite";

const PASSAGE_TASKS: Readonly<Record<PassageAction, string>> = {
  proofread:
    "Proofread only the passage below. Fix spelling, grammar and punctuation without changing the meaning or the style, and leave the rest of the note as it is.",
  rewrite:
    "Rewrite only the passage below for clarity and flow. Keep its meaning, every fact and every number, and leave the rest of the note as it is.",
};

export function actsOnPassage(actionId: ResearchActionId): actionId is PassageAction {
  return actionId in PASSAGE_TASKS;
}

export function researchTask(actionId: ResearchActionId, context: ResearchTaskContext = {}): string {
  const { passage, latestRun } = context;
  if (actsOnPassage(actionId) && passage) {
    const where = passage.line === null ? "" : ` It starts on line ${passage.line} of the note.`;
    return `${PASSAGE_TASKS[actionId]}${where}\n\n${untrustedBlock("The selected passage", passage.text)}`;
  }
  const task = RESEARCH_TASKS[actionId];
  if (actionId !== "latestRun" || !latestRun) return task;
  return `${task}\n\n${untrustedBlock("The latest research task", latestRun)}`;
}

export function hiddenResearchActions(hasLatestRun: boolean, hasRelatedProject: boolean): ReadonlySet<ResearchActionId> {
  const hidden = new Set<ResearchActionId>();
  if (!hasLatestRun) hidden.add("latestRun");
  if (!hasRelatedProject) hidden.add("claims");
  return hidden;
}

function noteLine(facts: NotePromptFacts): string {
  const link = facts.linkId ? ` Link to it with ${noteLinkHref("note", facts.linkId)}.` : "";
  return `The open note is ${quoted(facts.title)} (id ${facts.noteId}).${link}`;
}

function projectLine(facts: NotePromptFacts): string {
  const project = facts.relatedProject;
  if (!project) {
    return "The note is not linked to a project. When the person wants you to read code or run a research task for it, say they can link the note to a project first.";
  }
  return `The note is linked to the project ${quoted(project.name)} (id ${project.id}). Read its paper, code and data with related_project_files, read_related_project_file and search_related_project, and run research tasks in it with research_task_create.`;
}

function toolLines(tools: ReadonlySet<string>): string {
  const canWrite = tools.has("write_file");
  return [
    `- Read the note with read_note before you change it. Change the note only with propose_note_edits: each edit replaces one exact passage, and the person reviews every change. If edits come back skipped, fix their find text and call it again in the same turn.${canWrite ? " Never use write_file or replace_in_file on note.md." : ""}`,
    tools.has("search_notes")
      ? "- Search the knowledge base with search_notes or list_knowledge_notes before writing something the person may already know, and reuse it with read_note_by_id."
      : null,
    tools.has("create_note") ? "- Use create_note when a result deserves its own note." : null,
    "- For multi-step work, keep a short plan with update_todos.",
    canWrite
      ? "- Files in the note's folder (assets, data, attachments) are yours to read and write with the file tools."
      : "- You can read the files beside the note with the file tools, but you cannot change them.",
    tools.has("run_command") ? "- run_command runs in that folder." : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function noteAssistantPrompt(facts: NotePromptFacts, input: AssistantScopePrompt): string {
  const tools = input.tools.length > 0 ? input.tools.join(", ") : "none";
  const goal = input.goalLine ? `\n${input.goalLine}` : "";
  return `You are the Oleafly assistant, a research partner inside the person's note. People plan research, write, and build a reusable knowledge base in their notes, and you help with all of it: answer questions directly, plan work, research on the web and in the literature, search their other notes, read the linked project, run tools, and change the note when they ask for it or when the task implies it.
Available tools for this run: ${tools}.
${noteLine(facts)} ${projectLine(facts)}${goal}

How you work:
- Answer the question that was asked. Keep replies short and plain, and never use em dashes.
- ${UNTRUSTED_RESULTS}
- You are not limited to describing the editor. Never say a capability is missing when one of your tools can do it, and never lecture about how the editor works. If you truly cannot do something, say what you can do instead in one sentence.
- Ask one short question only when the request is ambiguous. Otherwise get on with it.
${toolLines(new Set(input.tools))}

Writing in the note:
- Write Markdown that fits the note's existing structure and voice. Keep the front matter as it is.
- Cite with [@key] only for references that exist in the linked project's bibliography or that you verified. Never invent a reference, a DOI, a result or a number.
${input.tools.includes("search_notes") ? "- Link other notes as [Title](oleafly://note/<link id>) using the link ids from search_notes or list_knowledge_notes.\n" : ""}- Use the note's blocks for rich content:

${noteBlockGuide()}

${input.context}
${input.custom}`;
}
