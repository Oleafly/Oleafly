import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFileContent: vi.fn(),
  loadAssetThumbnail: vi.fn(async (_projectId: string, path: string) => `thumb:${path}`),
  notebookUrl: vi.fn(async (_projectId: string, path: string) => `notebook:${path}`),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readFileContent: mocks.readFileContent,
}));
vi.mock("@/components/editor/cm/hover-asset", () => ({ loadAssetThumbnail: mocks.loadAssetThumbnail }));
vi.mock("./notes-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./notes-service")>()),
  notebookUrl: mocks.notebookUrl,
}));

import { useFilesStore } from "@/store/files";
import { noteVersion } from "./notes-service";
import { createProjectNoteFiles, ProjectNoteWriteRefused } from "./project-note-data";
import { NoteConflictError } from "./types";

const PATH = "notes/Plan.md";
const KEY = "project-note:paper:p1";
const TEXT = "---\nkind: note\n---\n\nOne\n";

const others = {
  loadNote: vi.fn(async (id: string) => ({ text: `other ${id}`, version: "v" })),
  saveNote: vi.fn(async (_id: string, text: string) => ({ text, version: "w" })),
  watchNote: vi.fn((_id: string, _change: () => void) => () => {}),
  resolveAsset: vi.fn(async (id: string, path: string) => `${id}/${path}`),
  noteTextChanged: vi.fn(),
};

let setContent = vi.fn((_path: string, _content: string, _options?: { base?: string }) => true);
let saveFile = vi.fn(async (_path: string) => {});
let writeProjectFile = vi.fn(async (_projectId: string, _path: string, _content: string, _options?: object) => {});

function files() {
  return createProjectNoteFiles({ projectId: "paper", path: PATH }, { key: KEY, others: () => others, refused: () => "read only" });
}

beforeEach(() => {
  vi.clearAllMocks();
  setContent = vi.fn(() => true);
  saveFile = vi.fn(async () => {});
  writeProjectFile = vi.fn(async () => {});
  mocks.readFileContent.mockResolvedValue("disk\r\ntext");
  useFilesStore.setState({
    projectId: "paper",
    files: { [PATH]: { content: TEXT, dirty: false } },
    setContent,
    saveFile,
    writeProjectFile,
  });
});

describe("project note files", () => {
  it("loads the open file from the project and other notes from the library", async () => {
    const data = files();
    await expect(data.loadNote(KEY)).resolves.toEqual({ text: TEXT, version: noteVersion(TEXT) });
    await expect(data.loadNote("lib")).resolves.toEqual({ text: "other lib", version: "v" });
    useFilesStore.setState({ files: {} });
    await expect(data.loadNote(KEY)).resolves.toEqual({ text: "disk\ntext", version: noteVersion("disk\ntext") });
  });

  it("saves through the files store and remembers its own write", async () => {
    const data = files();
    const changed = vi.fn();
    const stop = data.watchNote(KEY, changed);
    const saved = await data.saveNote(KEY, "new\r\nbody", noteVersion(TEXT));
    expect(saved).toEqual({ text: "new\nbody", version: noteVersion("new\nbody") });
    expect(setContent).toHaveBeenCalledWith(PATH, "new\nbody");
    expect(saveFile).toHaveBeenCalledWith(PATH);
    useFilesStore.setState({ files: { [PATH]: { content: "new\nbody", dirty: false } } });
    expect(changed).not.toHaveBeenCalled();
    useFilesStore.setState({ files: { [PATH]: { content: "from disk", dirty: false } } });
    expect(changed).toHaveBeenCalledOnce();
    useFilesStore.setState({ projectId: "other", files: { [PATH]: { content: "elsewhere", dirty: false } } });
    useFilesStore.setState({ projectId: "paper", files: {} });
    expect(changed).toHaveBeenCalledOnce();
    stop();
  });

  it("passes the shared base through on a live hand back", async () => {
    await files().saveNote(KEY, "mine", "stale", "base\r\n");
    expect(setContent).toHaveBeenCalledWith(PATH, "mine", { base: "base\n" });
  });

  it("reports a conflict when the open file moved on", async () => {
    await expect(files().saveNote(KEY, "mine", "stale")).rejects.toEqual(new NoteConflictError({ text: TEXT, version: noteVersion(TEXT) }));
    expect(setContent).not.toHaveBeenCalled();
  });

  it("refuses when the project does not take the write", async () => {
    setContent.mockReturnValue(false);
    useFilesStore.setState({ setContent });
    await expect(files().saveNote(KEY, "mine", noteVersion(TEXT))).rejects.toBeInstanceOf(ProjectNoteWriteRefused);
    await expect(files().saveNote(KEY, "mine", noteVersion(TEXT))).rejects.toThrow("read only");
  });

  it("writes straight to disk when the file is not open or the project closed", async () => {
    useFilesStore.setState({ files: {} });
    const data = files();
    const disk = noteVersion("disk\ntext");
    await data.saveNote(KEY, "mine", disk);
    expect(writeProjectFile).toHaveBeenLastCalledWith("paper", PATH, "mine", { crlf: true });
    useFilesStore.setState({ projectId: "thesis" });
    await data.saveNote(KEY, "mine", disk);
    expect(writeProjectFile).toHaveBeenLastCalledWith("paper", PATH, "mine", { crlf: true, closedProject: true });
    await data.saveNote(KEY, "mine", "stale", "base");
    expect(writeProjectFile).toHaveBeenLastCalledWith("paper", PATH, "mine", { crlf: true, closedProject: true, base: "base" });
    await expect(data.saveNote(KEY, "mine", "stale")).rejects.toBeInstanceOf(NoteConflictError);
  });

  it("keeps the file's line endings when it saves after the project closed", async () => {
    useFilesStore.setState({ projectId: "thesis", files: {} });
    const data = files();
    mocks.readFileContent.mockResolvedValue("---\r\nkind: note\r\n---\r\n\r\nOne\r\n");
    await data.saveNote(KEY, "Two\n", noteVersion("---\nkind: note\n---\n\nOne\n"));
    expect(writeProjectFile).toHaveBeenLastCalledWith("paper", PATH, "Two\n", { crlf: true, closedProject: true });
    mocks.readFileContent.mockResolvedValue("---\nkind: note\n---\n\nOne\n");
    await data.saveNote(KEY, "Two\n", noteVersion("---\nkind: note\n---\n\nOne\n"));
    expect(writeProjectFile).toHaveBeenLastCalledWith("paper", PATH, "Two\n", { crlf: false, closedProject: true });
  });

  it("still hands back a live note when the disk cannot be read for its line endings", async () => {
    useFilesStore.setState({ projectId: "thesis", files: {} });
    mocks.readFileContent.mockRejectedValue(new Error("gone"));
    await files().saveNote(KEY, "mine", "stale", "base");
    expect(writeProjectFile).toHaveBeenLastCalledWith("paper", PATH, "mine", { closedProject: true, base: "base" });
  });

  it("writes again after a failed save instead of calling its own text a conflict", async () => {
    const failure = new Error("The disk is full.");
    const store = {
      setContent: vi.fn((path: string, content: string) => {
        useFilesStore.setState((state) => ({ files: { ...state.files, [path]: { content, dirty: true } } }));
        return true;
      }),
      saveFile: vi.fn(async (_path: string) => {}),
    };
    store.saveFile.mockRejectedValueOnce(failure);
    useFilesStore.setState(store);
    const data = files();
    await expect(data.saveNote(KEY, "mine", noteVersion(TEXT))).rejects.toBe(failure);
    await expect(data.saveNote(KEY, "mine", noteVersion(TEXT))).resolves.toEqual({ text: "mine", version: noteVersion("mine") });
    expect(store.saveFile).toHaveBeenCalledTimes(2);
  });

  it("still reports a conflict when someone else changed a file it could not save", async () => {
    useFilesStore.setState({ files: { [PATH]: { content: "theirs", dirty: true } } });
    await expect(files().saveNote(KEY, "mine", noteVersion(TEXT))).rejects.toBeInstanceOf(NoteConflictError);
  });

  it("hands other notes to the library", async () => {
    const data = files();
    await data.saveNote("lib", "x", "v");
    expect(others.saveNote).toHaveBeenCalledWith("lib", "x", "v", undefined);
    const onChange = vi.fn();
    data.watchNote("lib", onChange);
    expect(others.watchNote).toHaveBeenCalledWith("lib", onChange);
    data.noteTextChanged("lib", "x");
    expect(others.noteTextChanged).toHaveBeenCalledWith("lib", "x");
    await expect(data.resolveAsset("lib", "a.png")).resolves.toBe("lib/a.png");
  });

  it("copes with a library that cannot watch or resolve", async () => {
    const data = createProjectNoteFiles(
      { projectId: "paper", path: PATH },
      { key: KEY, others: () => ({ loadNote: others.loadNote, saveNote: others.saveNote }), refused: () => "" },
    );
    expect(typeof data.watchNote("lib", () => {})).toBe("function");
    data.watchNote("lib", () => {})();
    await expect(data.resolveAsset("lib", "a.png")).resolves.toBeNull();
    data.noteTextChanged("lib", "x");
  });

  it("mirrors live text into a clean open file only", () => {
    const data = files();
    const changed = vi.fn();
    data.watchNote(KEY, changed);
    data.noteTextChanged(KEY, "live\r\ntext");
    expect(useFilesStore.getState().files[PATH]?.content).toBe("live\ntext");
    expect(changed).not.toHaveBeenCalled();
    const before = useFilesStore.getState().files;
    data.noteTextChanged(KEY, "live\ntext");
    expect(useFilesStore.getState().files).toBe(before);
    useFilesStore.setState({ files: { [PATH]: { content: "typed", dirty: true } } });
    data.noteTextChanged(KEY, "other");
    expect(useFilesStore.getState().files[PATH]?.content).toBe("typed");
    useFilesStore.setState({ projectId: "thesis" });
    data.noteTextChanged(KEY, "other");
    expect(useFilesStore.getState().files[PATH]?.content).toBe("typed");
  });

  it("resolves assets next to the note file", async () => {
    const data = files();
    await expect(data.resolveAsset(KEY, "assets/fig.png")).resolves.toBe("thumb:notes/assets/fig.png");
    expect(mocks.loadAssetThumbnail).toHaveBeenCalledWith("paper", "notes/assets/fig.png");
    await expect(data.resolveAsset(KEY, "assets/run.ipynb")).resolves.toBe("notebook:notes/assets/run.ipynb");
    await expect(data.resolveAsset(KEY, "../../x.png")).resolves.toBeNull();
  });
});
