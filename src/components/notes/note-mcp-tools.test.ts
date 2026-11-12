// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import "./tests/setup";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { NOTES_PERIODIC_DEFAULTS } from "@/lib/notes-periodic";
import type { NoteFacts } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { appNotesService, vaultSnapshot } from "./app-notes";
import type { NoteEdit } from "./note-edits";
import { appNoteMcpDeps, createNoteMcpTools, type NoteMcpDeps, type NoteMcpRun, sectionEdit } from "./note-mcp-tools";
import type { NoteItem } from "./types";

vi.mock("./app-notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./app-notes")>()),
  vaultSnapshot: vi.fn(),
  appNotesService: vi.fn(),
}));

function note(id: string, title: string, updatedAt: number, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title, project: "", updatedAt, author: "you", summary: "", ...extra };
}

function fact(id: string, noteId: string): NoteFacts {
  return { id, noteId, title: id, tags: [], aliases: [], properties: {}, preview: "", relatedProject: null, updatedAt: 0, knowledge: id } as unknown as NoteFacts;
}

const TEXT: Record<string, string> = {
  today: "---\ntags: [daily]\n---\n\n## Plan\n\n- [ ] Call Sam\n",
  paper: "# Paper\n\n## Methods\n\nOld methods.\n\n### Details\n\nSteps.\n\n## Results\n\nPending.\n",
  twice: "## Notes\n\nOne\n\n## Notes\n\nTwo\n",
  team: "Shared plan\n",
};

function setup(overrides: Partial<NoteMcpDeps> = {}) {
  const notes = [
    note("today", "2026-11-11", 3, { tags: ["daily"] }),
    note("paper", "Paper", 2),
    note("twice", "Twice", 1),
    note("team", "Team plan", 4, { shared: true }),
  ];
  const facts = [fact("today", "L-today"), fact("paper", "L-paper"), fact("twice", "L-twice"), fact("team", "L-team")];
  const proposals: { id: string; edits: readonly NoteEdit[] }[] = [];
  const deps: NoteMcpDeps = {
    snapshot: async () => ({ notes, facts }),
    readNote: (id) => TEXT[id] ?? "",
    propose: (id, edits) => {
      proposals.push({ id, edits });
      return edits.length;
    },
    createNote: vi.fn(async () => "new-note"),
    todayNote: vi.fn(async (_create: boolean): Promise<string | null> => "today"),
    todayTitle: (): string | null => "2026-11-11",
    projects: () => [{ id: "p1", name: "Thesis" }],
    searchNotes: vi.fn(async () => []),
    noteTags: async () => [],
    noteLinks: async () => [
      { projectId: "paper", noteId: "L-paper", title: "Paper", links: [{ kind: "note", id: "L-today", snippet: "see [[today]]" }] },
      { projectId: "twice", noteId: "L-twice", title: "Twice", links: [{ kind: "note", id: "L-paper", snippet: "from the paper" }] },
    ],
    noteTasks: async () => [
      { projectId: "today", tasks: [{ line: 6, checked: false, text: "Call Sam [due:: 2026-11-12]" }] },
      { projectId: "paper", tasks: [{ line: 3, checked: true, text: "Draft methods" }, { line: 9, checked: false, text: "Run stats" }] },
      { projectId: "gone", tasks: [{ line: 1, checked: false, text: "From a deleted note" }] },
    ],
    ...overrides,
  };
  const confirm = vi.fn(async () => true);
  const run: NoteMcpRun = { confirm };
  const tools = createNoteMcpTools(deps, run);
  const call = (name: string, input: unknown = {}) => {
    const tool = tools[name];
    if (!tool?.execute) throw new Error(`missing ${name}`);
    return tool.execute(input) as Promise<Record<string, unknown>>;
  };
  return { deps, run, confirm, tools, call, proposals };
}

describe("createNoteMcpTools", () => {
  it("offers the knowledge base tools with object schemas", () => {
    const { tools } = setup();
    expect(Object.keys(tools).sort()).toEqual([
      "append_to_note",
      "create_note",
      "edit_note_section",
      "list_knowledge_notes",
      "list_note_tasks",
      "note_backlinks",
      "read_note_by_id",
      "search_notes",
      "today_note",
    ]);
    for (const tool of Object.values(tools)) expect((tool.inputSchema as { type: string }).type).toBe("object");
    expect(tools.create_note.description).not.toContain("propose_note_edits");
  });

  it("reads a note by its link id as untrusted data", async () => {
    const { call } = setup();
    expect(await call("read_note_by_id", { id: "L-paper" })).toMatchObject({ untrusted: true, id: "paper", markdown: TEXT.paper });
  });

  it("asks before creating a note and creates nothing when the person declines", async () => {
    const { call, confirm, deps } = setup();
    confirm.mockResolvedValueOnce(false);
    expect(await call("create_note", { title: "Ideas", body: "One" })).toMatchObject({ declined: true });
    expect(deps.createNote).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: "create_note", noteDraft: expect.objectContaining({ title: "Ideas" }) }));
    expect(await call("create_note", { title: "Ideas", body: "One" })).toMatchObject({ success: true, id: "new-note" });
  });

  it("adds text to today's note as a suggestion", async () => {
    const { call, confirm, deps, proposals } = setup();
    const result = await call("append_to_note", { today: true, text: "  Lunch with Ana  " });
    expect(deps.todayNote).toHaveBeenCalledWith(false);
    expect(deps.todayNote).not.toHaveBeenCalledWith(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(proposals).toEqual([{ id: "today", edits: [{ find: "", replace: "Lunch with Ana" }] }]);
    expect(result).toMatchObject({ success: true, id: "today", linkId: "L-today", suggestions: 1 });
    expect(String(result.message)).toMatch(/suggestion/u);
  });

  it("asks before creating today's note and creates nothing when the person declines", async () => {
    const todayNote = vi.fn(async (create: boolean) => (create ? "today" : null));
    const { call, confirm, proposals } = setup({ todayNote });
    confirm.mockResolvedValueOnce(false);
    expect(await call("append_to_note", { today: true, text: "Lunch" })).toEqual({ error: expect.stringMatching(/declined/u) });
    expect(confirm).toHaveBeenCalledWith({ tool: "create_note", summary: enCore.mcp.createTodaySummary.replace("{{title}}", "2026-11-11") });
    expect(todayNote).not.toHaveBeenCalledWith(true);
    expect(proposals).toEqual([]);
    expect(await call("append_to_note", { today: true, text: "Lunch" })).toMatchObject({ success: true, id: "today" });
    expect(todayNote).toHaveBeenCalledWith(true);
    expect(proposals).toEqual([{ id: "today", edits: [{ find: "", replace: "Lunch" }] }]);
  });

  it("asks nothing and creates nothing when daily notes are turned off", async () => {
    const todayNote = vi.fn(async (create: boolean) => (create ? "today" : null));
    const { call, confirm } = setup({ todayNote, todayTitle: () => null });
    expect(await call("append_to_note", { today: true, text: "x" })).toEqual({ error: expect.stringMatching(/turned off/u) });
    expect(confirm).not.toHaveBeenCalled();
    expect(todayNote).not.toHaveBeenCalledWith(true);
    expect(await call("today_note")).toEqual({ exists: false, message: expect.stringMatching(/turned off/u) });
  });

  it("creates no daily note for a cancelled MCP call", async () => {
    const todayNote = vi.fn(async (create: boolean) => (create ? "today" : null));
    const { deps, confirm } = setup({ todayNote });
    const tools = createNoteMcpTools(deps, { confirm, mutationAllowed: () => false });
    expect(await tools.append_to_note.execute?.({ today: true, text: "x" })).toEqual({ error: expect.stringMatching(/cancelled/u) });
    expect(confirm).not.toHaveBeenCalled();
    expect(todayNote).not.toHaveBeenCalledWith(true);
  });

  it("refuses to change a shared note, an empty text or a missing target", async () => {
    const { call, proposals } = setup();
    expect(await call("append_to_note", { id: "team", text: "x" })).toEqual({ error: expect.stringMatching(/shared/u) });
    expect(await call("append_to_note", { id: "paper", text: "  " })).toEqual({ error: "text must not be empty" });
    expect(await call("append_to_note", { text: "x" })).toEqual({ error: "Pass id, or today: true." });
    expect(await call("append_to_note", { id: "ghost", text: "x" })).toEqual({ error: expect.stringMatching(/No note has the id ghost/u) });
    expect(proposals).toEqual([]);
  });

  it("stops before proposing when the MCP call was cancelled", async () => {
    const { deps, proposals } = setup();
    const tools = createNoteMcpTools(deps, { confirm: async () => true, mutationAllowed: () => false });
    expect(await tools.append_to_note.execute?.({ id: "paper", text: "x" })).toEqual({ error: expect.stringMatching(/cancelled/u) });
    expect(proposals).toEqual([]);
  });

  it("rewrites or extends one section under a heading", async () => {
    const { call, proposals } = setup();
    await call("edit_note_section", { id: "paper", heading: "Methods", content: "New methods." });
    await call("edit_note_section", { id: "paper", heading: "## results", content: "p < 0.05", mode: "append" });
    expect(proposals.map((proposal) => proposal.edits)).toEqual([
      [{ find: "## Methods\n\nOld methods.\n\n### Details\n\nSteps.", replace: "## Methods\n\nNew methods." }],
      [{ find: "## Results\n\nPending.", replace: "## Results\n\nPending.\n\np < 0.05" }],
    ]);
  });

  it("names the headings it knows when the one asked for is missing or repeated", async () => {
    const { call } = setup();
    expect(await call("edit_note_section", { id: "paper", heading: "Discussion", content: "x" })).toEqual({
      error: 'No heading called "Discussion". The note\'s headings are: Paper, Methods, Details, Results.',
    });
    expect(await call("edit_note_section", { id: "twice", heading: "Notes", content: "x" })).toEqual({
      error: 'Several headings are called "Notes". Pass one of these slugs instead: notes, notes-1.',
    });
  });

  it("lists open tasks newest note first and skips notes that are gone", async () => {
    const { call } = setup();
    expect(await call("list_note_tasks")).toEqual({
      untrusted: true,
      tasks: [
        { id: "today", linkId: "L-today", title: "2026-11-11", line: 6, done: false, text: "Call Sam [due:: 2026-11-12]" },
        { id: "paper", linkId: "L-paper", title: "Paper", line: 9, done: false, text: "Run stats" },
      ],
    });
    expect(await call("list_note_tasks", { id: "L-paper", status: "done" })).toMatchObject({ tasks: [expect.objectContaining({ text: "Draft methods" })] });
    expect(await call("list_note_tasks", { status: "all", limit: 1 })).toMatchObject({ more: 2 });
  });

  it("lists the notes that link to a note", async () => {
    const { call } = setup();
    expect(await call("note_backlinks", { id: "paper" })).toEqual({
      untrusted: true,
      id: "paper",
      backlinks: [{ id: "twice", linkId: "L-twice", title: "Twice", snippet: "from the paper" }],
    });
  });

  it("reads today's note, or says there is none yet", async () => {
    expect(await setup().call("today_note")).toMatchObject({ untrusted: true, exists: true, id: "today", markdown: TEXT.today });
    const empty = setup({ todayNote: async () => null });
    expect(await empty.call("today_note")).toEqual({ exists: false, title: "2026-11-11" });
  });
});

describe("sectionEdit", () => {
  it("keeps the heading line and drops nothing outside the section", () => {
    expect(sectionEdit("## A\n\nx\n\n## B\n\ny\n", "A", "", "replace")).toEqual({ find: "## A\n\nx", replace: "## A" });
    expect(sectionEdit("## A\n\nx\n", "a", "z\r\nw", "append")).toEqual({ find: "## A\n\nx", replace: "## A\n\nx\n\nz\nw" });
  });

  it("ignores headings inside code fences", () => {
    expect(sectionEdit("```\n## A\n```\n", "A", "x", "replace")).toBe('No heading called "A". The note\'s headings are: none.');
  });
});

describe("appNoteMcpDeps", () => {
  afterEach(() => {
    useSettingsStore.setState({ notesPeriodic: NOTES_PERIODIC_DEFAULTS });
    vi.useRealTimers();
  });

  it("finds, names and creates today's note with the person's daily note settings", async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0), toFake: ["Date"] });
    const createNoteFrom = vi.fn(async () => "created");
    const loadNote = vi.fn(async () => ({ text: "## Log\n", version: "v0" }));
    vi.mocked(appNotesService).mockResolvedValue({ createNoteFrom, loadNote } as never);
    useSettingsStore.getState().setNotesPeriodic("daily", { format: "DD.MM.YYYY", template: "note:tpl" });
    const daily = { project: "", updatedAt: 0, author: "you" as const, summary: "", tags: ["daily"] };
    vi.mocked(vaultSnapshot).mockResolvedValue({ notes: [{ ...daily, id: "dot", title: "11.11.2026" }, { ...daily, id: "iso", title: "2026-11-11" }], facts: [] });
    const deps = appNoteMcpDeps();
    expect(await deps.todayNote(false)).toBe("dot");
    expect(deps.todayTitle()).toBe("11.11.2026");
    vi.mocked(vaultSnapshot).mockResolvedValue({ notes: [], facts: [] });
    expect(await deps.todayNote(true)).toBe("created");
    expect(loadNote).toHaveBeenCalledWith("tpl");
    expect(createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: "11.11.2026" }));
    createNoteFrom.mockClear();
    useSettingsStore.getState().setNotesPeriodic("daily", { enabled: false });
    expect(deps.todayTitle()).toBeNull();
    expect(await deps.todayNote(true)).toBeNull();
    expect(createNoteFrom).not.toHaveBeenCalled();
  });
});
