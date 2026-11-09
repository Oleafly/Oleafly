import type { ProjectInfo } from "@oleafly/backend-port";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diskHash } from "@/lib/disk-hash";

const tauri = vi.hoisted(() => ({
  createNoteProject: vi.fn(),
  readFileContent: vi.fn(),
  recycleProject: vi.fn(),
}));
const files = vi.hoisted(() => ({ writeProjectFile: vi.fn() }));

vi.mock("@/lib/tauri", () => tauri);
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));
vi.mock("@/lib/shared-document-writes", () => ({ sharedDocumentLive: () => false }));

const { createNoteItems, createNotesService, noteHeadOf, noteItems, noteKnowledgeKey } = await import("./notes-service");

function project(overrides: Partial<ProjectInfo>): ProjectInfo {
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

const PROJECTS = [project({}), project({ id: "note-2", name: "Second" })];

function withHeads() {
  const deps = {
    projects: () => PROJECTS,
    refreshProjects: vi.fn(() => Promise.resolve()),
    refreshHeads: vi.fn(),
    setHead: vi.fn(),
    untitled: "Untitled",
    missing: "missing",
  };
  return { deps, notes: createNotesService(deps) };
}

beforeEach(() => {
  vi.clearAllMocks();
  files.writeProjectFile.mockResolvedValue(undefined);
});

describe("noteHeadOf", () => {
  it("keeps short text whole", () => {
    expect(noteHeadOf("short")).toBe("short");
    const ascii = "a".repeat(9000);
    expect(noteHeadOf(ascii)).toBe("a".repeat(8192));
    expect(noteHeadOf("a".repeat(8000))).toBe("a".repeat(8000));
  });

  it("cuts at the last whole character within 8 KB", () => {
    const wide = `${"a".repeat(8191)}é tail`;
    expect(noteHeadOf(wide)).toBe("a".repeat(8191));
    const emoji = `${"a".repeat(8191)}😀${"b".repeat(10)}`;
    expect(noteHeadOf(emoji)).toBe("a".repeat(8191));
    const pairAtEdge = `${"a".repeat(8191)}😀`;
    expect(noteHeadOf(pairAtEdge)).toBe("a".repeat(8191));
    const all = "é".repeat(5000);
    expect(new TextEncoder().encode(noteHeadOf(all)).length).toBe(8192);
  });
});

describe("single note heads", () => {
  it("hands the written text to the host after a save and says whether it changed", async () => {
    const { deps, notes } = withHeads();
    tauri.readFileContent.mockResolvedValue("Old.\n");
    await notes.saveNote?.("note-1", "New.\n", diskHash("Old.\n"));
    expect(deps.setHead).toHaveBeenCalledWith("note-1", "New.\n", true, noteKnowledgeKey("New.\n"));
    tauri.readFileContent.mockResolvedValue("New.\n");
    await notes.saveNote?.("note-1", "New.\n", diskHash("New.\n"));
    expect(deps.setHead).toHaveBeenLastCalledWith("note-1", "New.\n", false, noteKnowledgeKey("New.\n"));
    expect(deps.refreshHeads).not.toHaveBeenCalled();
  });

  it("sets a new note's head from its source and skips a rescan on delete", async () => {
    const { deps, notes } = withHeads();
    tauri.createNoteProject.mockResolvedValue("note-3");
    await notes.createNote?.();
    expect(deps.setHead).toHaveBeenCalledWith("note-3", expect.stringContaining("Untitled"), true, expect.any(String));
    await notes.createNoteFrom?.({ title: "Idea", body: "Body" });
    expect(deps.setHead).toHaveBeenLastCalledWith("note-3", expect.stringContaining("Idea"), true, expect.any(String));
    await notes.deleteNote?.("note-2");
    expect(tauri.recycleProject).toHaveBeenCalledWith("note-2");
    expect(deps.refreshHeads).not.toHaveBeenCalled();
  });
});

describe("noteItems reuse", () => {
  it("keeps unchanged items and the list itself when nothing changed", () => {
    const heads = new Map([
      ["note-1", "---\ntitle: Masking\nicon: lucide:atom\n---\n\nBody.\n"],
      ["note-2", "Second body.\n"],
    ]);
    const first = noteItems(PROJECTS, heads, "Ungrouped");
    expect(noteItems(PROJECTS, new Map(heads), "Ungrouped")).toBe(first);
    const edited = noteItems(PROJECTS, new Map(heads).set("note-2", "Changed body.\n"), "Ungrouped");
    expect(edited).not.toBe(first);
    expect(edited[0]).toBe(first[0]);
    expect(edited[1]).not.toBe(first[1]);
    expect(edited[1].preview).toContain("Changed body.");
    const renamed = noteItems([PROJECTS[0], { ...PROJECTS[1], name: "Renamed" }], new Map(heads).set("note-2", "Changed body.\n"), "Ungrouped");
    expect(renamed[1].title).toBe("Renamed");
    expect(noteItems([PROJECTS[1], PROJECTS[0]], heads, "Ungrouped").map((item) => item.id)).toEqual(["note-2", "note-1"]);
  });
});

describe("noteKnowledgeKey", () => {
  const note = "---\ntitle: Masking\naliases: [Mask]\ntags: [vision]\n---\n\nSee [Other](oleafly://note/abc) for #method details.\n";

  it("stays the same when only plain prose changes", () => {
    const more = `${note}\nA new paragraph with no links.\n`;
    expect(noteKnowledgeKey(more)).toBe(noteKnowledgeKey(note));
  });

  it("changes when a link, a tag, an alias or the title changes", () => {
    const key = noteKnowledgeKey(note);
    expect(noteKnowledgeKey(note.replace("oleafly://note/abc", "oleafly://note/xyz"))).not.toBe(key);
    expect(noteKnowledgeKey(note.replace("#method", "#approach"))).not.toBe(key);
    expect(noteKnowledgeKey(note.replace("[Mask]", "[Masks]"))).not.toBe(key);
    expect(noteKnowledgeKey(note.replace("title: Masking", "title: Masked"))).not.toBe(key);
    expect(noteKnowledgeKey(note.replace("for #method", "for the #method"))).not.toBe(key);
  });
});

describe("separate noteItems caches", () => {
  it("keeps each caller's list stable when another caller reads different heads", () => {
    const host = createNoteItems();
    const tab = createNoteItems();
    const heads = new Map([["note-1", "Body.\n"]]);
    const first = host(PROJECTS, heads, "Ungrouped");
    tab(PROJECTS, new Map([["note-1", "Other body.\n"]]), "No project");
    expect(host(PROJECTS, new Map(heads), "Ungrouped")).toBe(first);
  });
});
