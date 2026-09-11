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

import { useFilesStore } from "./files";

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
