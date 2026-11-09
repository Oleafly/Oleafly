import type { ProjectInfo } from "@oleafly/backend-port";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

const mocks = vi.hoisted(() => ({
  createNoteProject: vi.fn<(name: string, source: string, related?: string | null) => Promise<string>>(),
  listFiles: vi.fn(),
  readFileBase64: vi.fn(async (projectId: string, path: string) =>
    path.endsWith("kept-00000000.csv") ? "b64:same" : `b64:${projectId}:${path}`,
  ),
  readFileContent: vi.fn(),
  recycleProject: vi.fn(async () => {}),
  writeProjectBytes: vi.fn(async (_projectId: string, _path: string, _data: string) => ({ generation: 1 })),
  notifyError: vi.fn(),
  success: vi.fn(),
  askInApp: vi.fn(),
  flushOpenNotes: vi.fn(async () => []),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  createNoteProject: mocks.createNoteProject,
  listFiles: mocks.listFiles,
  readFileBase64: mocks.readFileBase64,
  readFileContent: mocks.readFileContent,
  recycleProject: mocks.recycleProject,
  writeProjectBytes: mocks.writeProjectBytes,
}));
vi.mock("@/lib/toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/toast")>();
  return { ...actual, notifyError: mocks.notifyError, toast: { ...actual.toast, success: mocks.success } };
});
vi.mock("@/store/confirm-dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/confirm-dialog")>()),
  askInApp: mocks.askInApp,
}));
vi.mock("@/lib/open-note-editors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/open-note-editors")>()),
  flushOpenNotes: mocks.flushOpenNotes,
}));

import { registerNoteEditor } from "@/lib/open-note-editors";
import { noteEditorHandle } from "@/lib/tests/open-note-editor-fixtures";
import { useFilesStore } from "@/store/files";
import { useNoteTabsStore } from "@/store/note-tabs";
import {
  relinkAssets,
  copyProjectNoteToMine,
  createProjectNoteFile,
  moveNoteIntoProject,
  openPersonalNoteTab,
  renameProjectNote,
} from "./project-note-actions";

const NOTE_PROJECT: ProjectInfo = {
  id: "mine",
  name: "Reading list",
  main_doc: "note.md",
  kind: "note",
  created_at: 1,
  updated_at: 2,
  has_preview: false,
  exports: [],
  forked_from: null,
  recovery_pending: false,
  related_project: "paper",
};
const PROJECT_NOTE = "---\ntitle: Lab plan\nkind: note\nid: old-id\n---\n\n![fig](assets/fig-1a2b3c4d.png)\n";
const PERSONAL_NOTE =
  "---\ntitle: Reading list\nkind: note\nid: n1\n---\n\nBody\n\n![fig](assets/fig-1a2b3c4d.png)\n\n[data](./assets/kept-00000000.csv)\n";

let writeProjectFile = vi.fn(async (_projectId: string, _path: string, _content: string) => {});
let openFile = vi.fn(async (_path: string) => {});
let refreshProjects = vi.fn(async () => {});

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  vi.clearAllMocks();
  writeProjectFile = vi.fn(async () => {});
  openFile = vi.fn(async () => {});
  refreshProjects = vi.fn(async () => {});
  mocks.askInApp.mockResolvedValue(true);
  mocks.createNoteProject.mockResolvedValue("copy");
  mocks.readFileContent.mockResolvedValue(PERSONAL_NOTE);
  mocks.listFiles.mockResolvedValue([
    { path: "note.md", is_dir: false },
    { path: "assets", is_dir: true },
    { path: "assets/fig-1a2b3c4d.png", is_dir: false },
    { path: "assets/origins/fig-1a2b3c4d.png.json", is_dir: false },
    { path: "assets/kept-00000000.csv", is_dir: false },
  ]);
  useFilesStore.setState({
    projectId: "paper",
    projectName: "Paper",
    projects: [NOTE_PROJECT],
    tree: [
      { path: "main.tex", is_dir: false },
      { path: "notes/Reading list.md", is_dir: false },
      { path: "notes/Plan.md", is_dir: false },
      { path: "notes/assets/kept-00000000.csv", is_dir: false },
      { path: "notes/assets/fig-1a2b3c4d.png", is_dir: false },
      { path: "notes/assets/origins/fig-1a2b3c4d.png.json", is_dir: false },
      { path: "notes/assets/unused-ffffffff.png", is_dir: false },
    ],
    files: {},
    writeProjectFile,
    openFile,
    refreshProjects,
  });
  useNoteTabsStore.setState({ tabs: [], active: null, markdown: {} });
});

describe("creating project notes", () => {
  it("writes a titled note under notes/ and opens it", async () => {
    await expect(createProjectNoteFile("paper", " Plan ")).resolves.toBe("notes/Plan-2.md");
    expect(writeProjectFile).toHaveBeenCalledWith("paper", "notes/Plan-2.md", expect.stringContaining("title: Plan"));
    expect(writeProjectFile.mock.calls[0][2]).toContain("kind: note");
    expect(openFile).toHaveBeenCalledWith("notes/Plan-2.md");
  });

  it("names an empty title Untitled", async () => {
    await expect(createProjectNoteFile("paper", "")).resolves.toBe(`notes/${enNotes.document.untitled}.md`);
  });

  it("does nothing for a project that is not open and reports write failures", async () => {
    await expect(createProjectNoteFile("thesis", "Plan")).resolves.toBeNull();
    const failure = new Error("read only");
    writeProjectFile.mockRejectedValueOnce(failure);
    await expect(createProjectNoteFile("paper", "Plan")).resolves.toBeNull();
    expect(mocks.notifyError).toHaveBeenCalledWith("create a project note", failure, enNotes.projectNotes.createFailed);
  });

  it("opens personal note tabs", () => {
    openPersonalNoteTab("paper", "mine", { icon: "lucide:atom" });
    expect(useNoteTabsStore.getState().tabs[0]).toMatchObject({ id: "mine", projectId: "paper", icon: "lucide:atom" });
  });
});

describe("moving a personal note into the project", () => {
  it("asks first, copies the note and its assets, trashes the personal copy and opens the file", async () => {
    useFilesStore.setState((state) => ({ tree: state.tree.filter((entry) => !entry.path.includes("fig-1a2b3c4d")) }));
    openPersonalNoteTab("paper", "mine");
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBe("notes/Reading list-2.md");
    expect(mocks.askInApp).toHaveBeenCalledWith({
      title: enNotes.projectNotes.moveTitle,
      message: enNotes.projectNotes.moveMessage.replace("{{project}}", "Paper"),
      confirmLabel: enNotes.projectNotes.moveConfirm,
    });
    expect(mocks.flushOpenNotes).toHaveBeenCalled();
    expect(mocks.writeProjectBytes.mock.calls.map((call) => call[1])).toEqual(["notes/assets/fig-1a2b3c4d.png"]);
    expect(mocks.writeProjectBytes).toHaveBeenCalledWith(
      "paper",
      "notes/assets/fig-1a2b3c4d.png",
      "b64:mine:assets/fig-1a2b3c4d.png",
    );
    expect(writeProjectFile).toHaveBeenCalledWith("paper", "notes/Reading list-2.md", expect.stringContaining("Body"));
    expect(mocks.recycleProject).toHaveBeenCalledWith("mine");
    expect(useNoteTabsStore.getState().tabs).toEqual([]);
    expect(refreshProjects).toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledWith("notes/Reading list-2.md");
    expect(mocks.success).toHaveBeenCalledWith(enNotes.projectNotes.moved.replace("{{title}}", "Reading list"));
  });

  it("copies a different file that shares a name under a free name and relinks the note to it", async () => {
    mocks.readFileContent.mockResolvedValue(
      "---\ntitle: Reading list\nkind: note\nid: n1\n---\n\n![fig](assets/fig-1a2b3c4d.png) and assets/fig-1a2b3c4d.png.bak\n",
    );
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBe("notes/Reading list-2.md");
    expect(mocks.writeProjectBytes.mock.calls.map((call) => call[1])).toEqual(["notes/assets/fig-1a2b3c4d-2.png"]);
    expect(writeProjectFile).toHaveBeenCalledWith(
      "paper",
      "notes/Reading list-2.md",
      expect.stringContaining("![fig](assets/fig-1a2b3c4d-2.png) and assets/fig-1a2b3c4d.png.bak"),
    );
  });

  it("relinks several renamed assets at once", () => {
    const renames = new Map([
      ["assets/x.png", "assets/x-2.png"],
      ["assets/x-2.png", "assets/x-2-2.png"],
      ["assets/a(1).png", "assets/a(1)-2.png"],
    ]);
    expect(relinkAssets("![](assets/x.png) ![](assets/x-2.png) ![](assets/a(1).png) myassets/x.png", renames)).toBe(
      "![](assets/x-2.png) ![](assets/x-2-2.png) ![](assets/a(1)-2.png) myassets/x.png",
    );
    expect(relinkAssets("same", new Map())).toBe("same");
  });

  it("relinks assets written with a leading ./ and leaves other folders alone", () => {
    const renames = new Map([["assets/x.png", "assets/x-2.png"]]);
    expect(relinkAssets("![](./assets/x.png) <./assets/x.png> ../assets/x.png a./assets/x.png", renames)).toBe(
      "![](./assets/x-2.png) <./assets/x-2.png> ../assets/x.png a./assets/x.png",
    );
  });

  it("copies only the assets the note still uses", async () => {
    mocks.readFileContent.mockResolvedValue("---\ntitle: Reading list\nkind: note\n---\n\n![fig](assets/fig-1a2b3c4d.png)\n");
    useFilesStore.setState({ tree: [{ path: "main.tex", is_dir: false }] });
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBe("notes/Reading list.md");
    expect(mocks.writeProjectBytes.mock.calls.map((call) => call[1])).toEqual(["notes/assets/fig-1a2b3c4d.png"]);
    expect(mocks.readFileBase64).not.toHaveBeenCalledWith("mine", "assets/kept-00000000.csv");
  });

  it("uses the project name when the note has no title", async () => {
    mocks.readFileContent.mockResolvedValue("Just text\n");
    useFilesStore.setState({ projects: [{ ...NOTE_PROJECT, main_doc: "" }] });
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBe("notes/Reading list-2.md");
    expect(mocks.readFileContent).toHaveBeenCalledWith("mine", "note.md");
  });

  it("stops when the person says no or the note or project is gone", async () => {
    mocks.askInApp.mockResolvedValueOnce(false);
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBeNull();
    await expect(moveNoteIntoProject("missing", "paper")).resolves.toBeNull();
    await expect(moveNoteIntoProject("mine", "thesis")).resolves.toBeNull();
    expect(mocks.recycleProject).not.toHaveBeenCalled();
  });

  it("stops when the project closes while it reads the note", async () => {
    mocks.readFileContent.mockImplementationOnce(async () => {
      useFilesStore.setState({ projectId: "thesis" });
      return "text";
    });
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBeNull();
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("stops before copying anything when open notes cannot be saved", async () => {
    mocks.flushOpenNotes.mockResolvedValueOnce([{ path: "Reading list", reason: "Disk full." }] as never);
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBeNull();
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(mocks.recycleProject).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "move a note into the project",
      expect.any(Error),
      `${enNotes.projectNotes.moveUnsaved} Disk full.`,
    );
  });

  it("keeps the personal note when its last edits cannot be saved after the copy", async () => {
    mocks.flushOpenNotes.mockResolvedValueOnce([]).mockResolvedValueOnce([{ path: "Reading list", reason: "Disk full." }] as never);
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBeNull();
    expect(mocks.recycleProject).not.toHaveBeenCalled();
  });

  it("copies edits typed while it was moving before the personal note goes to the trash", async () => {
    mocks.readFileContent
      .mockResolvedValueOnce("---\ntitle: Reading list\nkind: note\n---\n\nBody\n")
      .mockResolvedValueOnce("---\ntitle: Reading list\nkind: note\n---\n\nBody, and more\n");
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBe("notes/Reading list-2.md");
    expect(mocks.flushOpenNotes).toHaveBeenCalledTimes(2);
    expect(writeProjectFile).toHaveBeenLastCalledWith("paper", "notes/Reading list-2.md", expect.stringContaining("Body, and more"));
    expect(writeProjectFile.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.recycleProject.mock.invocationCallOrder[0]);
  });

  it("writes into an existing Notes folder whatever its case", async () => {
    useFilesStore.setState({ tree: [{ path: "Notes", is_dir: true }, { path: "Notes/Plan.md", is_dir: false }] });
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBe("Notes/Reading list.md");
    expect(mocks.writeProjectBytes.mock.calls.map((call) => call[1])).toEqual([
      "Notes/assets/fig-1a2b3c4d.png",
      "Notes/assets/kept-00000000.csv",
    ]);
  });

  it("keeps the personal note when the copy fails", async () => {
    const failure = new Error("disk full");
    writeProjectFile.mockRejectedValueOnce(failure);
    await expect(moveNoteIntoProject("mine", "paper")).resolves.toBeNull();
    expect(mocks.recycleProject).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith("move a note into the project", failure, enNotes.projectNotes.moveFailed);
  });
});

describe("copying a project note to my notes", () => {
  it("creates a linked personal note with a new id and the assets it uses", async () => {
    mocks.readFileContent.mockResolvedValue(PROJECT_NOTE);
    await expect(copyProjectNoteToMine("paper", "notes/Plan.md")).resolves.toBe("copy");
    const [title, source, related] = mocks.createNoteProject.mock.calls[0];
    expect(title).toBe("Lab plan");
    expect(related).toBe("paper");
    expect(source).not.toContain("old-id");
    expect(source).toContain("kind: note");
    expect(mocks.writeProjectBytes.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ["copy", "assets/fig-1a2b3c4d.png"],
      ["copy", "assets/origins/fig-1a2b3c4d.png.json"],
    ]);
    expect(useNoteTabsStore.getState().active).toBe("copy");
    expect(mocks.success).toHaveBeenCalledWith(enNotes.projectNotes.copied.replace("{{title}}", "Lab plan"));
  });

  it("saves open notes first, then copies the text they saved, and makes one copy for a double click", async () => {
    mocks.flushOpenNotes.mockImplementationOnce(async () => {
      useFilesStore.setState({ files: { "notes/Plan.md": { content: "---\nkind: note\ntitle: Saved\n---\nNew", dirty: false } } });
      return [];
    });
    const [first, second] = [copyProjectNoteToMine("paper", "notes/Plan.md"), copyProjectNoteToMine("paper", "notes/Plan.md")];
    await expect(first).resolves.toBe("copy");
    await expect(second).resolves.toBeNull();
    expect(mocks.createNoteProject).toHaveBeenCalledOnce();
    expect(mocks.createNoteProject.mock.calls[0][0]).toBe("Saved");
  });

  it("does not copy when open notes cannot be saved", async () => {
    mocks.flushOpenNotes.mockResolvedValueOnce([{ path: "Plan", reason: "Read-only." }] as never);
    await expect(copyProjectNoteToMine("paper", "notes/Plan.md")).resolves.toBeNull();
    expect(mocks.createNoteProject).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "copy a project note to my notes",
      expect.any(Error),
      `${enNotes.projectNotes.copyUnsaved} Read-only.`,
    );
  });

  it("copies what the open editor shows, even before the project file catches up", async () => {
    useFilesStore.setState({ files: { "notes/Plan.md": { content: PROJECT_NOTE, dirty: false } } });
    const stop = registerNoteEditor(
      "project-note:paper:notes/Plan.md",
      noteEditorHandle({ text: () => "---\ntitle: Live plan\nkind: note\n---\n\nTyped just now\n" }),
    );
    try {
      await copyProjectNoteToMine("paper", "notes/Plan.md");
    } finally {
      stop();
    }
    const [title, source] = mocks.createNoteProject.mock.calls[0];
    expect(title).toBe("Live plan");
    expect(source).toContain("Typed just now");
  });

  it("prefers the open file's text and falls back to the file name", async () => {
    useFilesStore.setState({ files: { "notes/Plan.md": { content: "---\nkind: note\n---\nBody", dirty: true } } });
    await copyProjectNoteToMine("paper", "notes/Plan.md");
    expect(mocks.readFileContent).not.toHaveBeenCalled();
    expect(mocks.createNoteProject.mock.calls[0][0]).toBe("Plan");
    expect(mocks.writeProjectBytes).not.toHaveBeenCalled();
  });

  it("does nothing for a closed project and reports failures", async () => {
    await expect(copyProjectNoteToMine("thesis", "notes/Plan.md")).resolves.toBeNull();
    const failure = new Error("offline");
    mocks.readFileContent.mockRejectedValueOnce(failure);
    await expect(copyProjectNoteToMine("paper", "notes/Plan.md")).resolves.toBeNull();
    expect(mocks.notifyError).toHaveBeenCalledWith("copy a project note to my notes", failure, enNotes.projectNotes.copyFailed);
  });
});

describe("renaming a project note", () => {
  it("changes the title and moves the file next to where it was", async () => {
    const renameEntry = vi.fn(async (_from: string, to: string) => to);
    useFilesStore.setState({ files: { "notes/Plan.md": { content: PROJECT_NOTE, dirty: false } }, renameEntry } as never);
    await expect(renameProjectNote("paper", "notes/Plan.md", " Results ")).resolves.toBe("notes/Results.md");
    expect(writeProjectFile).toHaveBeenCalledWith("paper", "notes/Plan.md", expect.stringContaining("title: Results"), {
      base: PROJECT_NOTE,
    });
    expect(renameEntry).toHaveBeenCalledWith("notes/Plan.md", "notes/Results.md");
  });

  it("renames from the open editor's text and writes it with that text as the base", async () => {
    const renameEntry = vi.fn(async (_from: string, to: string) => to);
    useFilesStore.setState({ files: { "notes/Plan.md": { content: PROJECT_NOTE, dirty: false } }, renameEntry } as never);
    const live = "---\ntitle: Lab plan\nkind: note\n---\n\nLatest line\n";
    const stop = registerNoteEditor("project-note:paper:notes/Plan.md", noteEditorHandle({ text: () => live }));
    try {
      await renameProjectNote("paper", "notes/Plan.md", "Results");
    } finally {
      stop();
    }
    const [, , written, options] = writeProjectFile.mock.calls[0] as unknown as [string, string, string, object];
    expect(written).toContain("Latest line");
    expect(written).toContain("title: Results");
    expect(options).toEqual({ base: live });
  });

  it("keeps the file name when it already fits and ignores empty titles", async () => {
    const renameEntry = vi.fn(async (_from: string, to: string) => to);
    useFilesStore.setState({ files: { "notes/Plan.md": { content: PROJECT_NOTE, dirty: false } }, renameEntry } as never);
    await expect(renameProjectNote("paper", "notes/Plan.md", "Plan")).resolves.toBe("notes/Plan.md");
    expect(renameEntry).not.toHaveBeenCalled();
    await expect(renameProjectNote("paper", "notes/Plan.md", "  ")).resolves.toBeNull();
    await expect(renameProjectNote("thesis", "notes/Plan.md", "X")).resolves.toBeNull();
  });

  it("reports a rename that fails", async () => {
    const failure = new Error("locked");
    useFilesStore.setState({
      files: { "notes/Plan.md": { content: PROJECT_NOTE, dirty: false } },
      renameEntry: vi.fn(async () => {
        throw failure;
      }),
    } as never);
    await expect(renameProjectNote("paper", "notes/Plan.md", "Results")).resolves.toBeNull();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "rename a project note",
      failure,
      enNotes.library.menu.renameFailed.replace("{{name}}", "Results"),
    );
  });
});
