import type { ProjectInfo } from "@oleafly/backend-port";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { frontMatterList } from "./note-tags";

const tauri = vi.hoisted(() => ({
  createNoteProject: vi.fn(),
  listNoteTags: vi.fn(),
  noteSearch: vi.fn(),
}));

vi.mock("@/lib/tauri", () => tauri);
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: vi.fn() }));
vi.mock("@/lib/research-tasks", () => ({}));
vi.mock("@/components/editor/cm/hover-asset", () => ({ loadAssetThumbnail: vi.fn() }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => ({ writeProjectFile: vi.fn() }) } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const { createNotesService, headFacts, noteItems } = await import("./notes-service");

function project(overrides: Partial<ProjectInfo>): ProjectInfo {
  return {
    id: "note-1",
    name: "Masking",
    main_doc: "note.md",
    kind: "note",
    created_at: 1,
    updated_at: 1,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...overrides,
  };
}

function service() {
  const deps = {
    projects: () => [project({})],
    refreshProjects: vi.fn(() => Promise.resolve()),
    refreshHeads: vi.fn(),
    untitled: "Untitled",
    missing: "Missing",
  };
  return { deps, notes: createNotesService(deps) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("note head facts", () => {
  const head = [
    "---",
    "title: Masking",
    "kind: note",
    "id: n-1",
    "aliases: [MAE, Masked encoder]",
    "tags: [Paper]",
    "status: draft",
    "template: true",
    "priority: 2",
    "---",
    "Body with #Inline tag.",
  ].join("\n");

  it("reads aliases, tags and user properties from the front matter", () => {
    expect(headFacts(head)).toEqual({
      aliases: ["MAE", "Masked encoder"],
      tags: ["Paper", "Inline"],
      properties: {
        aliases: ["MAE", "Masked encoder"],
        tags: ["Paper"],
        status: "draft",
        template: true,
        priority: 2,
      },
    });
  });

  it("is empty without front matter or with broken YAML", () => {
    expect(headFacts("Just text")).toEqual({ aliases: [], tags: [], properties: {} });
    expect(headFacts("---\nkey: [unclosed\n---\n").properties).toEqual({});
  });

  it("fills note items and reuses parsed heads between refreshes", () => {
    const heads = new Map([
      ["note-1", head],
      ["note-2", head],
    ]);
    const projects = [project({}), project({ id: "note-2", name: "Twin" })];
    const first = noteItems(projects, heads, "Notes");
    expect(first[0]).toMatchObject({ aliases: ["MAE", "Masked encoder"], tags: ["Paper", "Inline"] });
    expect(first[0].properties).toBe(first[1].properties);
    const second = noteItems(projects, heads, "Notes");
    expect(second[0].properties).toBe(first[0].properties);
    const third = noteItems(projects, new Map([["note-1", "---\nstatus: done\n---\n"]]), "Notes");
    expect(third[0].properties).toEqual({ status: "done" });
    expect(third[1].properties).toEqual({});
  });
});

describe("vault service calls", () => {
  it("creates a note from a draft with its properties, tags and related project", async () => {
    tauri.createNoteProject.mockResolvedValue("created");
    const { deps, notes } = service();
    await expect(
      notes.createNoteFrom?.({ title: "  Plan  ", body: "Body", properties: "status: draft", tags: ["ml"], relatedProject: "p1" }),
    ).resolves.toBe("created");
    const [title, source, related] = tauri.createNoteProject.mock.calls[0] as [string, string, string | null];
    expect(title).toBe("Plan");
    expect(related).toBe("p1");
    expect(source).toMatch(/^---\ntitle: Plan\n[\s\S]*status: draft\ntags: \[ml\]\n---\n\nBody$/u);
    expect(frontMatterList(source, "tags")).toEqual(["ml"]);
    expect(deps.refreshProjects).toHaveBeenCalled();
    expect(deps.refreshHeads).toHaveBeenCalled();
  });

  it("starts a note from a template with the template's icon and colour instead of the starter ones", async () => {
    tauri.createNoteProject.mockResolvedValue("from-template");
    const { notes } = service();
    await notes.createNoteFrom?.({ title: "Run 4", body: "Body", icon: "lucide:flask-conical", color: "mint" });
    const [, source] = tauri.createNoteProject.mock.calls[0] as [string, string, string | null];
    expect(source).toMatch(/^icon: lucide:flask-conical$/mu);
    expect(source).toMatch(/^color: mint$/mu);
    expect(source.match(/^icon: /gmu)).toHaveLength(1);
    expect(source.match(/^color: /gmu)).toHaveLength(1);
  });

  it("names an untitled note and leaves the related project empty", async () => {
    tauri.createNoteProject.mockResolvedValue("blank");
    const { notes } = service();
    await notes.createNoteFrom?.({ title: " " });
    const [title, source, related] = tauri.createNoteProject.mock.calls[0] as [string, string, string | null];
    expect(title).toBe("Untitled");
    expect(source).toContain("title: Untitled");
    expect(related).toBeNull();
  });

  it("passes searches and tag listing to the backend and refreshes notes", async () => {
    tauri.noteSearch.mockResolvedValue([]);
    tauri.listNoteTags.mockResolvedValue([{ tag: "ml", label: "ml", count: 1, notes: ["a"] }]);
    const { deps, notes } = service();
    await expect(notes.searchNotes?.("mask", 5)).resolves.toEqual([]);
    expect(tauri.noteSearch).toHaveBeenCalledWith("mask", 5);
    await expect(notes.noteTags?.()).resolves.toHaveLength(1);
    await notes.refreshNotes?.();
    expect(deps.refreshProjects).toHaveBeenCalled();
    expect(deps.refreshHeads).toHaveBeenCalled();
  });
});
