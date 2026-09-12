import { beforeEach, describe, expect, it, vi } from "vitest";
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

import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import type { ProjectMeta, ProjectStateChanged } from "@oleafly/backend-port";
import { engineErrorMessage, useFilesStore } from "./files";

const MAIN_ONLY = [{ path: "main.tex", is_dir: false }];
const WITH_BIB = [
  { path: "main.tex", is_dir: false },
  { path: "references.bib", is_dir: false },
];

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.projectMutationGeneration.mockResolvedValue(3);
  mocks.writeFileContent.mockResolvedValue({ path: "references.bib", generation: 9 });
  mocks.listFiles.mockResolvedValue(WITH_BIB);
  mocks.readFileContent.mockResolvedValue("");
  mocks.mcpSetActiveProject.mockResolvedValue(undefined);
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    tree: MAIN_ONLY,
    files: {},
    openTabs: [],
    activePath: null,
  });
});

describe("writeProjectFile", () => {
  it("writes through the backend and refreshes the tree", async () => {
    await useFilesStore.getState().writeProjectFile(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
    );

    expect(mocks.writeFileContent).toHaveBeenCalledWith(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
      3,
    );
    expect(mocks.listFiles).toHaveBeenCalledWith("project");
    expect(useFilesStore.getState().tree).toEqual(WITH_BIB);
  });

  it("leaves a closed file closed", async () => {
    await useFilesStore.getState().writeProjectFile(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
    );

    const state = useFilesStore.getState();
    expect(state.files["references.bib"]).toBeUndefined();
    expect(state.openTabs).toEqual([]);
    expect(state.activePath).toBeNull();
  });

  it("updates a buffer that is already open and marks it clean", async () => {
    useFilesStore.setState({
      files: { "references.bib": { content: "old\n", dirty: false } },
      openTabs: ["references.bib"],
      activePath: "references.bib",
    });

    await useFilesStore.getState().writeProjectFile(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
    );

    const state = useFilesStore.getState();
    expect(state.files["references.bib"]).toEqual({
      content: "@book{a,title={A}}\n",
      dirty: false,
    });
    expect(state.openTabs).toEqual(["references.bib"]);
  });

  it("remembers the generation the backend returned", async () => {
    await useFilesStore.getState().writeProjectFile(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
    );
    useFilesStore.setState((s) => ({
      files: { ...s.files, "main.tex": { content: "hello\n", dirty: true } },
    }));

    await useFilesStore.getState().saveFile("main.tex");

    expect(mocks.writeFileContent).toHaveBeenNthCalledWith(
      2,
      "project",
      "main.tex",
      "hello\n",
      9,
    );
  });

  function deferBibWrite() {
    let release: (value: { path: string; generation: number }) => void = () => {};
    const started = new Promise<void>((resolveStarted) => {
      mocks.writeFileContent.mockImplementationOnce(() => {
        resolveStarted();
        return new Promise<{ path: string; generation: number }>((resolve) => {
          release = resolve;
        });
      });
    });
    return {
      started,
      release: () => release({ path: "references.bib", generation: 9 }),
    };
  }

  function openBib() {
    useFilesStore.setState({
      tree: WITH_BIB,
      files: { "references.bib": { content: "old\n", dirty: false } },
      openTabs: ["references.bib"],
      activePath: "references.bib",
    });
  }

  function deferGeneration() {
    let release: (value: number) => void = () => {};
    const started = new Promise<void>((resolveStarted) => {
      mocks.projectMutationGeneration.mockImplementationOnce(() => {
        resolveStarted();
        return new Promise<number>((resolve) => {
          release = resolve;
        });
      });
    });
    return { started, release: () => release(3) };
  }

  it("keeps an edit that landed while the generation was being looked up", async () => {
    openBib();
    const deferred = deferGeneration();

    const write = useFilesStore.getState().writeProjectFile(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
    );
    await deferred.started;
    useFilesStore.getState().setContent("references.bib", "old\nmine\n");
    deferred.release();
    await write;

    expect(mocks.writeFileContent).toHaveBeenCalledWith(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
      3,
    );
    expect(useFilesStore.getState().files["references.bib"]).toEqual({
      content: "old\nmine\n",
      dirty: true,
      edits: 1,
    });
  });

  it("still autosaves an edit made during the generation lookup", async () => {
    vi.useFakeTimers();
    try {
      openBib();
      const deferred = deferGeneration();

      const write = useFilesStore.getState().writeProjectFile(
        "project",
        "references.bib",
        "@book{a,title={A}}\n",
      );
      await deferred.started;
      useFilesStore.getState().setContent("references.bib", "old\nmine\n");
      deferred.release();
      await write;
      await vi.advanceTimersByTimeAsync(2000);

      expect(mocks.writeFileContent).toHaveBeenLastCalledWith(
        "project",
        "references.bib",
        "old\nmine\n",
        9,
      );
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: false,
        edits: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an edit that landed while the write was in flight", async () => {
    openBib();
    const deferred = deferBibWrite();

    const write = useFilesStore.getState().writeProjectFile(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
    );
    await deferred.started;
    useFilesStore.getState().setContent("references.bib", "old\nmine\n");
    deferred.release();
    await write;

    expect(useFilesStore.getState().files["references.bib"]).toEqual({
      content: "old\nmine\n",
      dirty: true,
      edits: 1,
    });
  });

  it("leaves the pending save of an edit that outran the write in place", async () => {
    vi.useFakeTimers();
    try {
      openBib();
      const deferred = deferBibWrite();

      const write = useFilesStore.getState().writeProjectFile(
        "project",
        "references.bib",
        "@book{a,title={A}}\n",
      );
      await deferred.started;
      useFilesStore.getState().setContent("references.bib", "old\nmine\n");
      deferred.release();
      await write;
      await vi.advanceTimersByTimeAsync(2000);

      expect(mocks.writeFileContent).toHaveBeenLastCalledWith(
        "project",
        "references.bib",
        "old\nmine\n",
        9,
      );
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: false,
        edits: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an edit that preparation flushed and lets it win on disk", async () => {
    vi.useFakeTimers();
    try {
      const disk = new Map<string, string>([["references.bib", "old\n"]]);
      mocks.writeFileContent.mockImplementation(
        async (_projectId: string, path: string, content: string) => {
          disk.set(path, content);
          return { path, generation: 9 };
        },
      );
      openBib();
      useFilesStore.getState().setContent("references.bib", "old\nmine\n");

      await useFilesStore.getState().writeProjectFile(
        "project",
        "references.bib",
        "@book{a,title={A}}\n",
      );

      expect(disk.get("references.bib")).toBe("@book{a,title={A}}\n");
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: true,
        edits: 1,
      });

      await vi.advanceTimersByTimeAsync(2000);

      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: false,
        edits: 1,
      });
      expect(disk.get("references.bib")).toBe("old\nmine\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("announces the changed path to the other windows without naming a tab to open", async () => {
    await useFilesStore.getState().writeProjectFile(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
    );

    expect(mocks.notifyProjectFilesChanged).toHaveBeenCalledWith("project", [
      "references.bib",
    ]);
  });

  it("announces an overwrite the same way, so no window opens a tab for it", async () => {
    useFilesStore.setState({ tree: WITH_BIB });

    await useFilesStore.getState().writeProjectFile(
      "project",
      "references.bib",
      "@book{a,title={A}}\n",
    );

    expect(mocks.notifyProjectFilesChanged).toHaveBeenCalledWith("project", [
      "references.bib",
    ]);
  });

  const IMPORTED = "@book{a,title={A}}\n";

  function diskBackedWrites(disk: Map<string, string>, held: string) {
    let release: () => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mocks.writeFileContent.mockImplementation(
      (_projectId: string, path: string, content: string) => {
        if (content !== held) {
          disk.set(path, content);
          return Promise.resolve({ path, generation: 9 });
        }
        markStarted();
        return new Promise<{ path: string; generation: number }>((resolve) => {
          release = () => {
            disk.set(path, content);
            resolve({ path, generation: 9 });
          };
        });
      },
    );
    mocks.readFileContent.mockImplementation(
      async (_projectId: string, path: string) => disk.get(path) ?? "",
    );
    return { started, release: () => release() };
  }

  it("adopts the written content into a file opened clean while the write was in flight", async () => {
    vi.useFakeTimers();
    try {
      const disk = new Map<string, string>([["references.bib", "old\n"]]);
      const deferred = diskBackedWrites(disk, IMPORTED);
      useFilesStore.setState({ tree: WITH_BIB });
      const docVersion = useFilesStore.getState().docVersion;

      const write = useFilesStore.getState().writeProjectFile(
        "project",
        "references.bib",
        IMPORTED,
      );
      await deferred.started;
      await useFilesStore.getState().openFile("references.bib");
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\n",
        dirty: false,
      });
      deferred.release();
      await write;

      const state = useFilesStore.getState();
      expect(state.files["references.bib"]).toEqual({
        content: IMPORTED,
        dirty: false,
      });
      expect(state.openTabs).toEqual(["references.bib"]);
      expect(state.activePath).toBe("references.bib");
      expect(state.docVersion).toBe(docVersion + 1);

      await vi.advanceTimersByTimeAsync(2000);

      expect(mocks.writeFileContent).toHaveBeenCalledTimes(1);
      expect(disk.get("references.bib")).toBe(IMPORTED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adopts the written content into a buffer that was open before and untouched throughout", async () => {
    vi.useFakeTimers();
    try {
      const disk = new Map<string, string>([["references.bib", "old\n"]]);
      const deferred = diskBackedWrites(disk, IMPORTED);
      openBib();
      const docVersion = useFilesStore.getState().docVersion;

      const write = useFilesStore.getState().writeProjectFile(
        "project",
        "references.bib",
        IMPORTED,
      );
      await deferred.started;
      await useFilesStore.getState().openFile("references.bib");
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\n",
        dirty: false,
      });
      deferred.release();
      await write;

      const state = useFilesStore.getState();
      expect(state.files["references.bib"]).toEqual({
        content: IMPORTED,
        dirty: false,
      });
      expect(state.openTabs).toEqual(["references.bib"]);
      expect(state.docVersion).toBe(docVersion + 1);

      await vi.advanceTimersByTimeAsync(2000);

      expect(mocks.writeFileContent).toHaveBeenCalledTimes(1);
      expect(disk.get("references.bib")).toBe(IMPORTED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-queues a buffer that was dirty before the write so its content wins on disk", async () => {
    vi.useFakeTimers();
    try {
      const disk = new Map<string, string>([["references.bib", "old\n"]]);
      const deferred = diskBackedWrites(disk, IMPORTED);
      openBib();
      useFilesStore.getState().setContent("references.bib", "old\nmine\n");

      const write = useFilesStore.getState().writeProjectFile(
        "project",
        "references.bib",
        IMPORTED,
      );
      await deferred.started;
      expect(disk.get("references.bib")).toBe("old\nmine\n");
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: false,
        edits: 1,
      });
      deferred.release();
      await write;

      expect(disk.get("references.bib")).toBe(IMPORTED);
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: true,
        edits: 1,
      });

      await vi.advanceTimersByTimeAsync(2000);

      expect(
        mocks.writeFileContent.mock.calls.map((call) => call[2]),
      ).toEqual(["old\nmine\n", IMPORTED, "old\nmine\n"]);
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: false,
        edits: 1,
      });
      expect(disk.get("references.bib")).toBe("old\nmine\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a file opened and edited during the write alone and keeps its own save", async () => {
    vi.useFakeTimers();
    try {
      const disk = new Map<string, string>([["references.bib", "old\n"]]);
      const deferred = diskBackedWrites(disk, IMPORTED);
      useFilesStore.setState({ tree: WITH_BIB });

      const write = useFilesStore.getState().writeProjectFile(
        "project",
        "references.bib",
        IMPORTED,
      );
      await deferred.started;
      await useFilesStore.getState().openFile("references.bib");
      useFilesStore.getState().setContent("references.bib", "old\nmine\n");
      await vi.advanceTimersByTimeAsync(1000);
      deferred.release();
      await write;

      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: true,
        edits: 1,
      });
      expect(disk.get("references.bib")).toBe(IMPORTED);

      await vi.advanceTimersByTimeAsync(500);

      expect(
        mocks.writeFileContent.mock.calls.map((call) => call[2]),
      ).toEqual([IMPORTED, "old\nmine\n"]);
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: false,
        edits: 1,
      });
      expect(disk.get("references.bib")).toBe("old\nmine\n");

      await vi.advanceTimersByTimeAsync(2000);

      expect(mocks.writeFileContent).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps text typed into the target while preparation was flushing another file", async () => {
    vi.useFakeTimers();
    try {
      const disk = new Map<string, string>([
        ["main.tex", "hello\n"],
        ["references.bib", "old\n"],
      ]);
      const flush = diskBackedWrites(disk, "hello\nmore\n");
      useFilesStore.setState({
        tree: WITH_BIB,
        files: { "main.tex": { content: "hello\n", dirty: false } },
        openTabs: ["main.tex"],
        activePath: "main.tex",
      });
      useFilesStore.getState().setContent("main.tex", "hello\nmore\n");

      const write = useFilesStore.getState().writeProjectFile(
        "project",
        "references.bib",
        IMPORTED,
      );
      await flush.started;
      await useFilesStore.getState().openFile("references.bib");
      useFilesStore.getState().setContent("references.bib", "old\nmine\n");
      flush.release();
      await write;

      expect(disk.get("main.tex")).toBe("hello\nmore\n");
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: true,
        edits: 1,
      });

      await vi.advanceTimersByTimeAsync(2000);

      expect(
        mocks.writeFileContent.mock.calls.map((call) => [call[1], call[2]]),
      ).toEqual([
        ["main.tex", "hello\nmore\n"],
        ["references.bib", "old\nmine\n"],
        ["references.bib", IMPORTED],
        ["references.bib", "old\nmine\n"],
      ]);
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: false,
        edits: 1,
      });
      expect(disk.get("references.bib")).toBe(
        useFilesStore.getState().files["references.bib"]?.content,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a buffer the user edited and saved earlier, whatever its dirty flag says", async () => {
    vi.useFakeTimers();
    try {
      const disk = new Map<string, string>([["references.bib", "old\n"]]);
      diskBackedWrites(disk, "");
      openBib();
      useFilesStore.getState().setContent("references.bib", "old\nmine\n");
      await useFilesStore.getState().saveFile("references.bib");
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: false,
        edits: 1,
      });

      await useFilesStore.getState().writeProjectFile(
        "project",
        "references.bib",
        IMPORTED,
      );

      expect(disk.get("references.bib")).toBe(IMPORTED);
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "old\nmine\n",
        dirty: true,
        edits: 1,
      });

      await vi.advanceTimersByTimeAsync(2000);

      expect(disk.get("references.bib")).toBe("old\nmine\n");
      expect(useFilesStore.getState().files["references.bib"]?.dirty).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adopts the written content into a buffer that was reloaded and never typed into", async () => {
    const disk = new Map<string, string>([["references.bib", "old\n"]]);
    diskBackedWrites(disk, "");
    openBib();
    useFilesStore.getState().setContent("references.bib", "old\nmine\n");
    await useFilesStore.getState().saveFile("references.bib");
    expect(
      useFilesStore.getState().applyExternalReload("project", "references.bib", "theirs\n"),
    ).toBe(true);
    expect(useFilesStore.getState().files["references.bib"]).toEqual({
      content: "theirs\n",
      dirty: false,
    });

    await useFilesStore.getState().writeProjectFile(
      "project",
      "references.bib",
      IMPORTED,
    );

    expect(useFilesStore.getState().files["references.bib"]).toEqual({
      content: IMPORTED,
      dirty: false,
    });
    expect(disk.get("references.bib")).toBe(IMPORTED);
  });

  it("refuses to write into a project that is no longer open", async () => {
    await expect(
      useFilesStore.getState().writeProjectFile("other", "references.bib", "x\n"),
    ).rejects.toThrow(/Project changed/);
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });
});

const core = enCore;
const LATEXMK_ENGINE = { ...LATEX_ENGINE, id: "latexmk", label: "latexmk" };
const META = {
  id: "opened",
  name: "Opened",
  kind: "latex",
  main_doc: "main.tex",
  path: "/tmp/opened",
  engine: "latexmk",
  allow_shell_escape: false,
  checkpoints: "inherit",
} as unknown as ProjectMeta;

function texStatus(over: Record<string, unknown> = {}) {
  return {
    missing_packages: [],
    can_install_missing: false,
    pinned_label: null,
    local_label: null,
    distribution_differs: false,
    ...over,
  };
}

function primeOpen(engine = LATEXMK_ENGINE) {
  mocks.getProject.mockResolvedValue(META);
  mocks.projectMutationGeneration.mockResolvedValue(7);
  mocks.listFiles.mockResolvedValue(MAIN_ONLY);
  mocks.getProjectEngine.mockResolvedValue(engine);
  mocks.readFileContent.mockResolvedValue("");
  mocks.mcpSetActiveProject.mockResolvedValue(undefined);
}

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

async function until(ready: () => boolean) {
  for (let i = 0; i < 200 && !ready(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(ready()).toBe(true);
}

describe("engineErrorMessage", () => {
  it("names both engine failures", () => {
    expect(engineErrorMessage("loadFailed")).toBe(core.engine.error.loadFailed);
    expect(engineErrorMessage("renameReloadFailed")).toBe(
      core.engine.error.renameReloadFailed,
    );
  });
});

describe("openProject", () => {
  it("reports a project that will not open", async () => {
    primeOpen();
    mocks.getProject.mockRejectedValue(new Error("no such project"));

    await useFilesStore.getState().openProject("opened");

    expect(mocks.notifyError).toHaveBeenCalledWith(
      "open project",
      expect.anything(),
      core.project.openFailed,
    );
    expect(useFilesStore.getState().projectId).toBeNull();
  });

  it("reports an engine that will not load", async () => {
    primeOpen();
    mocks.getProjectEngine.mockRejectedValue(new Error("engine gone"));
    mocks.projectTexStatus.mockResolvedValue(texStatus());

    await useFilesStore.getState().openProject("opened");
    await settle();

    expect(mocks.notifyError).toHaveBeenCalledWith(
      "load document engine",
      expect.anything(),
      core.engine.error.loadFailed,
    );
  });

  it("offers a one-click install for the pinned packages this machine lacks", async () => {
    primeOpen();
    mocks.projectTexStatus.mockResolvedValue(
      texStatus({ missing_packages: ["pgf"], can_install_missing: true }),
    );
    mocks.tlmgrInstall.mockResolvedValue(undefined);

    await useFilesStore.getState().openProject("opened");
    await settle();

    const call = mocks.toastInfo.mock.calls.at(-1);
    expect(call?.[0]).toBe(
      core.tex.pinnedPackagesMissing_one.replace("{{count}}", "1"),
    );
    expect(call?.[1]?.label).toBe(core.tex.installPinned_one);

    call?.[1]?.onClick?.();
    await settle();
    expect(mocks.tlmgrInstall).toHaveBeenCalledWith(["pgf"]);
    expect(mocks.toastInfo).toHaveBeenCalledWith(
      core.tex.installingPinned_one.replace("{{count}}", "1"),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(core.tex.pinnedPackagesInstalled);
  });

  it("reports a pinned package install that fails", async () => {
    primeOpen();
    mocks.projectTexStatus.mockResolvedValue(
      texStatus({ missing_packages: ["pgf", "tools"], can_install_missing: true }),
    );
    mocks.tlmgrInstall.mockRejectedValue(new Error("tlmgr busy"));

    await useFilesStore.getState().openProject("opened");
    await settle();

    const call = mocks.toastInfo.mock.calls.at(-1);
    expect(call?.[1]?.label).toBe(
      core.tex.installPinned_other.replace("{{count}}", "2"),
    );
    call?.[1]?.onClick?.();
    await settle();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "install pinned packages",
      expect.anything(),
      core.tex.pinnedPackagesFailed,
    );
  });

  it("points at the distribution instead of installing a huge gap", async () => {
    primeOpen();
    mocks.projectTexStatus.mockResolvedValue(
      texStatus({
        missing_packages: Array.from({ length: 40 }, (_, i) => `pkg${i}`),
        can_install_missing: true,
        pinned_label: "TeX Live 2026",
        local_label: "TinyTeX",
      }),
    );

    await useFilesStore.getState().openProject("opened");
    await settle();

    expect(mocks.toastInfo).toHaveBeenCalledWith(
      core.tex.distributionGap
        .replace("{{pinned}}", "TeX Live 2026")
        .replace("{{local}}", "TinyTeX")
        .replace("{{count}}", "40"),
    );
  });

  it("warns once when the local distribution differs from the pin", async () => {
    primeOpen();
    mocks.projectTexStatus.mockResolvedValue(
      texStatus({
        distribution_differs: true,
        pinned_label: "TeX Live 2026",
        local_label: "TinyTeX",
      }),
    );

    await useFilesStore.getState().openProject("opened");
    await settle();

    expect(mocks.toastInfo).toHaveBeenCalledWith(
      core.tex.distributionSkew
        .replace("{{pinned}}", "TeX Live 2026")
        .replace("{{local}}", "TinyTeX"),
    );
  });

  it("keeps the previous project open when its buffers cannot be saved", async () => {
    primeOpen(LATEX_ENGINE);
    useFilesStore.setState({
      projectId: "project",
      files: { "main.tex": { content: "dirty\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockRejectedValue(new Error("read only volume"));

    await useFilesStore.getState().openProject("opened");

    expect(mocks.notifyError).toHaveBeenCalledWith(
      "save before switching projects",
      expect.anything(),
      core.project.saveBlockedSwitch,
    );
    expect(useFilesStore.getState().projectId).toBe("project");
  });
});

describe("closeProject", () => {
  it("stays open when a dirty buffer cannot be saved", async () => {
    useFilesStore.setState({
      projectId: "project",
      files: { "main.tex": { content: "dirty\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockRejectedValue(new Error("read only volume"));

    await useFilesStore.getState().closeProject();

    expect(mocks.notifyError).toHaveBeenCalledWith(
      "save before closing project",
      expect.anything(),
      core.project.saveBlockedClose,
    );
    expect(useFilesStore.getState().projectId).toBe("project");
  });
});

describe("importProject", () => {
  it("announces the import", async () => {
    primeOpen(LATEX_ENGINE);
    mocks.importOverleafProjectCmd.mockResolvedValue("opened");
    mocks.projectTexStatus.mockResolvedValue(texStatus());

    await useFilesStore.getState().importProject("/tmp/paper.zip");
    await settle();

    expect(mocks.toastSuccess).toHaveBeenCalledWith(core.project.imported);
  });
});

describe("file mutation failures", () => {
  it("names the file a copy could not be made of", async () => {
    mocks.copyFile.mockRejectedValue(new Error("disk full"));

    await useFilesStore.getState().copyEntry("main.tex");

    expect(mocks.notifyError).toHaveBeenCalledWith(
      "copy file",
      expect.anything(),
      core.project.copyFailed.replace("{{path}}", "main.tex"),
    );
  });

  it("reports a failed import of outside files", async () => {
    mocks.importPathsIntoProject.mockRejectedValue(new Error("denied"));

    await useFilesStore.getState().importPaths("", ["/tmp/figure.png"]);

    expect(mocks.notifyError).toHaveBeenCalledWith(
      "import files",
      expect.anything(),
      core.project.importFailed,
    );
  });
});

describe("external changes", () => {
  it("keeps a local edit that an external write raced", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "mine\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockResolvedValue({ path: "main.tex", generation: 11 });

    expect(
      useFilesStore.getState().applyExternalWrite("project", "main.tex", "theirs\n"),
    ).toBe(false);
    expect(mocks.toastInfo).toHaveBeenCalledWith(
      core.externalChange.localEditKept.replace("{{path}}", "main.tex"),
    );
  });

  it("reports a local edit that could not be written back", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "mine\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockRejectedValue(new Error("read only volume"));

    useFilesStore.getState().applyExternalWrite("project", "main.tex", "theirs\n");
    await until(() => mocks.notifyError.mock.calls.length > 0);

    expect(mocks.notifyError).toHaveBeenCalledWith(
      "preserve local file change",
      expect.anything(),
      core.externalChange.preserveLocalFailed.replace("{{path}}", "main.tex"),
    );
  });

  it("restores unsaved edits that an external delete removed", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "mine\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockResolvedValue({ path: "main.tex", generation: 11 });

    expect(useFilesStore.getState().applyExternalDelete("project", "main.tex")).toBe(
      false,
    );
    expect(mocks.toastInfo).toHaveBeenCalledWith(core.externalChange.deletionRestored);
  });

  it("reports an unsaved edit that could not be restored after a delete", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "mine\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockRejectedValue(new Error("read only volume"));

    useFilesStore.getState().applyExternalDelete("project", "main.tex");
    await until(() => mocks.notifyError.mock.calls.length > 0);

    expect(mocks.notifyError).toHaveBeenCalledWith(
      "restore local file after external delete",
      expect.anything(),
      core.externalChange.restoreLocalFailed.replace("{{path}}", "main.tex"),
    );
  });
});

describe("applyProjectStateChanged", () => {
  const event = (revision: number): ProjectStateChanged =>
    ({
      projectId: "project",
      revision,
      reason: "settings",
      filesChanged: true,
      mutationGeneration: 4,
      project: { ...META, name: "Paper" },
      engine: LATEX_ENGINE,
    }) as ProjectStateChanged;

  it("reports files it could not reload", async () => {
    mocks.listFiles
      .mockRejectedValueOnce(new Error("tree unavailable"))
      .mockResolvedValue(MAIN_ONLY);

    const applied = await useFilesStore
      .getState()
      .applyProjectStateChanged(event(Date.now()));

    expect(applied).toBe(false);
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "reload project after external change",
      expect.anything(),
      core.externalChange.reloadFailed,
    );
  });

  it("restores unsaved files a project update removed", async () => {
    useFilesStore.setState({
      files: { "gone.tex": { content: "mine\n", dirty: true } },
      openTabs: ["gone.tex"],
      activePath: "gone.tex",
    });
    mocks.listFiles.mockResolvedValue(MAIN_ONLY);
    mocks.readFileContent.mockResolvedValue("");
    mocks.writeFileContent.mockResolvedValue({ path: "gone.tex", generation: 12 });

    await useFilesStore.getState().applyProjectStateChanged(event(Date.now() + 1));

    expect(mocks.toastInfo).toHaveBeenCalledWith(core.project.restoringUnsavedFiles);
  });
});

describe("import compatibility findings", () => {
  const MINTED = String.raw`\usepackage{minted}\usepackage{glossaries}\makeglossaries`;
  const BIBLATEX = String.raw`\usepackage[backend=biber,style=authoryear]{biblatex}`;
  const BIBLATEX_AND_SHELL = `${BIBLATEX}\n\\write18{ls}`;

  function primeScan(id: string, content: string) {
    mocks.getProject.mockResolvedValue({ ...META, id, main_doc: "main.tex" });
    mocks.projectMutationGeneration.mockResolvedValue(7);
    mocks.listFiles.mockResolvedValue(MAIN_ONLY);
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);
    mocks.readFileContent.mockResolvedValue(content);
    mocks.mcpSetActiveProject.mockResolvedValue(undefined);
  }

  it("offers the engine picker when a project has blockers", async () => {
    primeScan("blockers", MINTED);

    await useFilesStore.getState().openProject("blockers");
    await until(() => mocks.toastInfoUnique.mock.calls.length > 0);

    const [key, message, options] = mocks.toastInfoUnique.mock.calls[0];
    expect(key).toBe("engine-compatibility:blockers");
    expect(message).toContain("minted");
    expect(options?.label).toBe(core.compatibility.chooseEngine);
  });

  it("names the single biblatex note on its own", async () => {
    primeScan("biblatex", BIBLATEX);

    await useFilesStore.getState().openProject("biblatex");
    await until(() =>
      mocks.toastInfo.mock.calls.some(
        ([message]) => message === core.compatibility.biblatexBiber,
      ),
    );
  });

  it("counts several import notes together", async () => {
    primeScan("notes", BIBLATEX_AND_SHELL);

    const expected = core.compatibility.importNotes_other
      .replace("{{count}}", "2")
      .replace("{{title}}", "Bibliography uses biblatex / Biber")
      .replace("{{more}}", "1");

    await useFilesStore.getState().openProject("notes");
    await until(() =>
      mocks.toastInfo.mock.calls.some(([message]) => message === expected),
    );
  });
});

describe("external write over a queued save", () => {
  it("reports an external update that could not be persisted", async () => {
    let release: (value: { path: string; generation: number }) => void = () => {};
    const started = new Promise<void>((resolveStarted) => {
      mocks.writeFileContent.mockImplementationOnce(() => {
        resolveStarted();
        return new Promise<{ path: string; generation: number }>((resolve) => {
          release = resolve;
        });
      });
    });
    mocks.writeFileContent.mockRejectedValue(new Error("read only volume"));
    useFilesStore.setState({
      tree: WITH_BIB,
      files: { "references.bib": { content: "mine\n", dirty: true } },
      openTabs: ["references.bib"],
      activePath: "references.bib",
    });

    const write = useFilesStore.getState().saveFile("references.bib");
    await started;
    useFilesStore.setState({
      files: { "references.bib": { content: "mine\n", dirty: false } },
    });

    expect(
      useFilesStore.getState().applyExternalWrite("project", "references.bib", "theirs\n"),
    ).toBe(true);

    release({ path: "references.bib", generation: 9 });
    await write;
    await until(() =>
      mocks.notifyError.mock.calls.some(
        ([label]) => label === "preserve external file change",
      ),
    );
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "preserve external file change",
      expect.anything(),
      core.externalChange.persistExternalFailed.replace("{{path}}", "references.bib"),
    );
  });
});
