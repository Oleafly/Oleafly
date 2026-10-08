import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryRenamedEvent } from "@/store/files";
import { useFileReferencesStore } from "@/store/file-references";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  readProjectSources: vi.fn(),
  rebuildFromDisk: vi.fn(async () => {}),
  readFileContent: vi.fn(),
  writeProjectFile: vi.fn(async () => {}),
  setContent: vi.fn(() => true),
  editBackgroundDocument: vi.fn(() => true),
  getEditorView: vi.fn<() => unknown>(() => null),
  getEditorDocumentPath: vi.fn<() => string | null>(() => null),
  logError: vi.fn(),
  listeners: [] as Array<(event: EntryRenamedEvent) => void>,
}));

const filesState = {
  projectId: "p1" as string | null,
  activePath: null as string | null,
  manifestHome: "library",
  tree: [] as Array<{ path: string; is_dir: boolean }>,
  files: {} as Record<string, { content: string; dirty: boolean }>,
  setContent: mocks.setContent,
  writeProjectFile: mocks.writeProjectFile,
};

vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => filesState,
    subscribe: () => () => {},
  },
  onEntryRenamed: (listener: (event: EntryRenamedEvent) => void) => {
    mocks.listeners.push(listener);
    return () => {
      mocks.listeners.splice(mocks.listeners.indexOf(listener), 1);
    };
  },
}));
vi.mock("@/store/project-index", () => ({
  readProjectSources: mocks.readProjectSources,
  useIndexStore: { getState: () => ({ rebuildFromDisk: mocks.rebuildFromDisk, texts: {} }) },
}));
vi.mock("@/lib/tauri", () => ({ readFileContent: mocks.readFileContent }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@oleafly/editor", () => ({
  editBackgroundDocument: mocks.editBackgroundDocument,
  getEditorView: mocks.getEditorView,
  getEditorDocumentPath: mocks.getEditorDocumentPath,
}));

import {
  answerReferenceUpdate,
  applyReferencePlan,
  followRename,
  startFileReferenceUpdates,
} from "./follow-rename";

function entries(paths: readonly string[]) {
  return paths.map((path) => ({ path, is_dir: false }));
}

function renameEvent(from: string, to: string, before: readonly string[]): EntryRenamedEvent {
  const after = before.map((path) => (path === from ? to : path));
  filesState.tree = entries(after);
  return {
    projectId: "p1",
    from,
    to,
    previousTree: entries(before),
    tree: entries(after),
    previousMainDoc: "main.tex",
    mainDoc: "main.tex",
  };
}

function disk(texts: Record<string, string>) {
  mocks.readProjectSources.mockImplementation(async (_projectId: string, paths: readonly string[]) => ({
    texts: Object.fromEntries(
      paths.flatMap((path) => {
        const open = filesState.files[path];
        if (open) return [[path, open.content]];
        return texts[path] === undefined ? [] : [[path, texts[path].replaceAll("\r\n", "\n")]];
      }),
    ),
    unreadable: new Set<string>(),
  }));
  mocks.readFileContent.mockImplementation(async (_projectId: string, path: string) => texts[path]);
}

beforeEach(() => {
  filesState.projectId = "p1";
  filesState.activePath = null;
  filesState.files = {};
  mocks.getEditorView.mockReturnValue(null);
  mocks.getEditorDocumentPath.mockReturnValue(null);
  useFileReferencesStore.getState().clear();
  useSettingsStore.getState().setFileMoveReferences("ask");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("followRename", () => {
  it("stays silent when nothing points at the moved file", async () => {
    disk({ "main.tex": "\\input{chapters/a}", "chapters/a.tex": "" });
    await followRename(renameEvent("notes.txt", "old/notes.txt", ["main.tex", "chapters/a.tex", "notes.txt"]));
    expect(useFileReferencesStore.getState().queue).toEqual([]);
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("asks before touching anything when references exist", async () => {
    disk({ "main.tex": "\\input{chapters/a}\n\\include{chapters/a}", "chapters/a.tex": "" });
    await followRename(renameEvent("chapters/a.tex", "chapters/b.tex", ["main.tex", "chapters/a.tex"]));
    const [pending] = useFileReferencesStore.getState().queue;
    expect(pending).toMatchObject({ projectId: "p1", from: "chapters/a.tex", to: "chapters/b.tex" });
    expect(pending.plan.references).toBe(2);
    expect(pending.plan.files.map((file) => [file.path, file.references])).toEqual([["main.tex", 2]]);
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("updates silently when set to always", async () => {
    useSettingsStore.getState().setFileMoveReferences("always");
    disk({ "main.tex": "\\input{chapters/a}", "chapters/a.tex": "" });
    await followRename(renameEvent("chapters/a.tex", "chapters/b.tex", ["main.tex", "chapters/a.tex"]));
    expect(useFileReferencesStore.getState().queue).toEqual([]);
    expect(mocks.writeProjectFile).toHaveBeenCalledWith("p1", "main.tex", "\\input{chapters/b}", { crlf: false });
    expect(mocks.rebuildFromDisk).toHaveBeenCalled();
  });

  it("never scans when set to never", async () => {
    useSettingsStore.getState().setFileMoveReferences("never");
    disk({ "main.tex": "\\input{chapters/a}", "chapters/a.tex": "" });
    await followRename(renameEvent("chapters/a.tex", "chapters/b.tex", ["main.tex", "chapters/a.tex"]));
    expect(mocks.readProjectSources).not.toHaveBeenCalled();
    expect(useFileReferencesStore.getState().queue).toEqual([]);
  });

  it("follows renames reported by the files store once started", async () => {
    disk({ "main.tex": "\\input{chapters/a}", "chapters/a.tex": "" });
    const stop = startFileReferenceUpdates();
    expect(mocks.listeners).toHaveLength(1);
    mocks.listeners[0](renameEvent("chapters/a.tex", "chapters/b.tex", ["main.tex", "chapters/a.tex"]));
    await vi.waitFor(() => expect(useFileReferencesStore.getState().queue).toHaveLength(1));
    stop();
    expect(mocks.listeners).toHaveLength(0);
  });
});

describe("answerReferenceUpdate", () => {
  async function pendingFor(texts: Record<string, string>, before: string[]) {
    disk(texts);
    await followRename(renameEvent("figs/a.png", "figs/b.png", before));
    expect(useFileReferencesStore.getState().queue).toHaveLength(1);
  }

  it("writes closed files to disk and keeps CRLF line endings", async () => {
    await pendingFor(
      { "main.tex": "\\includegraphics{figs/a}\r\nText\r\n", "figs/a.png": "" },
      ["main.tex", "figs/a.png"],
    );
    await answerReferenceUpdate(true, false);
    expect(mocks.writeProjectFile).toHaveBeenCalledWith("p1", "main.tex", "\\includegraphics{figs/b}\nText\n", {
      crlf: true,
    });
    expect(useFileReferencesStore.getState().queue).toEqual([]);
    expect(useSettingsStore.getState().fileMoveReferences).toBe("ask");
  });

  it("edits open background buffers instead of the disk", async () => {
    filesState.files = { "chapter.tex": { content: "\\includegraphics{figs/a}", dirty: true } };
    await pendingFor({ "figs/a.png": "" }, ["chapter.tex", "figs/a.png"]);
    await answerReferenceUpdate(true, false);
    expect(mocks.setContent).toHaveBeenCalledWith("chapter.tex", "\\includegraphics{figs/b}", { bumpVersion: false });
    expect(mocks.editBackgroundDocument).toHaveBeenCalledWith("chapter.tex", "\\includegraphics{figs/a}", [
      { from: 17, to: 23, insert: "figs/b" },
    ]);
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("edits the active file through its editor so undo works", async () => {
    const dispatch = vi.fn();
    filesState.activePath = "main.tex";
    filesState.files = { "main.tex": { content: "\\includegraphics{figs/a}", dirty: false } };
    mocks.getEditorView.mockReturnValue({ dispatch, state: { doc: { toString: () => "\\includegraphics{figs/a}" } } });
    mocks.getEditorDocumentPath.mockReturnValue("main.tex");
    await pendingFor({ "figs/a.png": "" }, ["main.tex", "figs/a.png"]);
    await answerReferenceUpdate(true, false);
    expect(dispatch).toHaveBeenCalledWith({ changes: [{ from: 17, to: 23, insert: "figs/b" }] });
    expect(mocks.setContent).not.toHaveBeenCalled();
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("leaves files alone when the user declines and remembers the choice", async () => {
    await pendingFor({ "main.tex": "\\includegraphics{figs/a}", "figs/a.png": "" }, ["main.tex", "figs/a.png"]);
    await answerReferenceUpdate(false, true);
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    expect(useFileReferencesStore.getState().queue).toEqual([]);
    expect(useSettingsStore.getState().fileMoveReferences).toBe("never");
  });

  it("remembers always when the user updates and opts out of the prompt", async () => {
    await pendingFor({ "main.tex": "\\includegraphics{figs/a}", "figs/a.png": "" }, ["main.tex", "figs/a.png"]);
    await answerReferenceUpdate(true, true);
    expect(useSettingsStore.getState().fileMoveReferences).toBe("always");
  });

  it("reports files that changed after the scan instead of overwriting them", async () => {
    const texts = { "main.tex": "\\includegraphics{figs/a}", "figs/a.png": "" };
    await pendingFor(texts, ["main.tex", "figs/a.png"]);
    mocks.readFileContent.mockResolvedValue("\\includegraphics{figs/a}\nnew text");
    await answerReferenceUpdate(true, false);
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    expect(useFileReferencesStore.getState()).toMatchObject({ phase: "failed", failed: ["main.tex"] });
  });

  it("reports a failed write", async () => {
    await pendingFor({ "main.tex": "\\includegraphics{figs/a}", "figs/a.png": "" }, ["main.tex", "figs/a.png"]);
    mocks.writeProjectFile.mockRejectedValueOnce(new Error("disk full"));
    await answerReferenceUpdate(true, false);
    expect(useFileReferencesStore.getState()).toMatchObject({ phase: "failed", failed: ["main.tex"] });
  });

  it("follows a pending plan through a later rename", async () => {
    await pendingFor({ "ch/a.tex": "\\includegraphics{figs/a}", "figs/a.png": "" }, ["ch/a.tex", "figs/a.png"]);
    useSettingsStore.getState().setFileMoveReferences("never");
    await followRename(renameEvent("ch/a.tex", "ch/b.tex", ["ch/a.tex", "figs/b.png"]));
    expect(useFileReferencesStore.getState().queue[0].plan.files[0].path).toBe("ch/b.tex");
    mocks.readFileContent.mockResolvedValue("\\includegraphics{figs/a}");
    await answerReferenceUpdate(true, false);
    expect(mocks.writeProjectFile).toHaveBeenCalledWith("p1", "ch/b.tex", "\\includegraphics{figs/b}", { crlf: false });
  });
});

describe("applyReferencePlan", () => {
  it("does nothing for another project", async () => {
    filesState.projectId = "p2";
    const failed = await applyReferencePlan("p1", {
      references: 1,
      files: [{ path: "main.tex", text: "", edits: [{ from: 0, to: 0, insert: "x" }], references: 1 }],
    });
    expect(failed).toEqual(["main.tex"]);
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });
});
