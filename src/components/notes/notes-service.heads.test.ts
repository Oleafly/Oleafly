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
const scans = vi.hoisted(() => ({ links: 0 }));
vi.mock("./note-link-format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./note-link-format")>();
  return {
    ...actual,
    linkTargets: (markdown: string) => {
      scans.links += 1;
      return actual.linkTargets(markdown);
    },
  };
});

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

describe("knowledge keys on save", () => {
  const BASE = [
    "---",
    "title: Plan",
    "kind: note",
    "tags: [lab]",
    "---",
    "",
    "# Plan",
    "",
    "We ran the sweep on Monday.",
    "",
    "See [Other](oleafly://note/abc) for more.",
    "",
    "- first item",
    "- second item",
    "",
    "> quoted line",
    "",
    "```",
    "code line",
    "```",
    "",
    "Last line here.",
    "",
  ].join("\n");

  const EDITS: readonly (readonly [string, string])[] = [
    ["sweep on Monday", "long sweep on Monday"],
    ["on Monday.", "on Monday #results."],
    ["for more.", "for more detail."],
    ["Last line here.", "Last line here, done."],
    ["second item", "second item updated"],
    ["code line", "code line edited"],
    ["code line edited", "code [x](oleafly://note/zzz)"],
    ["quoted line", "quoted line again"],
    ["title: Plan", "title: Plans"],
    ["Last line here, done.", "Last line\nhere, done."],
    ["- first item", "first item"],
    ["We ran the long", "```\nWe ran the long"],
    ["here, done.", ""],
    ["Last line", "Last line #tagged"],
    ["# Plan", "# Plan [ref](oleafly://note/def)"],
  ];

  async function savedKeys(base: string, edits: readonly (readonly [string, string])[]) {
    const { deps, notes } = withHeads();
    tauri.readFileContent.mockResolvedValue(base);
    let text = base;
    let version = diskHash(base.replaceAll("\r\n", "\n"));
    const pairs: { sent: string; expected: string }[] = [];
    for (const [from, to] of edits) {
      expect(text).toContain(from);
      text = text.replace(from, to);
      const saved = await notes.saveNote?.("note-1", text, version);
      version = saved?.version ?? version;
      pairs.push({ sent: deps.setHead.mock.lastCall?.[3] as string, expected: noteKnowledgeKey(saved?.text ?? text) });
    }
    return pairs;
  }

  it("always hands the host the key of the text it saved", async () => {
    for (const pair of await savedKeys(BASE, EDITS)) expect(pair.sent).toBe(pair.expected);
    const crlf = BASE.replaceAll("\n", "\r\n");
    for (const pair of await savedKeys(crlf, EDITS)) expect(pair.sent).toBe(pair.expected);
  });

  it("skips the link and tag scans for an edit inside a plain line", async () => {
    const { notes } = withHeads();
    tauri.readFileContent.mockResolvedValue(BASE);
    const save = async (text: string, version: string) => {
      const before = scans.links;
      const saved = await notes.saveNote?.("note-1", text, version);
      return { version: saved?.version ?? "", scanned: scans.links - before };
    };
    const first = await save(BASE.replace("Monday", "Tuesday"), diskHash(BASE));
    expect(first.scanned).toBe(1);
    const plain = await save(BASE.replace("Monday", "Tuesday, again"), first.version);
    expect(plain.scanned).toBe(0);
    const listed = await save(BASE.replace("Monday", "Tuesday, again").replace("second item", "second step"), plain.version);
    expect(listed.scanned).toBe(0);
    const linked = await save(
      BASE.replace("Monday", "Tuesday, again").replace("second item", "second step").replace("for more", "for less"),
      listed.version,
    );
    expect(linked.scanned).toBe(1);
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
