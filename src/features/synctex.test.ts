import { describe, it, expect, beforeEach, vi } from "vitest";

// Inverse SyncTeX reaches into the tauri bridge, the editor/pdf controllers and
// the files store. Mock them all so we can assert the multi-file switch logic.
const mocks = vi.hoisted(() => ({
  synctexInverse: vi.fn(),
  synctexForward: vi.fn(),
  synctexMapLine: vi.fn(),
  gotoLine: vi.fn(),
  selectWordNearLine: vi.fn(),
  getCurrentLine: vi.fn(),
  gotoRect: vi.fn(),
  openFile: vi.fn(),
  logError: vi.fn(),
  isCompileCheckpointCurrent: vi.fn(() => true),
  compiledSnapshot: null as null | {
    projectId: string;
    filesystemEpoch: number;
    texts: Record<string, string>;
  },
  index: {
    texts: {} as Record<string, string>,
  },
  state: {
    projectId: "proj" as string | null,
    mainDoc: "main.tex",
    engine: { capabilities: { supports_synctex: true } },
    engineLoaded: true,
    activePath: "main.tex" as string | null,
    tree: [] as { path: string; is_dir: boolean }[],
    files: {} as Record<string, { content: string; dirty: boolean }>,
  },
  compileCheckpoint: {
    version: 1 as const,
    projectId: "proj",
    mainDocument: "main.tex",
    projectRevision: 0,
    requestGeneration: 0,
    outputKind: "standard" as const,
    producerId: "test",
    outputRevision: 1,
    outputId: "pdf-v1:1:0000000000000000",
    completedAt: 1,
  },
}));

vi.mock("@/lib/tauri", () => ({
  synctexInverse: mocks.synctexInverse,
  synctexForward: mocks.synctexForward,
  synctexMapLine: mocks.synctexMapLine,
}));
vi.mock("@/components/editor/cm/controller", () => ({
  gotoLine: mocks.gotoLine,
  selectWordNearLine: mocks.selectWordNearLine,
  getCurrentLine: mocks.getCurrentLine,
}));
vi.mock("@/components/pdf/pdfController", () => ({ gotoRect: mocks.gotoRect }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ ...mocks.state, openFile: mocks.openFile }) },
}));
vi.mock("@/store/project-index", () => ({
  currentProjectSourcePaths: () =>
    mocks.state.tree
      .filter((entry) => !entry.is_dir)
      .map((entry) => entry.path),
  useIndexStore: { getState: () => mocks.index },
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/store/compile", () => ({
  isCompileCheckpointCurrent: mocks.isCompileCheckpointCurrent,
  useCompileStore: {
    getState: () => ({
      lastCompileCheckpoint: mocks.compileCheckpoint,
      compiledSources: mocks.compiledSnapshot,
    }),
  },
}));

import {
  canUseSyncTexForCheckpoint,
  forwardFromCursor,
  inverseFromClick,
} from "./synctex";

beforeEach(() => {
  // nextFrames() awaits rAF; run it synchronously so tests don't hang.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
  for (const k of [
    "synctexInverse",
    "gotoLine",
    "selectWordNearLine",
    "getCurrentLine",
    "openFile",
    "gotoRect",
    "logError",
  ] as const)
    mocks[k].mockReset();
  mocks.synctexForward.mockReset();
  mocks.synctexMapLine.mockReset().mockResolvedValue(null);
  mocks.isCompileCheckpointCurrent.mockReset().mockReturnValue(true);
  mocks.compiledSnapshot = null;
  mocks.index.texts = {};
  mocks.state.projectId = "proj";
  mocks.state.mainDoc = "main.tex";
  mocks.state.engine.capabilities.supports_synctex = true;
  mocks.state.engineLoaded = true;
  mocks.state.activePath = "main.tex";
  mocks.state.tree = [
    { path: "main.tex", is_dir: false },
    { path: "sections/intro.tex", is_dir: false },
  ];
  mocks.state.files = {
    "main.tex": { content: "alpha\nbeta\ngamma", dirty: false },
    "sections/intro.tex": {
      content: "intro one\nintro two",
      dirty: false,
    },
  };
  mocks.getCurrentLine.mockReturnValue(1);
});

describe("inverseFromClick (multi-file, 0.1.1 fix)", () => {
  it("switches to the child file when the click lands on \\input content", async () => {
    mocks.synctexInverse.mockResolvedValue({ file: "intro.tex", line: 12 });
    await inverseFromClick(1, 100, 200);
    expect(mocks.openFile).toHaveBeenCalledWith("sections/intro.tex");
    expect(mocks.gotoLine).toHaveBeenCalledWith(12);
  });

  it("does NOT reopen when the hit is already in the active file", async () => {
    mocks.synctexInverse.mockResolvedValue({ file: "main.tex", line: 4 });
    await inverseFromClick(1, 10, 10);
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(mocks.gotoLine).toHaveBeenCalledWith(4);
  });

  it("does nothing when synctex has no hit for that spot", async () => {
    mocks.synctexInverse.mockResolvedValue(null);
    await inverseFromClick(1, 10, 10);
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("selects the clicked PDF word when synctex has no exact coordinate hit", async () => {
    mocks.synctexInverse.mockResolvedValue(null);
    mocks.getCurrentLine.mockReturnValue(3);

    await inverseFromClick(1, 10, 10, "Introduction");

    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(3, "Introduction");
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("selects the clicked word before native inverse lookup finishes", async () => {
    let resolveHit: (value: null) => void = () => {};
    mocks.synctexInverse.mockReturnValue(
      new Promise((resolve) => {
        resolveHit = resolve;
      }),
    );
    mocks.getCurrentLine.mockReturnValue(3);

    const inverse = inverseFromClick(1, 10, 10, "Introduction");

    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(3, "Introduction");
    resolveHit(null);
    await inverse;
  });

  it("keeps the clicked word selected when native inverse lookup fails", async () => {
    mocks.synctexInverse.mockRejectedValue(new Error("native lookup failed"));
    mocks.getCurrentLine.mockReturnValue(3);

    await inverseFromClick(1, 10, 10, "Introduction");

    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(3, "Introduction");
  });

  it("no-ops with no project open (never calls into the backend)", async () => {
    mocks.state.projectId = null;
    await inverseFromClick(1, 10, 10);
    expect(mocks.synctexInverse).not.toHaveBeenCalled();
  });

  it("does not fake SyncTeX navigation for Typst projects", async () => {
    mocks.state.mainDoc = "main.typ";
    mocks.state.engine.capabilities.supports_synctex = false;
    await inverseFromClick(1, 10, 10);
    expect(mocks.synctexInverse).not.toHaveBeenCalled();
  });

  it("places the cursor on the clicked word and skips the line jump when found", async () => {
    mocks.synctexInverse.mockResolvedValue({ file: "main.tex", line: 7 });
    mocks.selectWordNearLine.mockReturnValue(true);
    await inverseFromClick(1, 10, 10, "If");
    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(7, "If");
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("falls back to the line when the clicked word isn't found near it", async () => {
    mocks.synctexInverse.mockResolvedValue({ file: "main.tex", line: 7 });
    mocks.selectWordNearLine.mockReturnValue(false);
    await inverseFromClick(1, 10, 10, "If");
    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(7, "If");
    expect(mocks.gotoLine).toHaveBeenCalledWith(7);
  });
});

describe("stale SyncTeX source translation", () => {
  beforeEach(() => {
    mocks.isCompileCheckpointCurrent.mockReturnValue(false);
    mocks.compiledSnapshot = {
      projectId: "proj",
      filesystemEpoch: 0,
      texts: {
        "main.tex": "alpha\nbeta\ngamma",
        "sections/intro.tex": "intro one\nintro two",
      },
    };
  });

  it("keeps inverse SyncTeX available and translates old PDF lines forward", async () => {
    mocks.state.files["main.tex"].content =
      "alpha\ninserted\nbeta\ngamma";
    mocks.synctexInverse.mockResolvedValue({
      file: "main.tex",
      line: 3,
    });
    mocks.synctexMapLine.mockResolvedValue(4);

    expect(
      canUseSyncTexForCheckpoint(mocks.compileCheckpoint),
    ).toBe(true);
    await inverseFromClick(
      1,
      10,
      10,
      undefined,
      mocks.compileCheckpoint,
    );

    expect(mocks.gotoLine).toHaveBeenCalledWith(4);
  });

  it("translates the live cursor back to its compiled source line", async () => {
    mocks.state.files["main.tex"].content =
      "alpha\ninserted\nbeta\ngamma";
    mocks.getCurrentLine.mockReturnValue(4);
    mocks.synctexForward.mockResolvedValue({
      page: 1,
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    mocks.synctexMapLine.mockResolvedValue(3);

    await forwardFromCursor();

    expect(mocks.synctexForward).toHaveBeenCalledWith(
      "proj",
      "main.tex",
      "main.tex",
      3,
    );
    expect(mocks.gotoRect).toHaveBeenCalledOnce();
  });

  it("uses the nearest unchanged anchor for a newly inserted line", async () => {
    mocks.state.files["main.tex"].content =
      "alpha\ninserted\nbeta\ngamma";
    mocks.getCurrentLine.mockReturnValue(2);
    mocks.synctexForward.mockResolvedValue({
      page: 1,
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    mocks.synctexMapLine.mockResolvedValue(1);

    await forwardFromCursor();

    expect(mocks.synctexForward).toHaveBeenCalledWith(
      "proj",
      "main.tex",
      "main.tex",
      1,
    );
  });

  it("rejects a click from a different retained PDF output", async () => {
    await inverseFromClick(1, 10, 10, undefined, {
      ...mocks.compileCheckpoint,
      outputRevision: 99,
    });

    expect(mocks.synctexInverse).not.toHaveBeenCalled();
  });
});
