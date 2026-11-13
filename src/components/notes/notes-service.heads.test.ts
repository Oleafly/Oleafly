// @vitest-environment jsdom
import type { ProjectInfo } from "@oleafly/backend-port";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appQueryClient } from "@/lib/query";
import type { NoteFacts } from "@/lib/tauri";
import { NoteConflictError } from "./types";

const tauri = vi.hoisted(() => ({
  createNoteProject: vi.fn(),
  listFiles: vi.fn(),
  noteFacts: vi.fn(),
  readFileBase64: vi.fn(),
  readFileContent: vi.fn(),
  recycleProject: vi.fn(),
  writeProjectBytes: vi.fn(),
}));
const files = vi.hoisted(() => ({ writeProjectFile: vi.fn() }));
const leftovers = vi.hoisted(() => ({ forgetNoteLeftovers: vi.fn() }));

vi.mock("@/lib/tauri", () => tauri);
vi.mock("@/store/files", () => ({
  isDiskConflict: (error: unknown) => String(error).includes("file changed on disk"),
  useFilesStore: { getState: () => files },
}));
vi.mock("@/lib/shared-document-writes", () => ({ sharedDocumentLive: () => false }));
vi.mock("./note-pending-suggestions", () => leftovers);

const { createNoteItems, createNotesService, useVaultFacts } = await import("./notes-service");

function project(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "note-1",
    name: "Masking",
    main_doc: "note.md",
    kind: "note",
    created_at: 1,
    updated_at: 1_700_000_000,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...overrides,
  };
}

function fact(id: string, knowledge: string, overrides: Partial<NoteFacts> = {}): NoteFacts {
  return {
    id,
    noteId: `n-${id}`,
    title: id,
    icon: null,
    color: null,
    agent: null,
    tags: [],
    aliases: [],
    properties: {},
    preview: "",
    relatedProject: null,
    updatedAt: 1,
    knowledge,
    taskDigest: `t-${id}`,
    ...overrides,
  };
}

const PROJECTS = [project({ id: "a", name: "A" }), project({ id: "b", name: "B" })];

function service() {
  const deps = { projects: () => PROJECTS, refreshProjects: vi.fn(() => Promise.resolve()), untitled: "Untitled", missing: "Missing" };
  return { deps, notes: createNotesService(deps) };
}

function diskFile(initial: string): { write: (text: string) => void } {
  let text = initial;
  files.writeProjectFile.mockImplementation((_id: string, _path: string, next: string) => {
    text = next;
    return Promise.resolve();
  });
  tauri.readFileContent.mockImplementation(() => Promise.resolve(text));
  return {
    write: (next) => {
      text = next;
    },
  };
}

async function loadedVault() {
  tauri.noteFacts.mockResolvedValueOnce([fact("a", "k1"), fact("b", "k2")]);
  const { result } = renderHook(() => useVaultFacts(PROJECTS));
  await waitFor(() => expect(result.current.vault?.facts).toHaveLength(2));
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  appQueryClient().clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vault facts", () => {
  it("patches the facts of a saved note and moves the revision only when what links and tags see changed", async () => {
    const result = await loadedVault();
    const first = result.current.vault;
    diskFile("Old.\n");
    const { notes } = service();

    tauri.noteFacts.mockResolvedValueOnce([fact("a", "k1", { preview: "New." })]);
    await notes.saveNote("a", "New.\n", (await notes.loadNote("a")).version);
    await waitFor(() => expect(result.current.vault?.facts[0].preview).toBe("New."));
    expect(tauri.noteFacts).toHaveBeenLastCalledWith({ ids: ["a"] });
    expect(result.current.vault?.revision).toBe(first?.revision);
    expect(result.current.vault?.taskRevision).toBe(first?.taskRevision);
    expect(result.current.vault?.facts[1]).toBe(first?.facts[1]);

    tauri.noteFacts.mockResolvedValueOnce([fact("a", "k3")]);
    await notes.saveNote("a", "[[B]]\n", (await notes.loadNote("a")).version);
    await waitFor(() => expect(result.current.vault?.changed).toEqual(["a"]));
    expect(result.current.vault?.revision).toBeGreaterThan(first?.revision ?? 0);
  });

  it("moves only the task revision when a save changes a note's tasks and not its links or tags", async () => {
    const result = await loadedVault();
    const first = result.current.vault;
    diskFile("- [ ] Ship\n");
    const { notes } = service();

    tauri.noteFacts.mockResolvedValueOnce([fact("a", "k1", { taskDigest: "t-due" })]);
    await notes.saveNote("a", "- [ ] Ship [due:: 2026-11-12]\n", (await notes.loadNote("a")).version);
    await waitFor(() => expect(result.current.vault?.taskRevision).toBeGreaterThan(first?.taskRevision ?? 0));
    expect(result.current.vault?.revision).toBe(first?.revision);
    expect(result.current.vault?.changed).toBe(first?.changed);
    const moved = result.current.vault?.taskRevision;

    tauri.noteFacts.mockResolvedValueOnce([fact("a", "k5", { taskDigest: "t-due", tags: ["lab"] })]);
    await notes.saveNote("a", "#lab\n- [ ] Ship [due:: 2026-11-12]\n", (await notes.loadNote("a")).version);
    await waitFor(() => expect(result.current.vault?.changed).toEqual(["a"]));
    expect(result.current.vault?.revision).toBeGreaterThan(first?.revision ?? 0);
    expect(result.current.vault?.taskRevision).toBe(moved);
  });

  it("reads a note's facts again when a load finds its file changed outside the app", async () => {
    const result = await loadedVault();
    const first = result.current.vault;
    const file = diskFile("- [ ] Ship\n");
    const { notes } = service();
    await notes.loadNote("a");
    await notes.loadNote("a");
    expect(tauri.noteFacts).toHaveBeenCalledTimes(1);

    file.write("- [ ] Ship [due:: 2026-11-12]\n");
    tauri.noteFacts.mockResolvedValueOnce([fact("a", "k1", { taskDigest: "t-due" })]);
    await notes.loadNote("a");
    await waitFor(() => expect(result.current.vault?.taskRevision).toBeGreaterThan(first?.taskRevision ?? 0));
    expect(tauri.noteFacts).toHaveBeenLastCalledWith({ ids: ["a"] });
    expect(result.current.vault?.revision).toBe(first?.revision);
  });

  it("reads a note's facts again when a save finds its file changed outside the app", async () => {
    const result = await loadedVault();
    const first = result.current.vault;
    const file = diskFile("- [ ] Ship\n");
    const { notes } = service();
    const { version } = await notes.loadNote("a");

    file.write("- [ ] Ship [due:: 2026-11-12]\n");
    files.writeProjectFile.mockRejectedValueOnce(new Error("file changed on disk: note.md"));
    tauri.noteFacts.mockResolvedValueOnce([fact("a", "k1", { taskDigest: "t-due" })]);
    await expect(notes.saveNote("a", "- [x] Ship\n", version)).rejects.toBeInstanceOf(NoteConflictError);
    await waitFor(() => expect(result.current.vault?.taskRevision).toBeGreaterThan(first?.taskRevision ?? 0));
    expect(tauri.noteFacts).toHaveBeenLastCalledWith({ ids: ["a"] });
  });

  it("adds a new note's facts and forgets a deleted note's leftovers", async () => {
    const result = await loadedVault();
    tauri.createNoteProject.mockResolvedValue("c");
    tauri.recycleProject.mockResolvedValue(undefined);
    tauri.noteFacts.mockResolvedValueOnce([fact("c", "k4")]);
    const { notes } = service();
    await expect(notes.createNote?.()).resolves.toBe("c");
    await waitFor(() => expect(result.current.vault?.facts.map((entry) => entry.id)).toEqual(["a", "b", "c"]));
    expect(result.current.vault?.changed).toEqual(["c"]);
    await notes.deleteNote?.("b");
    expect(leftovers.forgetNoteLeftovers).toHaveBeenCalledWith("b");
  });

  it("copies a note with a new id, its title and its attachments", async () => {
    tauri.readFileContent.mockResolvedValue("---\ntitle: A\nid: old-id\n---\n\n![x](assets/x.png)\n");
    tauri.createNoteProject.mockResolvedValue("copy");
    tauri.listFiles.mockResolvedValue([{ path: "assets/x.png", is_dir: false }, { path: "note.md", is_dir: false }]);
    tauri.readFileBase64.mockResolvedValue("AAAA");
    vi.spyOn(crypto, "randomUUID").mockReturnValue("6f1c2b7e-3d4a-4e5f-9a8b-0c1d2e3f4a5b");
    const { notes } = service();
    await expect(notes.duplicateNote?.("a", "A copy")).resolves.toBe("copy");
    expect(tauri.createNoteProject).toHaveBeenCalledWith(
      "A copy",
      "---\ntitle: A copy\nid: 6f1c2b7e-3d4a-4e5f-9a8b-0c1d2e3f4a5b\n---\n\n![x](assets/x.png)\n",
      null,
    );
    expect(tauri.writeProjectBytes).toHaveBeenCalledExactlyOnceWith("copy", "assets/x.png", "AAAA");
  });

  it("reloads every fact when a note is added, renamed or removed outside a save", async () => {
    tauri.noteFacts.mockResolvedValueOnce([fact("a", "k1"), fact("b", "k2")]).mockResolvedValueOnce([fact("a", "k1")]);
    const { result, rerender } = renderHook(({ projects }) => useVaultFacts(projects), { initialProps: { projects: PROJECTS } });
    await waitFor(() => expect(result.current.vault?.facts).toHaveLength(2));
    rerender({ projects: PROJECTS.slice(0, 1) });
    await waitFor(() => expect(result.current.vault?.changed).toEqual(["b"]));
    expect(tauri.noteFacts).toHaveBeenLastCalledWith();
  });
});

describe("note items", () => {
  it("keeps each unchanged item and the list itself when nothing changed", () => {
    const items = createNoteItems();
    const facts = [fact("a", "k1", { color: "Rose", agent: "Codex", tags: ["ml"] }), fact("b", "k2")];
    const first = items(PROJECTS, facts, "Notes");
    expect(first[0]).toMatchObject({ id: "a", noteId: "n-a", color: "rose", author: "agent", tags: ["ml"] });
    expect(items(PROJECTS, facts, "Notes")).toBe(first);
    const next = items(PROJECTS, [facts[0], fact("b", "k5")], "Notes");
    expect(next).not.toBe(first);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
  });

  it("keeps each caller's list stable when another caller reads different facts", () => {
    const one = createNoteItems();
    const two = createNoteItems();
    const facts = [fact("a", "k1"), fact("b", "k2")];
    const first = one(PROJECTS, facts, "Notes");
    two(PROJECTS, [fact("a", "k9")], "Notes");
    expect(one(PROJECTS, facts, "Notes")).toBe(first);
  });
});
