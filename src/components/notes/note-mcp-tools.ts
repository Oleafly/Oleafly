import type { ConfirmFn } from "@/lib/ai-tools";
import type { ToolSet } from "@/lib/chat-types";
import { i18n } from "@/i18n";
import { periodTitle } from "@/lib/notes-periodic";
import { listNoteTags, listNoteTasks, type NoteLinkRecord, noteLinks, noteSearch, type NoteTaskRecord } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { appNotesService, linkIdsOf, type VaultSnapshot, vaultSnapshot } from "./app-notes";
import { dailyNoteId, findDailyNote } from "./daily-note";
import { findVaultNote, type NoteDraft, planNoteEdits, type VaultToolDeps, vaultTools } from "./note-assistant-tools";
import type { NoteEdit } from "./note-edits";
import { noteHeadings, noteSection } from "./note-link-format";
import { proposeNoteEdits, reviewedNoteSource } from "./note-pending-suggestions";
import { relatedProjectChoices } from "./notes-service";
import type { NoteItem } from "./types";
import { untrusted } from "./untrusted-data";

export const NOTE_MCP_MUTATING_TOOLS: readonly string[] = ["create_note", "append_to_note", "edit_note_section"];

const VAULT_TOOL_NAMES = ["list_knowledge_notes", "search_notes", "read_note_by_id", "create_note"] as const;
const MAX_TEXT = 200_000;
const DEFAULT_TASKS = 50;
const MAX_TASKS = 200;
const SHARED_NOTE =
  "This note is shared with other people through a collaboration server, so outside agents can read it but not change it.";
const REVIEW =
  "The change is shown in the note as a suggestion. Nothing is written until the person accepts it in Oleafly.";
const CREATE_NOTE =
  "Create a new note in the person's knowledge base. The person approves it in Oleafly first. Returns the note's id, its link id and a Markdown link to it.";
const CANCELLED = "MCP request was cancelled before the note changed.";
const DAILY_OFF = "Daily notes are turned off in Oleafly, so there is no today's note.";

export interface NoteMcpDeps {
  snapshot: () => Promise<VaultSnapshot>;
  readNote: (id: string) => string | Promise<string>;
  propose: (id: string, edits: readonly NoteEdit[]) => number;
  createNote?: (draft: NoteDraft) => Promise<string>;
  todayNote: (create: boolean) => Promise<string | null>;
  todayTitle: () => string | null;
  projects: () => readonly { id: string; name: string }[];
  searchNotes: VaultToolDeps["searchNotes"];
  noteTags: VaultToolDeps["noteTags"];
  noteLinks: () => Promise<readonly NoteLinkRecord[]>;
  noteTasks: () => Promise<readonly NoteTaskRecord[]>;
}

export interface NoteMcpRun {
  confirm: ConfirmFn;
  mutationAllowed?: () => boolean;
}

function stringField(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function vaultDeps(deps: NoteMcpDeps, snap: VaultSnapshot): VaultToolDeps {
  const links = linkIdsOf(snap.facts);
  return {
    notes: () => snap.notes,
    linkIds: () => Promise.resolve(links),
    projects: deps.projects,
    searchNotes: deps.searchNotes,
    noteTags: deps.noteTags,
    readNote: deps.readNote,
    ...(deps.createNote ? { createNote: deps.createNote } : {}),
  };
}

type Located = { note: NoteItem; linkId: string | undefined; snap: VaultSnapshot } | { error: string };

async function locate(deps: NoteMcpDeps, input: unknown): Promise<Located> {
  const id = stringField(input, "id")?.trim() ?? "";
  if (!id) return { error: "id must not be empty" };
  const snap = await deps.snapshot();
  const links = linkIdsOf(snap.facts);
  const note = await findVaultNote({ notes: () => snap.notes, linkIds: () => Promise.resolve(links) }, id);
  if (!note) return { error: `No note has the id ${id}. Use list_knowledge_notes or search_notes to find it.` };
  return { note, linkId: links.get(note.id), snap };
}

function cancelled(run: NoteMcpRun): boolean {
  return run.mutationAllowed !== undefined && !run.mutationAllowed();
}

async function todayTarget(deps: NoteMcpDeps, run: NoteMcpRun): Promise<Located> {
  const existing = await deps.todayNote(false);
  if (existing) return locate(deps, { id: existing });
  const title = deps.todayTitle();
  if (title === null) return { error: DAILY_OFF };
  if (cancelled(run)) return { error: CANCELLED };
  const summary = i18n.t(($) => $.core.mcp.createTodaySummary, { title });
  if (!(await run.confirm({ tool: "create_note", summary }))) return { error: "The person declined creating today's note." };
  if (cancelled(run)) return { error: CANCELLED };
  const id = await deps.todayNote(true);
  if (!id) return { error: "Today's note could not be created." };
  return locate(deps, { id });
}

function proposed(deps: NoteMcpDeps, run: NoteMcpRun, found: Exclude<Located, { error: string }>, edits: NoteEdit[]) {
  if (found.note.shared) return { error: SHARED_NOTE };
  if (cancelled(run)) return { error: CANCELLED };
  const suggestions = deps.propose(found.note.id, edits);
  return { success: true, id: found.note.id, linkId: found.linkId, title: found.note.title, suggestions, message: REVIEW };
}

export function sectionEdit(source: string, heading: string, content: string, mode: "replace" | "append"): NoteEdit | string {
  const wanted = heading.trim().replace(/^#{1,6}\s+/u, "");
  const headings = noteHeadings(source);
  const matches = headings.filter((entry) => entry.slug === wanted || entry.text.toLowerCase() === wanted.toLowerCase());
  if (matches.length === 0) {
    const known = headings.map((entry) => entry.text);
    return `No heading called "${wanted}". The note's headings are: ${known.length > 0 ? known.join(", ") : "none"}.`;
  }
  if (matches.length > 1) {
    return `Several headings are called "${wanted}". Pass one of these slugs instead: ${matches.map((entry) => entry.slug).join(", ")}.`;
  }
  const section = noteSection(source, matches[0].slug);
  if (section === null) return `The section "${wanted}" could not be read.`;
  const headingLine = section.split("\n")[0];
  const body = content.replaceAll(/\r\n?/gu, "\n").trim();
  const kept = mode === "append" ? section : headingLine;
  return { find: section, replace: body ? `${kept}\n\n${body}` : kept };
}

function taskTools(deps: NoteMcpDeps): ToolSet {
  return {
    list_note_tasks: {
      description:
        "List the checkbox tasks written in the person's notes, newest note first. Each task has the note's id and title, its line, whether it is done and its text, with any fields such as [due:: 2026-11-12] left in. Filter by note id and by status.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Only tasks in this note (id or link id)" },
          status: { type: "string", enum: ["open", "done", "all"], description: "Which tasks to list (default open)" },
          limit: { type: "number", description: `Most tasks to return (default ${DEFAULT_TASKS}, at most ${MAX_TASKS})` },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const only = stringField(input, "id") ? await locate(deps, input) : null;
        if (only && "error" in only) return only;
        const status = stringField(input, "status") ?? "open";
        const raw = input && typeof input === "object" ? (input as Record<string, unknown>).limit : undefined;
        const limit = typeof raw === "number" && Number.isFinite(raw) ? Math.max(1, Math.min(MAX_TASKS, Math.floor(raw))) : DEFAULT_TASKS;
        const [snap, lists] = await Promise.all([only?.snap ?? deps.snapshot(), deps.noteTasks()]);
        const links = linkIdsOf(snap.facts);
        const notes = new Map(snap.notes.map((note) => [note.id, note]));
        const tasks = lists
          .filter((list) => notes.has(list.projectId) && (!only || list.projectId === only.note.id))
          .sort((left, right) => (notes.get(right.projectId)?.updatedAt ?? 0) - (notes.get(left.projectId)?.updatedAt ?? 0))
          .flatMap((list) =>
            list.tasks
              .filter((task) => status === "all" || task.checked === (status === "done"))
              .map((task) => ({
                id: list.projectId,
                linkId: links.get(list.projectId),
                title: notes.get(list.projectId)?.title ?? "",
                line: task.line,
                done: task.checked,
                text: task.text,
              })),
          );
        return untrusted({ tasks: tasks.slice(0, limit), ...(tasks.length > limit ? { more: tasks.length - limit } : {}) });
      },
    },
  };
}

export function createNoteMcpTools(deps: NoteMcpDeps, run: NoteMcpRun): ToolSet {
  const shapes = vaultTools(
    {
      notes: () => [],
      linkIds: () => Promise.resolve(new Map()),
      projects: deps.projects,
      searchNotes: deps.searchNotes,
      noteTags: deps.noteTags,
      readNote: deps.readNote,
      ...(deps.createNote ? { createNote: deps.createNote } : {}),
    },
    run,
  );
  const shared: ToolSet = {};
  for (const name of VAULT_TOOL_NAMES) {
    const shape = shapes[name];
    if (!shape) continue;
    shared[name] = {
      description: name === "create_note" ? CREATE_NOTE : shape.description,
      inputSchema: shape.inputSchema,
      execute: async (input) => {
        const live = vaultTools(vaultDeps(deps, await deps.snapshot()), run)[name];
        return live?.execute ? live.execute(input) : { error: `${name} is not available.` };
      },
    };
  }
  return {
    ...shared,
    today_note: {
      description:
        "Read today's daily note, the note titled with today's date in the person's daily note format, as Markdown with front matter. If there is none yet, says so and gives the title it would have; append_to_note with today: true creates it.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const id = await deps.todayNote(false);
        if (!id) {
          const title = deps.todayTitle();
          return title === null ? { exists: false, message: DAILY_OFF } : { exists: false, title };
        }
        const found = await locate(deps, { id });
        if ("error" in found) return found;
        const markdown = await deps.readNote(id);
        return untrusted({
          exists: true,
          id,
          linkId: found.linkId,
          title: found.note.title,
          markdown: markdown.slice(0, MAX_TEXT),
          ...(markdown.length > MAX_TEXT ? { truncated: true } : {}),
        });
      },
    },
    append_to_note: {
      description: `Add Markdown to the end of a note. Pass the note's id, or today: true for today's daily note, which is created from the daily template if it does not exist, after the person approves it. ${REVIEW}`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The note id or link id" },
          today: { type: "boolean", description: "Add to today's daily note instead of id" },
          text: { type: "string", description: "The Markdown to add" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const text = stringField(input, "text")?.trim() ?? "";
        if (!text) return { error: "text must not be empty" };
        if (text.length > MAX_TEXT) return { error: "text is too long" };
        const today = (input as Record<string, unknown>).today === true;
        if (!today && !stringField(input, "id")) return { error: "Pass id, or today: true." };
        const found = today ? await todayTarget(deps, run) : await locate(deps, input);
        if ("error" in found) return found;
        return proposed(deps, run, found, [{ find: "", replace: text }]);
      },
    },
    edit_note_section: {
      description: `Rewrite the part of a note under one heading, or add to the end of it. heading is the heading's text or its slug. replace (the default) swaps everything under the heading, its subheadings included, for content; append adds content at the end of the section. Read the note first. ${REVIEW}`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The note id or link id" },
          heading: { type: "string", description: "The heading's text, such as Results, or its slug, such as results" },
          content: { type: "string", description: "The Markdown for the section, without the heading line" },
          mode: { type: "string", enum: ["replace", "append"], description: "replace (default) or append" },
        },
        required: ["id", "heading", "content"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const content = stringField(input, "content") ?? "";
        if (content.length > MAX_TEXT) return { error: "content is too long" };
        const found = await locate(deps, input);
        if ("error" in found) return found;
        const source = await deps.readNote(found.note.id);
        const mode = stringField(input, "mode") === "append" ? "append" : "replace";
        const edit = sectionEdit(source, stringField(input, "heading") ?? "", content, mode);
        if (typeof edit === "string") return { error: edit };
        const plan = planNoteEdits(source, [edit]);
        if (plan.valid.length === 0) return { error: "The section changed while it was being edited, or it appears twice. Read the note and try again." };
        return proposed(deps, run, found, plan.valid);
      },
    },
    note_backlinks: {
      description: "List the notes that link to a note, with the linking note's id, title and the text around the link.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The note id or link id" } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const found = await locate(deps, input);
        if ("error" in found) return found;
        if (!found.linkId) return untrusted({ id: found.note.id, backlinks: [] });
        const [{ backlinksOf, buildNoteLinkIndex }, records] = await Promise.all([import("./use-note-links"), deps.noteLinks()]);
        const index = buildNoteLinkIndex(records, found.snap.notes, undefined, () => null);
        return untrusted({
          id: found.note.id,
          backlinks: backlinksOf(index, found.linkId).map((link) => ({
            id: link.projectId,
            linkId: link.noteId ?? undefined,
            title: link.title,
            snippet: link.snippet,
          })),
        });
      },
    },
    ...taskTools(deps),
  };
}

export function appNoteMcpDeps(): NoteMcpDeps {
  let service: ReturnType<typeof appNotesService> | null = null;
  const notes = () => {
    service ??= appNotesService();
    return service;
  };
  const createNote = async (draft: NoteDraft) => {
    const create = (await notes()).createNoteFrom;
    if (!create) throw new Error("Notes can't create notes here.");
    return create(draft);
  };
  return {
    snapshot: vaultSnapshot,
    readNote: (id) => reviewedNoteSource(id, async () => (await notes()).loadNote(id)),
    propose: proposeNoteEdits,
    createNote,
    todayNote: async (create) => {
      const settings = useSettingsStore.getState().notesPeriodic;
      const now = new Date();
      const { notes: items } = await vaultSnapshot();
      if (!create) return findDailyNote(items, now, settings, i18n.language)?.id ?? null;
      const loadNote = async (id: string) => (await notes()).loadNote(id);
      return dailyNoteId({ notes: items, createNoteFrom: createNote, loadNote }, now, i18n.language, settings);
    },
    todayTitle: () => {
      const settings = useSettingsStore.getState().notesPeriodic;
      return settings.daily.enabled ? periodTitle("daily", settings, new Date(), i18n.language) : null;
    },
    projects: () => relatedProjectChoices(useFilesStore.getState().projects),
    searchNotes: (query, limit) => noteSearch(query, limit),
    noteTags: () => listNoteTags(),
    noteLinks: () => noteLinks(),
    noteTasks: () => listNoteTasks(),
  };
}
