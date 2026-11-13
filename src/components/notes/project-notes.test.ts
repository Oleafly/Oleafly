import type { ProjectInfo } from "@oleafly/backend-port";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  createNoteProject: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  createNoteProject: mocks.createNoteProject,
}));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  notifyError: mocks.notifyError,
}));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: mocks.logError,
}));

import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNoteTabsStore } from "@/store/note-tabs";
import { useNotesViewStore } from "@/store/notes-view";
import { noteColorFor, readNoteFacts } from "./note-file";
import {
  createProjectNote,
  matchesProjectNote,
  PROJECT_NOTE_SUMMARY_CHARS,
  projectNoteProjects,
  projectNotes,
  projectNotesPrompt,
  startProjectNote,
  type ProjectNote,
} from "./project-notes";
import "./tests/setup";

function project(id: string, overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    main_doc: "note.md",
    kind: "note",
    created_at: 1,
    updated_at: 100,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    related_project: "paper",
    ...overrides,
  };
}

const PROJECTS = [
  project("paper", { kind: "document", main_doc: "main.tex", related_project: null }),
  project("beta", { name: "Beta", updated_at: 200 }),
  project("alpha", { name: "Alpha", updated_at: 200 }),
  project("older", { name: "Older", updated_at: 50 }),
  project("elsewhere", { name: "Elsewhere", related_project: "thesis" }),
  project("loose", { name: "Loose", related_project: null }),
];

const saved = {
  files: useFilesStore.getState(),
  home: useHomeViewStore.getState(),
  notesView: useNotesViewStore.getState(),
};

let refreshProjects = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  refreshProjects = vi.fn(async () => {});
  useFilesStore.setState({ projectId: "paper", projects: PROJECTS, refreshProjects });
  useHomeViewStore.setState({ page: "library" });
  useNotesViewStore.setState({ requestedNoteId: null });
});

afterEach(() => {
  useFilesStore.setState(saved.files, true);
  useHomeViewStore.setState(saved.home, true);
  useNotesViewStore.setState(saved.notesView, true);
});

describe("a project's notes", () => {
  it("finds the notes linked to a project", () => {
    expect(projectNoteProjects(PROJECTS, "paper").map((item) => item.id)).toEqual(["beta", "alpha", "older"]);
    expect(projectNoteProjects(PROJECTS, "thesis").map((item) => item.id)).toEqual(["elsewhere"]);
    expect(projectNoteProjects(PROJECTS, null)).toEqual([]);
  });

  it("reads each note's icon, colour and summary and sorts by last edit, then title", () => {
    const beta = { id: "beta", noteId: null, title: "Beta", icon: "lucide:atom", color: "Mint", agent: null, tags: [], aliases: [], properties: {}, preview: "Sweep over masking ratios.", relatedProject: "paper", updatedAt: 1, knowledge: "k", taskDigest: "t" };
    const notes = projectNotes(PROJECTS, "paper", [beta]);
    expect(notes.map((note) => note.id)).toEqual(["alpha", "beta", "older"]);
    expect(notes[1]).toEqual({
      id: "beta",
      title: "Beta",
      updatedAt: 200_000,
      icon: "lucide:atom",
      color: "mint",
      summary: "Sweep over masking ratios.",
    });
    expect(notes[0]).toMatchObject({ icon: undefined, summary: "", color: noteColorFor("Alpha") });
  });

  it("matches a search against the title and summary, ignoring case", () => {
    const note: ProjectNote = { id: "n", title: "Masking ablation", updatedAt: 0, color: "mint", summary: "Loss fell at 75%" };
    expect(matchesProjectNote(note, "")).toBe(true);
    expect(matchesProjectNote(note, "   ")).toBe(true);
    expect(matchesProjectNote(note, "MASKING")).toBe(true);
    expect(matchesProjectNote(note, " loss ")).toBe(true);
    expect(matchesProjectNote(note, "dropout")).toBe(false);
  });
});

describe("the assistant's view of a project's notes", () => {
  it("is empty without notes", () => {
    expect(projectNotesPrompt([])).toBe("");
  });

  it("clips long summaries and squeezes their spaces", () => {
    const summary = `${"a".repeat(PROJECT_NOTE_SUMMARY_CHARS)}   tail`;
    const text = projectNotesPrompt([{ id: "n", title: "Long", updatedAt: 0, color: "mint", summary }]);
    expect(text).toContain(`1. Long (id n, last edited 1970-01-01T00:00:00.000Z): ${"a".repeat(PROJECT_NOTE_SUMMARY_CHARS)}…`);
    expect(text).not.toContain("tail");
    const short = projectNotesPrompt([{ id: "s", title: "Short", updatedAt: 0, color: "mint", summary: "One  line\nsummary" }]);
    expect(short).toContain("1. Short (id s, last edited 1970-01-01T00:00:00.000Z): One line summary");
  });
});

describe("starting a note for a project", () => {
  it("creates an untitled note linked to the project and refreshes the list", async () => {
    mocks.createNoteProject.mockResolvedValue("fresh");
    await expect(createProjectNote("paper")).resolves.toBe("fresh");
    const [name, source, related] = mocks.createNoteProject.mock.calls[0] as [string, string, string];
    expect(name).toBe(enNotes.document.untitled);
    expect(readNoteFacts(source).title).toBe(enNotes.document.untitled);
    expect(related).toBe("paper");
    expect(refreshProjects).toHaveBeenCalledOnce();
  });

  it("keeps the new note when the list cannot refresh", async () => {
    const failure = new Error("offline");
    mocks.createNoteProject.mockResolvedValue("fresh");
    refreshProjects.mockRejectedValueOnce(failure);
    await expect(createProjectNote("paper")).resolves.toBe("fresh");
    expect(mocks.logError).toHaveBeenCalledWith("refresh projects after creating a note", failure);
  });

  it("opens the new note as a tab in the project", async () => {
    mocks.createNoteProject.mockResolvedValue("fresh");
    useNoteTabsStore.setState({ tabs: [], active: null });
    await expect(startProjectNote("paper")).resolves.toBe("fresh");
    expect(useHomeViewStore.getState().page).toBe("library");
    expect(useNotesViewStore.getState().requestedNoteId).toBeNull();
    expect(useNoteTabsStore.getState().tabs.map((tab) => [tab.projectId, tab.id])).toEqual([["paper", "fresh"]]);
    expect(useNoteTabsStore.getState().active).toBe("fresh");
  });

  it("says so when the note cannot be created", async () => {
    const failure = new Error("disk full");
    mocks.createNoteProject.mockRejectedValue(failure);
    await expect(startProjectNote("paper")).resolves.toBeNull();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "create a note for this project",
      failure,
      enNotes.projectNotes.createFailed,
    );
    expect(useHomeViewStore.getState().page).toBe("library");
  });
});
