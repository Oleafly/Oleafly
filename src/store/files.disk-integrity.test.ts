import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectEngine: vi.fn(),
  projectMutationGeneration: vi.fn(),
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  createFile: vi.fn(),
  deleteFile: vi.fn(),
  importPathsIntoProject: vi.fn(),
  setMainDocCmd: vi.fn(),
  setProjectEngineCmd: vi.fn(),
  setProjectShellEscapeCmd: vi.fn(),
  recordProjectTexSpec: vi.fn(),
  importOverleafProjectCmd: vi.fn(),
  createProjectFromTemplate: vi.fn(),
  gitRestore: vi.fn(),
  gitPull: vi.fn(),
  gitDiscard: vi.fn(),
  copyFile: vi.fn(),
  renameFile: vi.fn(),
  renameProjectCmd: vi.fn(),
  projectTexStatus: vi.fn(),
  tlmgrInstall: vi.fn(),
  mcpSetActiveProject: vi.fn(async () => {}),
  logError: vi.fn(),
  notifyError: vi.fn(),
  toastInfo: vi.fn(),
  toastInfoUnique: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastErrorUnique: vi.fn(),
  toastDismiss: vi.fn(),
  resetCompile: vi.fn(),
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
  notifyProjectFilesChanged: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  getProjectEngine: mocks.getProjectEngine,
  projectMutationGeneration: mocks.projectMutationGeneration,
  listFiles: mocks.listFiles,
  readFileContent: mocks.readFileContent,
  writeFileContent: mocks.writeFileContent,
  createFile: mocks.createFile,
  deleteFile: mocks.deleteFile,
  importPathsIntoProject: mocks.importPathsIntoProject,
  setMainDocCmd: mocks.setMainDocCmd,
  setProjectEngineCmd: mocks.setProjectEngineCmd,
  setProjectShellEscapeCmd: mocks.setProjectShellEscapeCmd,
  recordProjectTexSpec: mocks.recordProjectTexSpec,
  importOverleafProjectCmd: mocks.importOverleafProjectCmd,
  createProjectFromTemplate: mocks.createProjectFromTemplate,
  gitRestore: mocks.gitRestore,
  gitPull: mocks.gitPull,
  gitDiscard: mocks.gitDiscard,
  copyFile: mocks.copyFile,
  renameFile: mocks.renameFile,
  renameProjectCmd: mocks.renameProjectCmd,
  projectTexStatus: mocks.projectTexStatus,
  tlmgrInstall: mocks.tlmgrInstall,
  listProjects: vi.fn(async () => []),
  mcpSetActiveProject: mocks.mcpSetActiveProject,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: {
    info: mocks.toastInfo,
    infoUnique: mocks.toastInfoUnique,
    success: mocks.toastSuccess,
    error: mocks.toastError,
    errorUnique: mocks.toastErrorUnique,
    dismiss: mocks.toastDismiss,
  },
}));
vi.mock("@/lib/cross-window", () => ({
  notifyProjectFilesChanged: mocks.notifyProjectFilesChanged,
}));
vi.mock("@/store/diff", () => ({
  useDiffStore: { getState: () => ({ clearActiveDiff: vi.fn() }) },
}));
vi.mock("@/store/tab-order", () => ({ nextTabSeq: () => 1 }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ reset: mocks.resetCompile }) },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: mocks.flushWysiwygPendingEdits,
  invalidateWysiwygProjectSession: mocks.invalidateWysiwygProjectSession,
}));

import type { ProjectMeta, ProjectStateChanged } from "@oleafly/backend-port";
import { useFilesStore } from "./files";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import { diskHash } from "@/lib/disk-hash";

const ENCODING_ERROR =
  "This file uses an unsupported text encoding. Save a copy as UTF-8 before editing it in Oleafly. The original file has not been changed.";

const META = {
  id: "project",
  name: "Paper",
  kind: "latex",
  main_doc: "main.tex",
  path: "/tmp/p",
  engine: "latexmk",
  allow_shell_escape: false,
  checkpoints: "inherit",
} as unknown as ProjectMeta;

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.projectMutationGeneration.mockResolvedValue(3);
  mocks.writeFileContent.mockResolvedValue({ generation: 9 });
  mocks.listFiles.mockResolvedValue([{ path: "main.tex", is_dir: false }]);
  mocks.readFileContent.mockResolvedValue("");
  mocks.mcpSetActiveProject.mockResolvedValue(undefined);
  mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);
  mocks.projectTexStatus.mockResolvedValue(null);
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    tree: [{ path: "main.tex", is_dir: false }, { path: "kapitola.tex", is_dir: false }],
    files: {},
    openTabs: [],
    activePath: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("line endings", () => {
  it("keeps CRLF line endings when a CRLF file is edited and saved", async () => {
    mocks.readFileContent.mockResolvedValue("\\section{Úvod}\r\nPrvní řádek.\r\nDruhý řádek.\r\n");
    await useFilesStore.getState().openFile("main.tex");
    const loaded = useFilesStore.getState().files["main.tex"].content;
    expect(loaded).toBe("\\section{Úvod}\nPrvní řádek.\nDruhý řádek.\n");
    useFilesStore.getState().setContent("main.tex", `${loaded}Třetí řádek.\n`);
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.writeFileContent.mock.calls.at(-1)?.[2]).toBe(
      "\\section{Úvod}\r\nPrvní řádek.\r\nDruhý řádek.\r\nTřetí řádek.\r\n",
    );
  });

  it("keeps LF and mixed files as LF", async () => {
    mocks.readFileContent.mockResolvedValue("a\r\nb\nc\n");
    await useFilesStore.getState().openFile("main.tex");
    useFilesStore.getState().setContent("main.tex", "a\nb\nc\nd\n");
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.writeFileContent.mock.calls.at(-1)?.[2]).toBe("a\nb\nc\nd\n");
  });

  it("keeps CRLF when an external write replaces the file", async () => {
    mocks.readFileContent.mockResolvedValue("one\r\ntwo\r\n");
    await useFilesStore.getState().openFile("main.tex");
    await useFilesStore.getState().writeProjectFile("project", "main.tex", "one\ntwo\nthree\n");
    expect(mocks.writeFileContent.mock.calls.at(-1)?.[2]).toBe("one\r\ntwo\r\nthree\r\n");
  });
});

describe("files that cannot be opened", () => {
  it("tells the user once why a Windows-1250 file did not open", async () => {
    mocks.readFileContent.mockRejectedValue(ENCODING_ERROR);
    await useFilesStore.getState().openFile("kapitola.tex");
    expect(useFilesStore.getState().openTabs).toEqual([]);
    expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);
    const [key, message] = mocks.toastErrorUnique.mock.calls[0];
    expect(key).toContain("kapitola.tex");
    expect(message).toContain("kapitola.tex");
    expect(message).toContain("UTF-8");
  });

  it("uses the general message for other read failures", async () => {
    mocks.readFileContent.mockRejectedValue("Could not read /tmp/p/kapitola.tex: permission denied");
    await useFilesStore.getState().openFile("kapitola.tex");
    const [, message] = mocks.toastErrorUnique.mock.calls[0];
    expect(message).toContain("kapitola.tex");
    expect(message).not.toContain("UTF-8");
  });

  it("explains why a project whose main.tex is ISO-8859-2 opened with no document", async () => {
    await useFilesStore.getState().closeProject();
    mocks.getProject.mockResolvedValue(META);
    mocks.readFileContent.mockRejectedValue(ENCODING_ERROR);
    await useFilesStore.getState().openProject("project");
    expect(useFilesStore.getState().projectId).toBe("project");
    expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);
    expect(mocks.toastErrorUnique.mock.calls[0][1]).toContain("main.tex");
  });

  it("stays quiet when a newer open replaced the failed one", async () => {
    let fail!: (reason: unknown) => void;
    mocks.readFileContent.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const first = useFilesStore.getState().openFile("kapitola.tex");
    useFilesStore.getState().closeTab("kapitola.tex");
    fail(ENCODING_ERROR);
    await first;
    expect(mocks.toastErrorUnique).not.toHaveBeenCalled();
  });
});

describe("git pull and restore", () => {
  it("locks the editor while the pull runs and shows the pulled text afterwards", async () => {
    mocks.readFileContent.mockResolvedValue("local line\n");
    await useFilesStore.getState().openFile("main.tex");
    let finishPull!: (value: unknown) => void;
    mocks.gitPull.mockImplementation(() => new Promise((resolve) => { finishPull = resolve; }));
    const pull = useFilesStore.getState().pullFromGit("project");
    await vi.waitFor(() => expect(mocks.gitPull).toHaveBeenCalled());
    expect(isEditorMutationLocked("project")).toBe(true);
    mocks.readFileContent.mockResolvedValue("coauthor line\nlocal line\n");
    const event = {
      projectId: "project",
      revision: Date.now(),
      reason: "git-pull",
      filesChanged: true,
      mutationGeneration: 20,
      project: { ...META },
      engine: LATEX_ENGINE,
    } as unknown as ProjectStateChanged;
    finishPull({ state: event, conflicts: [], message: "ok" });
    const result = await pull;
    expect(result.conflicts).toEqual([]);
    expect(isEditorMutationLocked("project")).toBe(false);
    expect(useFilesStore.getState().files["main.tex"]).toEqual({ content: "coauthor line\nlocal line\n", dirty: false });
  });

  it("releases the editor when the pull fails", async () => {
    mocks.readFileContent.mockResolvedValue("local line\n");
    await useFilesStore.getState().openFile("main.tex");
    mocks.gitPull.mockRejectedValue(new Error("network down"));
    await expect(useFilesStore.getState().pullFromGit("project")).rejects.toThrow("network down");
    expect(isEditorMutationLocked("project")).toBe(false);
  });

  it("locks the editor while a restore runs", async () => {
    mocks.readFileContent.mockResolvedValue("v2\n");
    await useFilesStore.getState().openFile("main.tex");
    let locked = false;
    mocks.gitRestore.mockImplementation(async () => {
      locked = isEditorMutationLocked("project");
      return {
        projectId: "project",
        revision: Date.now(),
        reason: "git-restore",
        filesChanged: true,
        mutationGeneration: 21,
        project: { ...META },
        engine: LATEX_ENGINE,
      };
    });
    mocks.readFileContent.mockResolvedValue("v1\n");
    await useFilesStore.getState().restoreFromGit("project", "abc");
    expect(locked).toBe(true);
    expect(useFilesStore.getState().files["main.tex"].content).toBe("v1\n");
  });
});

describe("edits made on disk by other programs", () => {
  const CONFLICT = "file changed on disk: main.tex was changed outside Oleafly after it was loaded";

  it("sends the hash of the loaded bytes so the backend can refuse a stale save", async () => {
    mocks.readFileContent.mockResolvedValue("Úvod.\r\nPůvodní věta.\r\n");
    await useFilesStore.getState().openFile("main.tex");
    const buffer = useFilesStore.getState().files["main.tex"].content;
    useFilesStore.getState().setContent("main.tex", `${buffer}x`);
    await useFilesStore.getState().saveFile("main.tex");
    const call = mocks.writeFileContent.mock.calls.at(-1) ?? [];
    expect(call[4]).toBe(diskHash("Úvod.\r\nPůvodní věta.\r\n"));

    useFilesStore.getState().setContent("main.tex", `${buffer}xy`);
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.writeFileContent.mock.calls.at(-1)?.[4]).toBe(diskHash(call[2]));
  });

  it("keeps the edit in the editor, warns once, and reloads the disk version on request", async () => {
    mocks.readFileContent.mockResolvedValue("Úvod.\nPůvodní věta.\n");
    await useFilesStore.getState().openFile("main.tex");
    mocks.writeFileContent.mockRejectedValue(CONFLICT);
    const buffer = useFilesStore.getState().files["main.tex"].content;
    useFilesStore.getState().setContent("main.tex", `${buffer}x`);
    await expect(useFilesStore.getState().saveFile("main.tex")).rejects.toMatch("file changed on disk");
    const { reportFileSaveFailure } = await import("./files");
    reportFileSaveFailure("autosave", "project", "main.tex", CONFLICT);
    reportFileSaveFailure("autosave", "project", "main.tex", CONFLICT);
    expect(useFilesStore.getState().files["main.tex"]).toMatchObject({ content: `${buffer}x`, dirty: true });
    expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);
    const [, message, action] = mocks.toastErrorUnique.mock.calls[0];
    expect(message).toContain("main.tex");

    mocks.readFileContent.mockResolvedValue("Úvod.\nOpravená věta od agenta.\n");
    action.onClick();
    await vi.waitFor(() =>
      expect(useFilesStore.getState().files["main.tex"]).toEqual({
        content: "Úvod.\nOpravená věta od agenta.\n",
        dirty: false,
      }),
    );
  });

  it("overwrites the disk version only on an explicit save after the warning", async () => {
    mocks.readFileContent.mockResolvedValue("old\n");
    await useFilesStore.getState().openFile("main.tex");
    mocks.writeFileContent.mockRejectedValueOnce(CONFLICT);
    useFilesStore.getState().setContent("main.tex", "mine\n");
    await expect(useFilesStore.getState().saveFile("main.tex")).rejects.toMatch("file changed on disk");
    mocks.writeFileContent.mockRejectedValueOnce(CONFLICT);
    await expect(useFilesStore.getState().saveFile("main.tex")).rejects.toMatch("file changed on disk");
    expect(mocks.writeFileContent.mock.calls.at(-1)?.[4]).toBe(diskHash("old\n"));

    mocks.writeFileContent.mockRejectedValueOnce(CONFLICT);
    await expect(useFilesStore.getState().saveActive({ overwrite: true })).rejects.toMatch("file changed on disk");
    expect(mocks.writeFileContent.mock.calls.at(-1)?.[4]).toBe(diskHash("old\n"));
    const { reportFileSaveFailure } = await import("./files");
    reportFileSaveFailure("editor save", "project", "main.tex", CONFLICT, true);
    expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);

    await useFilesStore.getState().saveActive({ overwrite: true });
    expect(mocks.writeFileContent.mock.calls.at(-1)).toHaveLength(4);
    expect(useFilesStore.getState().files["main.tex"].dirty).toBe(false);
  });

  it("shows the warning again when the user retries an action the conflict blocks", async () => {
    mocks.readFileContent.mockResolvedValue("old\n");
    await useFilesStore.getState().openFile("main.tex");
    mocks.writeFileContent.mockRejectedValueOnce(CONFLICT);
    useFilesStore.getState().setContent("main.tex", "mine\n");
    await expect(useFilesStore.getState().saveFile("main.tex")).rejects.toMatch("file changed on disk");
    const { reportFileSaveFailure } = await import("./files");
    reportFileSaveFailure("autosave", "project", "main.tex", CONFLICT);
    reportFileSaveFailure("autosave", "project", "main.tex", CONFLICT);
    expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);
    reportFileSaveFailure("save before agent prompt", "project", "main.tex", CONFLICT, true);
    expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(2);
    expect(mocks.toastErrorUnique.mock.calls[1][0]).toBe(mocks.toastErrorUnique.mock.calls[0][0]);
  });

  it("adopts the new disk hash after an external reload of a clean buffer", async () => {
    mocks.readFileContent.mockResolvedValue("before\n");
    await useFilesStore.getState().openFile("main.tex");
    expect(useFilesStore.getState().applyExternalReload("project", "main.tex", "after\n")).toBe(true);
    useFilesStore.getState().setContent("main.tex", "after!\n");
    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.writeFileContent.mock.calls.at(-1)?.[4]).toBe(diskHash("after\n"));
  });
});
