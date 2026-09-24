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

import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import type { ProjectMeta, ProjectStateChanged } from "@oleafly/backend-port";
import { i18n } from "@/i18n";
import { engineHintDismissed } from "@/store/engine-picker";
import {
  engineErrorMessage,
  projectCompatibilityFindings,
  reportFileSaveFailure,
  saveFailureToastKey,
  texDistributionGapNotice,
  useFilesStore,
} from "./files";

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

function expectNoToasts() {
  for (const toastMock of [
    mocks.toastInfo,
    mocks.toastInfoUnique,
    mocks.toastSuccess,
    mocks.toastError,
    mocks.toastErrorUnique,
  ]) {
    expect(toastMock).not.toHaveBeenCalled();
  }
}

async function until(ready: () => boolean) {
  for (let i = 0; i < 200 && !ready(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(ready()).toBe(true);
}

describe("createFile", () => {
  it("does not refresh or open a created file after the project changes", async () => {
    let releaseCreate: (value: {
      status: "created";
      path: string;
      generation: number;
    }) => void = () => {};
    const started = new Promise<void>((resolveStarted) => {
      mocks.createFile.mockImplementationOnce(() => {
        resolveStarted();
        return new Promise((resolve) => {
          releaseCreate = resolve;
        });
      });
    });

    const creation = useFilesStore.getState().createFile("notes.tex", false);
    await started;
    useFilesStore.setState({
      projectId: "next-project",
      tree: [{ path: "notes.tex", is_dir: false }],
      files: {},
      openTabs: [],
      activePath: null,
    });
    releaseCreate({ status: "created", path: "notes.tex", generation: 4 });
    await creation;

    expect(mocks.listFiles).not.toHaveBeenCalled();
    expect(mocks.readFileContent).not.toHaveBeenCalled();
    expect(useFilesStore.getState().activePath).toBeNull();
  });
});

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

  it("retries an engine that will not load and leaves the report to the toolbar", async () => {
    primeOpen();
    mocks.getProjectEngine.mockRejectedValue(new Error("engine gone"));
    mocks.projectTexStatus.mockResolvedValue(texStatus());

    await useFilesStore.getState().openProject("opened");
    await settle();

    expect(mocks.getProjectEngine).toHaveBeenCalledTimes(3);
    expect(useFilesStore.getState().engineError).toBe("loadFailed");
    expect(mocks.logError).toHaveBeenCalledWith("load document engine", expect.any(Error));
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expectNoToasts();
  });

  it("recovers from an engine load hiccup without telling anyone", async () => {
    primeOpen();
    mocks.getProjectEngine
      .mockRejectedValueOnce(new Error("ipc busy"))
      .mockResolvedValue(LATEXMK_ENGINE);
    mocks.projectTexStatus.mockResolvedValue(texStatus());

    await useFilesStore.getState().openProject("opened");

    expect(mocks.getProjectEngine).toHaveBeenCalledTimes(2);
    expect(useFilesStore.getState()).toMatchObject({
      engine: LATEXMK_ENGINE,
      engineLoaded: true,
      engineError: null,
    });
    expect(mocks.logError).not.toHaveBeenCalledWith("load document engine", expect.anything());
    expectNoToasts();
  });

  it("logs pinned packages this machine lacks and leaves the install offer to the compile", async () => {
    primeOpen();
    mocks.projectTexStatus.mockResolvedValue(
      texStatus({ missing_packages: ["tools", "pgf"], can_install_missing: true }),
    );

    await useFilesStore.getState().openProject("opened");
    await until(() =>
      mocks.logError.mock.calls.some(([scope]) => scope === "tex pin status"),
    );

    expect(mocks.logError).toHaveBeenCalledWith(
      "tex pin status",
      "2 pinned packages are not installed: pgf,tools",
    );
    expect(mocks.tlmgrInstall).not.toHaveBeenCalled();
    expect(texDistributionGapNotice("opened")).toBeNull();
    expectNoToasts();
  });

  it("remembers a huge gap for the compile instead of announcing it on open", async () => {
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
    await until(() => texDistributionGapNotice("opened") !== null);

    expect(texDistributionGapNotice("opened")).toBe(
      core.tex.distributionGap
        .replace("{{pinned}}", "TeX Live 2026")
        .replace("{{local}}", "TinyTeX")
        .replace("{{count}}", "40"),
    );
    expectNoToasts();

    mocks.projectTexStatus.mockResolvedValue(texStatus());
    await useFilesStore.getState().openProject("opened");
    await until(() => texDistributionGapNotice("opened") === null);
  });

  it("logs a differing local distribution without a toast", async () => {
    primeOpen();
    mocks.projectTexStatus.mockResolvedValue(
      texStatus({
        distribution_differs: true,
        pinned_label: "TeX Live 2026",
        local_label: "TinyTeX",
      }),
    );

    await useFilesStore.getState().openProject("opened");
    await until(() =>
      mocks.logError.mock.calls.some(([scope]) => scope === "tex pin status"),
    );

    expect(mocks.logError).toHaveBeenCalledWith(
      "tex pin status",
      "pinned with TeX Live 2026, compiling with TinyTeX",
    );
    expectNoToasts();
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

    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(useFilesStore.getState().projectId).toBe("project");
    expect(useFilesStore.getState().saveBlocked).toEqual({
      action: "switch",
      targetProjectId: "opened",
      failures: [{ path: "main.tex", reason: "read only volume" }],
    });
    expect(useFilesStore.getState().files["main.tex"]?.dirty).toBe(true);
  });

  it("switches after the user discards the unsaved changes that blocked it", async () => {
    primeOpen(LATEX_ENGINE);
    useFilesStore.setState({
      projectId: "project",
      files: { "main.tex": { content: "dirty\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockRejectedValue(new Error("read only volume"));
    await useFilesStore.getState().openProject("opened");
    expect(useFilesStore.getState().saveBlocked?.action).toBe("switch");

    await useFilesStore.getState().discardUnsavedAndLeave();

    expect(useFilesStore.getState().saveBlocked).toBeNull();
    expect(useFilesStore.getState().projectId).toBe("opened");
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

    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(useFilesStore.getState().projectId).toBe("project");
    expect(useFilesStore.getState().saveBlocked).toEqual({
      action: "close",
      targetProjectId: null,
      failures: [{ path: "main.tex", reason: "read only volume" }],
    });
  });

  it("names every file that failed and brings the first one to the front", async () => {
    useFilesStore.setState({
      projectId: "project",
      files: {
        "main.tex": { content: "ok\n", dirty: true },
        "project.json": { content: "{}", dirty: true },
        "notes/todo.tex": { content: "x\n", dirty: true },
      },
      openTabs: ["main.tex", "project.json", "notes/todo.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockImplementation(async (_project: string, path: string) => {
      if (path === "project.json") {
        throw new Error("project.json is managed by Oleafly and cannot be changed as a project file");
      }
      if (path === "notes/todo.tex") throw new Error("disk full");
      return { generation: 1 };
    });

    await useFilesStore.getState().closeProject();

    const blocked = useFilesStore.getState().saveBlocked;
    expect(blocked?.failures.map((failure) => failure.path)).toEqual([
      "project.json",
      "notes/todo.tex",
    ]);
    expect(blocked?.failures[0]?.reason).toContain("managed by Oleafly");
    expect(useFilesStore.getState().activePath).toBe("project.json");
    expect(useFilesStore.getState().files["main.tex"]?.dirty).toBe(false);
  });

  it("closes after the user discards the unsaved changes that blocked it", async () => {
    useFilesStore.setState({
      projectId: "project",
      files: { "project.json": { content: "{}", dirty: true } },
      openTabs: ["project.json"],
      activePath: "project.json",
    });
    mocks.writeFileContent.mockRejectedValue(new Error("managed by Oleafly"));
    await useFilesStore.getState().closeProject();
    expect(useFilesStore.getState().saveBlocked?.action).toBe("close");

    await useFilesStore.getState().discardUnsavedAndLeave();

    expect(useFilesStore.getState().saveBlocked).toBeNull();
    expect(useFilesStore.getState().projectId).toBeNull();
  });

  it("dismissing the blocked dialog keeps the project and its unsaved buffer", async () => {
    useFilesStore.setState({
      projectId: "project",
      files: { "project.json": { content: "{}", dirty: true } },
      openTabs: ["project.json"],
      activePath: "project.json",
    });
    mocks.writeFileContent.mockRejectedValue(new Error("managed by Oleafly"));
    await useFilesStore.getState().closeProject();

    useFilesStore.getState().dismissSaveBlocked();

    expect(useFilesStore.getState().saveBlocked).toBeNull();
    expect(useFilesStore.getState().projectId).toBe("project");
    expect(useFilesStore.getState().files["project.json"]?.dirty).toBe(true);
  });
});

describe("setContent", () => {
  it("never marks a file the backend manages as dirty", () => {
    useFilesStore.setState({
      projectId: "project",
      files: { "project.json": { content: "{}", dirty: false } },
      openTabs: ["project.json"],
      activePath: "project.json",
    });

    useFilesStore.getState().setContent("project.json", "{\"main\": \"x\"}");

    expect(useFilesStore.getState().files["project.json"]).toEqual({
      content: "{}",
      dirty: false,
    });
  });
});

describe("importProject", () => {
  it("lets the opened project confirm the import", async () => {
    primeOpen(LATEX_ENGINE);
    mocks.importOverleafProjectCmd.mockResolvedValue("opened");
    mocks.projectTexStatus.mockResolvedValue(texStatus());

    await expect(useFilesStore.getState().importProject("/tmp/paper.zip")).resolves.toBe(
      "opened",
    );
    await settle();

    expect(useFilesStore.getState().projectId).toBe("opened");
    expectNoToasts();
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
  it("keeps a local edit that an external write raced without a toast", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "mine\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockResolvedValue({ path: "main.tex", generation: 11 });

    expect(
      useFilesStore.getState().applyExternalWrite("project", "main.tex", "theirs\n"),
    ).toBe(false);
    expect(mocks.logError).toHaveBeenCalledWith("external write kept local edit", "main.tex");
    expectNoToasts();
  });

  it("logs a local edit that could not be written back and queues it for autosave", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "mine\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockRejectedValue(new Error("read only volume"));

    useFilesStore.getState().applyExternalWrite("project", "main.tex", "theirs\n");
    await until(() =>
      mocks.logError.mock.calls.some(([scope]) => scope === "preserve local file change"),
    );

    expect(useFilesStore.getState().files["main.tex"]?.dirty).toBe(true);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expectNoToasts();
  });

  it("restores unsaved edits that an external delete removed without a toast", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "mine\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockResolvedValue({ path: "main.tex", generation: 11 });

    expect(useFilesStore.getState().applyExternalDelete("project", "main.tex")).toBe(
      false,
    );
    expect(mocks.logError).toHaveBeenCalledWith("external delete kept unsaved files", "main.tex");
    expectNoToasts();
  });

  it("logs an unsaved edit that could not be restored after a delete", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "mine\n", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.writeFileContent.mockRejectedValue(new Error("read only volume"));

    useFilesStore.getState().applyExternalDelete("project", "main.tex");
    await until(() =>
      mocks.logError.mock.calls.some(
        ([scope]) => scope === "restore local file after external delete",
      ),
    );

    expect(mocks.notifyError).not.toHaveBeenCalled();
    expectNoToasts();
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

  it("reports files it could not reload in one keyed toast", async () => {
    mocks.listFiles
      .mockRejectedValueOnce(new Error("tree unavailable"))
      .mockResolvedValueOnce(MAIN_ONLY)
      .mockRejectedValueOnce(new Error("tree unavailable"))
      .mockResolvedValue(MAIN_ONLY);

    const first = await useFilesStore
      .getState()
      .applyProjectStateChanged(event(Date.now()));
    const second = await useFilesStore
      .getState()
      .applyProjectStateChanged(event(Date.now() + 1));

    expect([first, second]).toEqual([false, false]);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith(
      "reload project after external change",
      expect.any(Error),
    );
    expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(2);
    for (const call of mocks.toastErrorUnique.mock.calls) {
      expect(call).toEqual(["project-reload:project", core.externalChange.reloadFailed]);
    }
  });

  it("restores unsaved files a project update removed without a toast", async () => {
    useFilesStore.setState({
      files: { "gone.tex": { content: "mine\n", dirty: true } },
      openTabs: ["gone.tex"],
      activePath: "gone.tex",
    });
    mocks.listFiles.mockResolvedValue(MAIN_ONLY);
    mocks.readFileContent.mockResolvedValue("");
    mocks.writeFileContent.mockResolvedValue({ path: "gone.tex", generation: 12 });

    await useFilesStore.getState().applyProjectStateChanged(event(Date.now() + 2));

    expect(mocks.logError).toHaveBeenCalledWith(
      "restore unsaved files after project update",
      "gone.tex",
    );
    expect(useFilesStore.getState().files["gone.tex"]).toMatchObject({ content: "mine\n" });
    expectNoToasts();
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

  it("remembers blockers for the compile instead of prompting on open", async () => {
    primeScan("blockers", MINTED);

    await useFilesStore.getState().openProject("blockers");
    await until(() => projectCompatibilityFindings("blockers").length > 0);

    const ids = projectCompatibilityFindings("blockers").map((finding) => finding.id);
    expect(ids).toContain("minted");
    expect(mocks.logError).toHaveBeenCalledWith(
      "project compatibility",
      expect.stringContaining("minted"),
    );
    expectNoToasts();
  });

  it("forgets remembered blockers once the user keeps the bundled engine", async () => {
    primeScan("kept", MINTED);

    await useFilesStore.getState().openProject("kept");
    await until(() => projectCompatibilityFindings("kept").length > 0);
    localStorage.setItem(
      "oleafly.engineHint.kept",
      projectCompatibilityFindings("kept").map((finding) => finding.id).join(","),
    );

    expect(projectCompatibilityFindings("kept")).toEqual([]);
  });

  it("logs the single biblatex note and remembers it as seen", async () => {
    primeScan("biblatex", BIBLATEX);

    await useFilesStore.getState().openProject("biblatex");
    await until(() =>
      mocks.logError.mock.calls.some(([scope]) => scope === "project compatibility"),
    );

    expect(mocks.logError).toHaveBeenCalledWith(
      "project compatibility",
      "import notes found on open: biblatex-biber",
    );
    expect(
      engineHintDismissed("biblatex", [
        { id: "biblatex-biber", level: "warning", title: "", detail: "" },
      ]),
    ).toBe(true);
    expect(projectCompatibilityFindings("biblatex")).toEqual([]);
    expectNoToasts();
  });

  it("logs several import notes together", async () => {
    primeScan("notes", BIBLATEX_AND_SHELL);

    await useFilesStore.getState().openProject("notes");
    await until(() =>
      mocks.logError.mock.calls.some(([scope]) => scope === "project compatibility"),
    );

    const [, detail] =
      mocks.logError.mock.calls.find(([scope]) => scope === "project compatibility") ?? [];
    expect(detail).toContain("biblatex-biber");
    expect(String(detail).split(", ")).toHaveLength(2);
    expectNoToasts();
  });
});

describe("external write over a queued save", () => {
  it("logs an external update that could not be persisted and keeps it dirty", async () => {
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
      mocks.logError.mock.calls.some(
        ([label]) => label === "preserve external file change",
      ),
    );
    expect(useFilesStore.getState().files["references.bib"]).toEqual({
      content: "theirs\n",
      dirty: true,
    });
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expectNoToasts();
  });
});


describe("autosave failures", () => {
  const AUTOSAVE_MS = 1_500;
  let projectRun = 0;
  let projectId = "";

  function autosaveFailedCopy() {
    return i18n.t(($) => $.core.project.autosaveFailed);
  }

  function autosaveLogs() {
    return mocks.logError.mock.calls.filter(([scope]) => scope === "autosave").length;
  }

  beforeEach(() => {
    projectRun += 1;
    projectId = `autosave-project-${projectRun}`;
    useFilesStore.setState({
      projectId,
      files: { "main.tex": { content: "start\n", dirty: false } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.toastErrorUnique.mockReturnValue(41);
  });

  afterEach(async () => {
    useFilesStore.setState({ files: {}, saveBlocked: null });
    await useFilesStore.getState().closeProject();
  });

  it("shows one sticky error for automatic saves and does not raise it again after a save lands", async () => {
    vi.useFakeTimers();
    try {
      mocks.writeFileContent.mockRejectedValue(new Error("disk full"));
      for (const content of ["a\n", "ab\n", "abc\n"]) {
        useFilesStore.getState().setContent("main.tex", content);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      }
      await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(autosaveLogs()).toBe(3));

      expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);
      expect(mocks.toastErrorUnique).toHaveBeenCalledWith(
        saveFailureToastKey(projectId),
        autosaveFailedCopy(),
        undefined,
        true,
      );
      expect(mocks.notifyError).not.toHaveBeenCalled();

      mocks.writeFileContent.mockResolvedValue({ path: "main.tex", generation: 9 });
      useFilesStore.getState().setContent("main.tex", "abcd\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() => expect(mocks.toastDismiss).toHaveBeenCalledWith(41));
      expect(useFilesStore.getState().files["main.tex"]?.dirty).toBe(false);

      for (let cycle = 1; cycle <= 3; cycle++) {
        mocks.writeFileContent.mockRejectedValue(new Error("disk full"));
        useFilesStore.getState().setContent("main.tex", `failed ${cycle}\n`);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
        await vi.waitFor(() => expect(autosaveLogs()).toBe(3 + cycle));

        mocks.writeFileContent.mockResolvedValue({ path: "main.tex", generation: 9 });
        useFilesStore.getState().setContent("main.tex", `saved ${cycle}\n`);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
        await vi.waitFor(() =>
          expect(useFilesStore.getState().files["main.tex"]).toMatchObject({
            content: `saved ${cycle}\n`,
            dirty: false,
          }),
        );
      }

      expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);
      expect(mocks.notifyError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet about automatic saves after the project is closed and opened again", async () => {
    vi.useFakeTimers();
    try {
      mocks.writeFileContent.mockRejectedValue(new Error("disk full"));
      useFilesStore.getState().setContent("main.tex", "typed\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() => expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1));

      useFilesStore.setState({ files: { "main.tex": { content: "typed\n", dirty: false } } });
      await useFilesStore.getState().closeProject();
      useFilesStore.setState({
        projectId,
        files: { "main.tex": { content: "start\n", dirty: false } },
        openTabs: ["main.tex"],
        activePath: "main.tex",
      });
      useFilesStore.getState().setContent("main.tex", "typed again\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() => expect(autosaveLogs()).toBe(2));

      expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the error up while another file still fails to save", async () => {
    vi.useFakeTimers();
    try {
      useFilesStore.setState({
        files: {
          "main.tex": { content: "start\n", dirty: false },
          "notes.tex": { content: "notes\n", dirty: false },
        },
        openTabs: ["main.tex", "notes.tex"],
      });
      mocks.writeFileContent.mockImplementation(async (_project: string, path: string) => {
        if (path === "notes.tex") throw new Error("permission denied");
        return { path, generation: 9 };
      });

      useFilesStore.getState().setContent("notes.tex", "notes, edited\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() => expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1));

      useFilesStore.getState().setContent("main.tex", "main, edited\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() =>
        expect(useFilesStore.getState().files["main.tex"]?.dirty).toBe(false),
      );

      expect(useFilesStore.getState().files["notes.tex"]?.dirty).toBe(true);
      expect(mocks.toastDismiss).not.toHaveBeenCalled();
      expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a generation conflict quietly", async () => {
    vi.useFakeTimers();
    try {
      mocks.writeFileContent
        .mockRejectedValueOnce(
          new Error("mutation conflict at generation 8: the target changed after expectedGeneration"),
        )
        .mockResolvedValue({ path: "main.tex", generation: 9 });

      useFilesStore.getState().setContent("main.tex", "typed\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() =>
        expect(useFilesStore.getState().files["main.tex"]?.dirty).toBe(false),
      );

      expect(mocks.writeFileContent).toHaveBeenCalledTimes(2);
      expect(mocks.logError).toHaveBeenCalledWith("autosave", expect.any(Error));
      expect(mocks.notifyError).not.toHaveBeenCalled();
      expectNoToasts();
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers every explicit save that fails, but not repeated autosaves", async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error("disk full");
      mocks.writeFileContent.mockRejectedValue(failure);
      useFilesStore.getState().setContent("main.tex", "typed\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() => expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1));

      reportFileSaveFailure("editor save", projectId, "main.tex", failure, true);
      reportFileSaveFailure("editor save", projectId, "main.tex", failure, true);
      expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(3);
      expect(mocks.toastErrorUnique).toHaveBeenLastCalledWith(
        saveFailureToastKey(projectId),
        autosaveFailedCopy(),
        undefined,
        true,
      );

      useFilesStore.getState().setContent("main.tex", "typed more\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(2));
      expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the error once the failing file no longer has unsaved changes", async () => {
    vi.useFakeTimers();
    try {
      mocks.writeFileContent.mockRejectedValue(new Error("disk full"));
      useFilesStore.getState().setContent("main.tex", "typed\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() => expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1));

      useFilesStore.setState({ files: {}, openTabs: [], activePath: null });

      expect(mocks.toastDismiss).toHaveBeenCalledWith(41);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the error when the project closes", async () => {
    vi.useFakeTimers();
    try {
      mocks.writeFileContent.mockRejectedValue(new Error("disk full"));
      useFilesStore.getState().setContent("main.tex", "typed\n");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.waitFor(() => expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1));

      useFilesStore.setState({ files: { "main.tex": { content: "typed\n", dirty: false } } });
      await useFilesStore.getState().closeProject();

      expect(mocks.toastDismiss).toHaveBeenCalledWith(41);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("engine setting failures", () => {
  beforeEach(() => {
    useFilesStore.setState({ engine: LATEX_ENGINE, engineLoaded: true, engineError: null });
  });

  it("logs a refused main document, reloads the unchanged engine and leaves the report to the caller", async () => {
    const failure = new Error("not a source file");
    mocks.setMainDocCmd.mockRejectedValue(failure);
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);

    await expect(useFilesStore.getState().setMainDoc("figure.png")).rejects.toBe(failure);

    expect(useFilesStore.getState()).toMatchObject({
      mainDoc: "main.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
      engineError: null,
    });
    expect(mocks.logError).toHaveBeenCalledWith("set main document", failure);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expectNoToasts();
  });

  it("logs a refused engine switch and keeps the project compilable", async () => {
    const failure = new Error("latexmk is not installed");
    mocks.setProjectEngineCmd.mockRejectedValue(failure);
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);

    await expect(useFilesStore.getState().setEngine("latexmk")).rejects.toBe(failure);

    expect(useFilesStore.getState()).toMatchObject({
      engine: LATEX_ENGINE,
      engineLoaded: true,
      engineError: null,
    });
    expect(mocks.logError).toHaveBeenCalledWith("set compile engine", failure);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expectNoToasts();
  });

  it("marks the engine unavailable when it cannot be reloaded after a refused switch", async () => {
    const failure = new Error("latexmk is not installed");
    mocks.setProjectEngineCmd.mockRejectedValue(failure);
    mocks.getProjectEngine.mockRejectedValue(new Error("engine gone"));

    await expect(useFilesStore.getState().setEngine("latexmk")).rejects.toBe(failure);

    expect(mocks.getProjectEngine).toHaveBeenCalledTimes(3);
    expect(useFilesStore.getState()).toMatchObject({
      engineLoaded: false,
      engineError: "loadFailed",
    });
    expect(mocks.logError).toHaveBeenCalledWith("load document engine", expect.any(Error));
    expectNoToasts();
  });

  it("logs a refused external command setting and leaves the report to the picker", async () => {
    const failure = new Error("project.json is read only");
    mocks.setProjectShellEscapeCmd.mockRejectedValue(failure);

    await expect(useFilesStore.getState().setShellEscape(true)).rejects.toBe(failure);

    expect(mocks.logError).toHaveBeenCalledWith("allow external TeX commands", failure);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expectNoToasts();
  });

  it("retries the engine after the main document is renamed and only logs a lasting failure", async () => {
    mocks.renameFile.mockResolvedValue("paper.tex");
    mocks.getProjectEngine.mockRejectedValue(new Error("engine gone"));

    await expect(useFilesStore.getState().renameEntry("main.tex", "paper.tex")).resolves.toBe(
      "paper.tex",
    );

    expect(mocks.getProjectEngine).toHaveBeenCalledTimes(3);
    expect(useFilesStore.getState()).toMatchObject({
      mainDoc: "paper.tex",
      engineLoaded: false,
      engineError: "renameReloadFailed",
    });
    expect(mocks.logError).toHaveBeenCalledWith("rename main document", expect.any(Error));
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expectNoToasts();
  });

  it("recovers the engine after the main document is renamed through a brief failure", async () => {
    mocks.renameFile.mockResolvedValue("paper.tex");
    mocks.getProjectEngine
      .mockRejectedValueOnce(new Error("ipc busy"))
      .mockResolvedValue(LATEX_ENGINE);

    await useFilesStore.getState().renameEntry("main.tex", "paper.tex");

    expect(useFilesStore.getState()).toMatchObject({
      mainDoc: "paper.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
      engineError: null,
    });
    expectNoToasts();
  });
});
