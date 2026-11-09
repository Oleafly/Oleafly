import type { ConfirmFn, ToolApprovalRequest } from "@/lib/ai-tools";
import type { RuntimeToolset } from "@/lib/ai-tool-availability";
import type { ToolSet } from "@/lib/chat-types";
import { NOTE_FILE } from "@/lib/project-notes";
import { createResearchTaskAiTools } from "@/lib/research-tools";
import {
  listFiles,
  readFileContent,
  searchProject,
  type NoteSearchHit,
  type NoteTagCount,
} from "@/lib/tauri";
import { noteLinkHref } from "./note-link-format";
import type { NoteEdit } from "./note-edits";
import type { NoteItem, NoteSource } from "./types";
import { untrusted } from "./untrusted-data";

export { NOTE_FILE };

export const NOTE_WORKSPACE_ONLY_TOOLS: readonly string[] = [
  "compile",
  "set_main_doc",
  "get_log",
  "get_pdf_text",
  "verify_pdf_pages",
  "show_location",
  "project_map",
  "project_library_search",
  "preview_figure",
  "insert_figure",
  "import_overleaf_projects",
  "list_overleaf_projects",
];

export const NOTE_TASK_TOOLS: readonly string[] = ["research_task_create", "research_task_status"];

export const NOTE_FILE_MUTATION_TOOLS: readonly string[] = [
  "write_file",
  "replace_in_file",
  "create_file",
  "delete_file",
  "rename_file",
];

const FILE_MUTATIONS = new Set(NOTE_FILE_MUTATION_TOOLS);
const MAX_EDITS = 50;
const MAX_TEXT = 200_000;
const MAX_LIST = 100;
const DEFAULT_LIST = 25;
const MAX_FILES = 500;
const MAX_SEARCH = 50;
const MAX_PROJECTS = 50;
const EXCERPT_CHARS = 1_200;

export type SkipReason = "notFound" | "ambiguous" | "overlaps" | "unchanged";

export interface SkippedEdit {
  edit: number;
  reason: SkipReason;
}

export interface PlannedEdits {
  valid: NoteEdit[];
  skipped: SkippedEdit[];
}

export interface NoteDraft {
  title: string;
  body?: string;
  tags?: readonly string[];
  relatedProject?: string | null;
}

export interface NoteDraftApproval {
  title: string;
  tags: readonly string[];
  project: string | null;
  excerpt: string;
  truncated: boolean;
}

export interface NoteToolDeps {
  noteId: string;
  relatedProjectId: string | null;
  readSource: () => string | Promise<string>;
  propose: (edits: readonly NoteEdit[]) => number;
  notes: () => readonly NoteItem[];
  projects: () => readonly { id: string; name: string }[];
  loadNote: (id: string) => Promise<NoteSource>;
  searchNotes: (query: string, limit: number) => Promise<readonly NoteSearchHit[]>;
  noteTags: () => Promise<readonly NoteTagCount[]>;
  linkIds: () => Promise<ReadonlyMap<string, string>>;
  createNote?: (draft: NoteDraft) => Promise<string>;
}

export interface NoteToolRun {
  confirm: ConfirmFn;
}

const SKIP_TEXT: Readonly<Record<SkipReason, string>> = {
  notFound: "The find text is not in the note. Copy it exactly from read_note, including punctuation and line breaks.",
  ambiguous: "The find text appears more than once. Add nearby words so it matches only one place.",
  overlaps: "This edit overlaps an earlier edit in the same call. Merge them into one edit.",
  unchanged: "find and replace are the same, so there is nothing to change.",
};

function normalizedPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const resolved: string[] = [];
  for (const raw of value.replaceAll("\\", "/").split("/")) {
    const trimmed = raw.trim();
    if (trimmed === "..") {
      resolved.pop();
      continue;
    }
    const segment = trimmed.replace(/[. ]+$/u, "");
    if (segment) resolved.push(segment);
  }
  return resolved.join("/").toLowerCase();
}

export function noteFileRefusal(call: { name: string; args: unknown }): string | null {
  if (!FILE_MUTATIONS.has(call.name) || !call.args || typeof call.args !== "object") return null;
  const args = call.args as Record<string, unknown>;
  const touched = ["path", "from", "to"].map((key) => normalizedPath(args[key]));
  if (!touched.includes(NOTE_FILE)) return null;
  return `${NOTE_FILE} is the open note, so ${call.name} can't change it. Use propose_note_edits to suggest the change for review, and read_note to see the current text.`;
}

function occurrences(source: string, find: string): number {
  let count = 0;
  let at = source.indexOf(find);
  while (at >= 0 && count < 2) {
    count += 1;
    at = source.indexOf(find, at + 1);
  }
  return count;
}

export function planNoteEdits(source: string, edits: readonly NoteEdit[]): PlannedEdits {
  const valid: NoteEdit[] = [];
  const skipped: SkippedEdit[] = [];
  const spans: { from: number; to: number }[] = [];
  edits.forEach((edit, index) => {
    const number = index + 1;
    if (edit.find === edit.replace) {
      skipped.push({ edit: number, reason: "unchanged" });
      return;
    }
    if (edit.find === "") {
      valid.push(edit);
      return;
    }
    const count = occurrences(source, edit.find);
    if (count === 0) {
      skipped.push({ edit: number, reason: "notFound" });
      return;
    }
    if (count > 1) {
      skipped.push({ edit: number, reason: "ambiguous" });
      return;
    }
    const from = source.indexOf(edit.find);
    const span = { from, to: from + edit.find.length };
    if (spans.some((other) => span.from < other.to && other.from < span.to)) {
      skipped.push({ edit: number, reason: "overlaps" });
      return;
    }
    spans.push(span);
    valid.push(edit);
  });
  return { valid, skipped };
}

function stringField(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function limitField(input: unknown, fallback: number, max: number): number {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>).limit : undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

export function parseEdits(input: unknown): NoteEdit[] | string {
  const edits = input && typeof input === "object" ? (input as Record<string, unknown>).edits : undefined;
  if (!Array.isArray(edits) || edits.length === 0) return "edits must be a non-empty list of { find, replace }.";
  if (edits.length > MAX_EDITS) return `Send at most ${MAX_EDITS} edits in one call.`;
  const parsed: NoteEdit[] = [];
  for (const [index, edit] of edits.entries()) {
    const find = stringField(edit, "find");
    const replace = stringField(edit, "replace");
    if (find === undefined || replace === undefined) return `Edit ${index + 1} needs find and replace as text.`;
    if (find.length > MAX_TEXT || replace.length > MAX_TEXT) return `Edit ${index + 1} is too long.`;
    parsed.push({ find, replace });
  }
  return parsed;
}

function capped(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_TEXT ? { text: text.slice(0, MAX_TEXT), truncated: true } : { text, truncated: false };
}

function linkFor(title: string, linkId: string | undefined): string | undefined {
  return linkId ? `[${title}](${noteLinkHref("note", linkId)})` : undefined;
}

function tagsByNote(tags: readonly NoteTagCount[]): Map<string, string[]> {
  const byNote = new Map<string, string[]>();
  for (const entry of tags) {
    for (const note of entry.notes) byNote.set(note, [...(byNote.get(note) ?? []), entry.tag]);
  }
  return byNote;
}

function tagMatches(tags: readonly string[], wanted: string): boolean {
  const tag = wanted.trim().replace(/^#/u, "").toLowerCase();
  return tags.some((candidate) => candidate === tag || candidate.startsWith(`${tag}/`));
}

const NO_INPUT = { type: "object", properties: {}, additionalProperties: false };

function knowledgeTools(deps: NoteToolDeps, run: NoteToolRun): ToolSet {
  const findNote = async (id: string): Promise<NoteItem | undefined> => {
    const notes = deps.notes();
    const direct = notes.find((note) => note.id === id);
    if (direct) return direct;
    const links = await deps.linkIds();
    return notes.find((note) => links.get(note.id) === id);
  };
  return {
    read_note: {
      description:
        "Read the note the person has open, as Markdown with its YAML front matter. This is the live text in the editor, including edits you already proposed that are waiting for review. Read it before you propose edits so your find text matches exactly.",
      inputSchema: NO_INPUT,
      execute: async () => {
        const markdown = capped(await deps.readSource());
        return untrusted({ id: deps.noteId, markdown: markdown.text, ...(markdown.truncated ? { truncated: true } : {}) });
      },
    },
    propose_note_edits: {
      description:
        "Suggest changes to the open note. Each edit replaces one exact passage: find must be copied from read_note and appear exactly once; an empty find appends replace to the end of the note. The edits appear in the note as suggestions the person accepts or rejects, so this is how you change the note. The result says how many suggestions were made and which edits were skipped and why; fix the skipped ones and call again in the same turn. Don't use it to change the front matter.",
      inputSchema: {
        type: "object",
        properties: {
          edits: {
            type: "array",
            maxItems: MAX_EDITS,
            items: {
              type: "object",
              properties: {
                find: { type: "string", description: "Exact text from the note, or empty to append" },
                replace: { type: "string", description: "The text that takes its place" },
              },
              required: ["find", "replace"],
              additionalProperties: false,
            },
          },
          summary: { type: "string", description: "One short sentence on what the edits do" },
        },
        required: ["edits", "summary"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const edits = parseEdits(input);
        if (typeof edits === "string") return { error: edits };
        const plan = planNoteEdits(await deps.readSource(), edits);
        const skipped = plan.skipped.map((entry) => ({ edit: entry.edit, reason: SKIP_TEXT[entry.reason] }));
        if (plan.valid.length === 0) {
          return { error: "None of the edits could be placed in the note.", suggestions: 0, skipped };
        }
        const suggestions = deps.propose(plan.valid);
        return {
          success: true,
          suggestions,
          placed: plan.valid.length,
          skipped,
          message:
            suggestions > 0
              ? "The edits are shown in the note for the person to review."
              : "The edits matched the note but changed nothing visible.",
        };
      },
    },
    search_notes: {
      description:
        'Search the person\'s knowledge base: every note they have written. Words must all match; use "exact phrase", -word to exclude, tag:name, title:word and project:<id>. Returns note ids, titles, tags, a Markdown link to each note and matching snippets. Search before writing something the person may already know.',
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search words and operators" },
          limit: { type: "number", description: "Most notes to return (default 10, at most 50)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = stringField(input, "query")?.trim() ?? "";
        if (!query) return { error: "query must not be empty" };
        const hits = await deps.searchNotes(query, limitField(input, 10, MAX_SEARCH));
        return untrusted({
          notes: hits.map((hit) => ({
            id: hit.id,
            linkId: hit.noteId ?? undefined,
            title: hit.title,
            link: linkFor(hit.title, hit.noteId ?? undefined),
            tags: hit.tags,
            relatedProject: hit.relatedProject ?? undefined,
            snippets: hit.snippets.map((snippet) => snippet.text),
          })),
        });
      },
    },
    list_knowledge_notes: {
      description:
        "List the notes in the person's knowledge base, newest first, with id, title, tags, related project and a short summary. Filter by tag or by related project id.",
      inputSchema: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Only notes with this tag (child tags count)" },
          project: { type: "string", description: "Only notes linked to this project id" },
          limit: { type: "number", description: `Most notes to return (default ${DEFAULT_LIST}, at most ${MAX_LIST})` },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const tag = stringField(input, "tag");
        const project = stringField(input, "project");
        const [tags, links] = await Promise.all([
          deps.noteTags().catch(() => [] as NoteTagCount[]),
          deps.linkIds().catch(() => new Map<string, string>()),
        ]);
        const byNote = tagsByNote(tags);
        const notes = [...deps.notes()]
          .filter((note) => !project || note.relatedProjectId === project)
          .filter((note) => !tag || tagMatches(byNote.get(note.id) ?? [], tag))
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, limitField(input, DEFAULT_LIST, MAX_LIST));
        return untrusted({
          notes: notes.map((note) => ({
            id: note.id,
            linkId: links.get(note.id),
            title: note.title,
            link: linkFor(note.title, links.get(note.id)),
            tags: byNote.get(note.id) ?? [],
            relatedProject: note.relatedProjectId,
            updated: new Date(note.updatedAt).toISOString(),
            summary: note.summary,
            ...(note.id === deps.noteId ? { open: true } : {}),
          })),
        });
      },
    },
    read_note_by_id: {
      description:
        "Read another note from the knowledge base by its id or link id, as Markdown with front matter. Use it to reuse what the person already wrote.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The note id or link id from list_knowledge_notes or search_notes" } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const id = stringField(input, "id")?.trim() ?? "";
        if (!id) return { error: "id must not be empty" };
        const note = await findNote(id);
        if (!note) return { error: `No note has the id ${id}. Use list_knowledge_notes or search_notes to find it.` };
        const text = note.id === deps.noteId ? await deps.readSource() : (await deps.loadNote(note.id)).text;
        const markdown = capped(text);
        return untrusted({
          id: note.id,
          title: note.title,
          markdown: markdown.text,
          ...(markdown.truncated ? { truncated: true } : {}),
        });
      },
    },
    ...(deps.createNote ? { create_note: createNoteTool(deps, deps.createNote, run) } : {}),
  };
}

function createNoteTool(
  deps: NoteToolDeps,
  create: NonNullable<NoteToolDeps["createNote"]>,
  run: NoteToolRun,
): ToolSet[string] {
  return {
    description:
      "Create a new note in the knowledge base, for example to keep a summary, a reading list or results apart from this note. Returns its id and a Markdown link you can put in this note with propose_note_edits.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The note's title" },
        body: { type: "string", description: "The note's Markdown, without front matter" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
        relatedProject: { type: "string", description: "Optional id of one of the person's projects to link the note to" },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const title = stringField(input, "title")?.trim() ?? "";
      if (!title) return { error: "title must not be empty" };
      const body = stringField(input, "body") ?? "";
      if (body.length > MAX_TEXT) return { error: "body is too long" };
      const raw = input && typeof input === "object" ? (input as Record<string, unknown>).tags : undefined;
      const tags = Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "") : [];
      const relatedProject = stringField(input, "relatedProject")?.trim() || null;
      const projects = deps.projects();
      const project = relatedProject ? projects.find((entry) => entry.id === relatedProject) : undefined;
      if (relatedProject && !project) {
        return {
          error: `No project has the id ${relatedProject}. Use one of these ids, or leave relatedProject out.`,
          projects: projects.slice(0, MAX_PROJECTS).map(({ id, name }) => ({ id, name })),
        };
      }
      const request: ToolApprovalRequest & { noteDraft: NoteDraftApproval } = {
        tool: "create_note",
        summary: `Create the note "${title}"`,
        noteDraft: {
          title,
          tags,
          project: project?.name ?? null,
          excerpt: body.slice(0, EXCERPT_CHARS),
          truncated: body.length > EXCERPT_CHARS,
        },
      };
      if (!(await run.confirm(request))) {
        return { message: "The person declined creating this note.", declined: true };
      }
      const id = await create({ title, body, tags, relatedProject });
      const linkId = (await deps.linkIds().catch(() => new Map<string, string>())).get(id);
      return { success: true, id, linkId, title, link: linkFor(title, linkId) };
    },
  };
}

function relatedTools(projectId: string): ToolSet {
  return {
    related_project_files: {
      description:
        "List the files in the project this note is linked to: its paper, code and data. Folders end with a slash.",
      inputSchema: NO_INPUT,
      execute: async () => {
        const entries = await listFiles(projectId);
        const paths = entries.map((entry) => (entry.is_dir ? `${entry.path}/` : entry.path));
        return untrusted({
          files: paths.slice(0, MAX_FILES),
          ...(paths.length > MAX_FILES ? { more: paths.length - MAX_FILES } : {}),
        });
      },
    },
    read_related_project_file: {
      description:
        "Read a text file from the project this note is linked to, by its path from related_project_files. offset and limit pick lines in long files.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path inside the linked project" },
          offset: { type: "number", description: "First line to return, starting at 1" },
          limit: { type: "number", description: "Number of lines to return" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const path = stringField(input, "path")?.trim() ?? "";
        if (!path) return { error: "path must not be empty" };
        const text = await readFileContent(projectId, path);
        const record = input as Record<string, unknown>;
        const offset = typeof record.offset === "number" && record.offset > 1 ? Math.floor(record.offset) : 1;
        const lines = text.split(/\r?\n/u);
        const count = typeof record.limit === "number" && record.limit > 0 ? Math.floor(record.limit) : lines.length;
        const shown = capped(lines.slice(offset - 1, offset - 1 + count).join("\n"));
        return untrusted({
          path,
          content: shown.text,
          lines: lines.length,
          ...(shown.truncated ? { truncated: true } : {}),
        });
      },
    },
    search_related_project: {
      description:
        "Search the files of the project this note is linked to for a word or phrase. Returns the path, line and a preview for each match.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Text to look for" } },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = stringField(input, "query")?.trim() ?? "";
        if (!query) return { error: "query must not be empty" };
        const hits = await searchProject(projectId, query);
        return untrusted({
          matches: hits.slice(0, MAX_SEARCH).map((hit) => ({ path: hit.path, line: hit.line, preview: hit.preview })),
          ...(hits.length > MAX_SEARCH ? { more: hits.length - MAX_SEARCH } : {}),
        });
      },
    },
  };
}

export function createNoteAssistantTools(deps: NoteToolDeps, run: NoteToolRun): RuntimeToolset {
  const related = deps.relatedProjectId;
  return {
    id: "note",
    source: { kind: "project" },
    tools: {
      ...knowledgeTools(deps, run),
      ...(related ? relatedTools(related) : {}),
      ...(related ? (createResearchTaskAiTools({ confirm: run.confirm, projectId: () => related }) as ToolSet) : {}),
    },
  };
}

export function noteExcludedTools(relatedProjectId: string | null, inProject = false): string[] {
  return [
    ...NOTE_WORKSPACE_ONLY_TOOLS,
    ...(relatedProjectId ? [] : NOTE_TASK_TOOLS),
    ...(inProject ? NOTE_FILE_MUTATION_TOOLS : []),
  ];
}
