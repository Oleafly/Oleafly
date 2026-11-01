import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  synctexInverse: vi.fn(),
  synctexForward: vi.fn(),
  synctexMapLine: vi.fn(),
  gotoLine: vi.fn(),
  selectWordNearLine: vi.fn(),
  getCurrentLine: vi.fn(),
  gotoRect: vi.fn(),
  pdfPageText: vi.fn(async () => null as unknown),
  wordAtCursor: vi.fn(() => null as unknown),
  pickForwardLine: vi.fn(() => null as unknown),
  findWordOnPages: vi.fn(() => null as unknown),
  linesFromAnchor: vi.fn(() => [] as unknown[]),
  selectWordAt: vi.fn(() => false),
  getEditorView: vi.fn(),
  typstForward: vi.fn(),
  typstInverse: vi.fn(),
  watchTypstSyncProject: vi.fn(),
  openFile: vi.fn(),
  openProjectLocation: vi.fn(async () => true),
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
    engine: { id: "latex", source_extensions: ["tex"], capabilities: { supports_synctex: true } },
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
  getEditorView: mocks.getEditorView,
  wordAtCursor: mocks.wordAtCursor,
  pickForwardLine: mocks.pickForwardLine,
  findWordOnPages: mocks.findWordOnPages,
  linesFromAnchor: mocks.linesFromAnchor,
  selectWordAt: mocks.selectWordAt,
}));
vi.mock("@/features/typst-sync", () => ({
  typstForward: mocks.typstForward,
  typstInverse: mocks.typstInverse,
  watchTypstSyncProject: mocks.watchTypstSyncProject,
}));
vi.mock("@/components/pdf/pdfController", () => ({ gotoRect: mocks.gotoRect, pdfPageText: mocks.pdfPageText }));
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
vi.mock("@/lib/open-location", () => ({ openProjectLocation: mocks.openProjectLocation }));
vi.mock("@/store/compile", () => ({
  isCompileCheckpointCurrent: mocks.isCompileCheckpointCurrent,
  useCompileStore: {
    getState: () => ({
      lastCompileCheckpoint: mocks.compileCheckpoint,
      compiledSources: mocks.compiledSnapshot,
    }),
  },
}));

import { useSettingsStore } from "@/store/settings";
import {
  canUseSyncTexForCheckpoint,
  forwardFromCursor,
  goToSyncTex,
  inverseFromClick,
  openFileAndGotoLine,
} from "./synctex";

beforeEach(() => {
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
  mocks.openProjectLocation.mockClear();
  mocks.synctexForward.mockReset();
  mocks.pdfPageText.mockReset().mockResolvedValue(null);
  mocks.wordAtCursor.mockReset().mockReturnValue(null);
  mocks.pickForwardLine.mockReset().mockReturnValue(null);
  mocks.findWordOnPages.mockReset().mockReturnValue(null);
  mocks.linesFromAnchor.mockReset().mockReturnValue([]);
  mocks.selectWordAt.mockReset().mockReturnValue(false);
  mocks.typstForward.mockReset().mockResolvedValue(null);
  mocks.typstInverse.mockReset().mockResolvedValue(null);
  mocks.watchTypstSyncProject.mockReset();
  mocks.getEditorView.mockReset().mockReturnValue(null);
  mocks.state.engine.id = "latex";
  mocks.state.engine.source_extensions = ["tex"];
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

    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(3, "Introduction", undefined);
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

    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(3, "Introduction", undefined);
    resolveHit(null);
    await inverse;
  });

  it("keeps the clicked word selected when native inverse lookup fails", async () => {
    mocks.synctexInverse.mockRejectedValue(new Error("native lookup failed"));
    mocks.getCurrentLine.mockReturnValue(3);

    await inverseFromClick(1, 10, 10, "Introduction");

    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(3, "Introduction", undefined);
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
    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(7, "If", undefined);
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("hands the text around the clicked word to both word lookups", async () => {
    const context = { before: "Cats and dogs ", after: " birds and fish." };
    mocks.synctexInverse.mockResolvedValue({ file: "main.tex", line: 7 });
    mocks.getCurrentLine.mockReturnValue(2);
    mocks.selectWordNearLine.mockReturnValue(true);
    await inverseFromClick(1, 10, 10, "and", null, context);
    expect(mocks.selectWordNearLine.mock.calls).toEqual([
      [2, "and", context],
      [7, "and", context],
    ]);
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("falls back to the line when the clicked word isn't found near it", async () => {
    mocks.synctexInverse.mockResolvedValue({ file: "main.tex", line: 7 });
    mocks.selectWordNearLine.mockReturnValue(false);
    await inverseFromClick(1, 10, 10, "If");
    expect(mocks.selectWordNearLine).toHaveBeenCalledWith(7, "If", undefined);
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

describe("source locations in projects with repeated or unusual file names", () => {
  it("opens the file SyncTeX names among files that share a basename", async () => {
    mocks.state.tree = [
      { path: "main.tex", is_dir: false },
      { path: "cast/a/intro.tex", is_dir: false },
      { path: "cast/b/intro.tex", is_dir: false },
    ];
    mocks.synctexInverse.mockResolvedValue({ file: "cast/b/intro.tex", line: 3 });
    await inverseFromClick(1, 100, 228);
    expect(mocks.openFile).toHaveBeenCalledWith("cast/b/intro.tex");
    expect(mocks.gotoLine).toHaveBeenCalledWith(3);
  });

  it("does not jump inside the active file when the hit cannot be resolved", async () => {
    mocks.state.tree = [
      { path: "main.tex", is_dir: false },
      { path: "cast/a/intro.tex", is_dir: false },
      { path: "cast/b/intro.tex", is_dir: false },
    ];
    mocks.synctexInverse.mockResolvedValue({ file: "intro.tex", line: 3 });
    await inverseFromClick(1, 100, 228);
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("opens an NFD-named file for the NFC name TeX recorded", async () => {
    const decomposed = "kapitoly/u\u0301vod.tex";
    mocks.state.tree = [
      { path: "main.tex", is_dir: false },
      { path: decomposed, is_dir: false },
    ];
    mocks.synctexInverse.mockResolvedValue({ file: "kapitoly/\u00favod.tex", line: 2 });
    await inverseFromClick(1, 100, 100);
    expect(mocks.openFile).toHaveBeenCalledWith(decomposed);
  });

  it("opens kapitoly/úvod.tex for Tectonic's extensionless log name", async () => {
    mocks.state.tree = [
      { path: "main.tex", is_dir: false },
      { path: "kapitoly/úvod.tex", is_dir: false },
    ];
    await openFileAndGotoLine("./kapitoly/úvod", 2);
    expect(mocks.openProjectLocation).toHaveBeenCalledExactlyOnceWith({
      path: "kapitoly/úvod.tex",
      line: 2,
    });
  });

  it("leaves the editor alone for a location in a file outside the project", async () => {
    await openFileAndGotoLine("/usr/local/texlive/2025/texmf-dist/tex/latex/base/article.cls", 40);
    expect(mocks.openProjectLocation).not.toHaveBeenCalled();
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("still jumps within the active file for a location without a file", async () => {
    await openFileAndGotoLine(null, 5);
    expect(mocks.openProjectLocation).not.toHaveBeenCalled();
    expect(mocks.gotoLine).toHaveBeenCalledWith(5);
  });

  it("carries a compile error's column to the exact position", async () => {
    mocks.state.tree = [
      { path: "main.typ", is_dir: false },
      { path: "chapters/intro.typ", is_dir: false },
    ];
    await openFileAndGotoLine("chapters/intro.typ", 3, 8);
    expect(mocks.openProjectLocation).toHaveBeenCalledExactlyOnceWith({
      path: "chapters/intro.typ",
      line: 3,
      column: 8,
    });
    await openFileAndGotoLine(null, 4, 2);
    expect(mocks.gotoLine).toHaveBeenCalledWith(4, 2);
  });
});

describe("Typst sync through the Tinymist preview server", () => {
  const rect = { page: 2, x: 70, y: 87, width: 96, height: 12 };

  beforeEach(() => {
    mocks.state.engine.id = "typst";
    mocks.state.engine.source_extensions = ["typ"];
    mocks.state.mainDoc = "main.typ";
    mocks.state.activePath = "main.typ";
    mocks.compileCheckpoint.mainDocument = "main.typ";
    mocks.state.tree = [
      { path: "main.typ", is_dir: false },
      { path: "chapters/intro.typ", is_dir: false },
    ];
    mocks.state.files = {
      "main.typ": { content: "= Title\nHello world\nMore", dirty: false },
      "chapters/intro.typ": { content: "Intro one\nIntro two\nIntro three", dirty: false },
    };
    mocks.getCurrentLine.mockReturnValue(2);
    mocks.getEditorView.mockReturnValue({
      state: {
        selection: { main: { head: 11 } },
        doc: { lineAt: () => ({ from: 8 }) },
      },
    });
  });

  afterEach(() => {
    mocks.compileCheckpoint.mainDocument = "main.tex";
  });

  it("moves the PDF to the cursor's line and column without SyncTeX", async () => {
    mocks.typstForward.mockResolvedValue(rect);

    await forwardFromCursor();

    expect(mocks.typstForward).toHaveBeenCalledWith({
      projectId: "proj",
      mainDoc: "main.typ",
      file: "main.typ",
      line: 2,
      column: 3,
    });
    expect(mocks.watchTypstSyncProject).toHaveBeenCalledWith("proj");
    expect(mocks.synctexForward).not.toHaveBeenCalled();
    expect(mocks.gotoRect).toHaveBeenCalledWith(rect);
  });

  it("drops the column once the cursor line had to be mapped to an older compile", async () => {
    mocks.isCompileCheckpointCurrent.mockReturnValue(false);
    mocks.compiledSnapshot = {
      projectId: "proj",
      filesystemEpoch: 0,
      texts: { "main.typ": "= Title\nMore", "chapters/intro.typ": "Intro one\nIntro two\nIntro three" },
    };
    mocks.synctexMapLine.mockResolvedValue(1);
    mocks.typstForward.mockResolvedValue(rect);

    await forwardFromCursor();

    expect(mocks.typstForward).toHaveBeenCalledWith({
      projectId: "proj",
      mainDoc: "main.typ",
      file: "main.typ",
      line: 1,
      column: null,
    });
    expect(mocks.gotoRect).toHaveBeenCalledWith(rect);
  });

  it("selects the word at the exact character clicked in the PDF", async () => {
    mocks.typstInverse.mockResolvedValue({ file: "chapters/intro.typ", line: 3, column: 4 });
    mocks.selectWordAt.mockReturnValue(true);

    await inverseFromClick(2, 120, 340, "three");

    expect(mocks.typstInverse).toHaveBeenCalledWith({
      projectId: "proj",
      mainDoc: "main.typ",
      page: 2,
      x: 120,
      y: 340,
    });
    expect(mocks.synctexInverse).not.toHaveBeenCalled();
    expect(mocks.openFile).toHaveBeenCalledWith("chapters/intro.typ");
    expect(mocks.selectWordAt).toHaveBeenCalledWith(3, 4, "three");
    expect(mocks.selectWordNearLine).not.toHaveBeenCalledWith(3, "three", undefined);
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("looks for the clicked word around the line when the server points elsewhere, as for link text", async () => {
    const context = { before: "see the ", after: " page for" };
    mocks.typstInverse.mockResolvedValue({ file: "main.typ", line: 2, column: 1 });
    mocks.selectWordNearLine.mockImplementation((line: number) => line === 2);

    await inverseFromClick(1, 10, 10, "field", null, context);

    expect(mocks.selectWordAt).toHaveBeenCalledWith(2, 1, "field");
    expect(mocks.selectWordNearLine).toHaveBeenLastCalledWith(2, "field", context);
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("puts the cursor on the exact character when the clicked word is not found", async () => {
    mocks.typstInverse.mockResolvedValue({ file: "chapters/intro.typ", line: 3, column: 4 });

    await inverseFromClick(2, 120, 340, "three");

    expect(mocks.gotoLine).toHaveBeenCalledWith(3, 5);
  });

  it("falls back to the clicked word when the PDF is older than the editor", async () => {
    mocks.isCompileCheckpointCurrent.mockReturnValue(false);
    mocks.compiledSnapshot = {
      projectId: "proj",
      filesystemEpoch: 0,
      texts: { "main.typ": "= Title\nMore", "chapters/intro.typ": "Intro one\nIntro two\nIntro three" },
    };
    mocks.typstInverse.mockResolvedValue({ file: "main.typ", line: 2, column: 1 });
    mocks.synctexMapLine.mockResolvedValue(3);
    mocks.selectWordNearLine.mockReturnValue(true);

    await inverseFromClick(1, 10, 10, "More", mocks.compileCheckpoint);

    expect(mocks.selectWordNearLine).toHaveBeenLastCalledWith(3, "More", undefined);
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("does not jump to the PDF from a LaTeX file the Typst project does not compile", async () => {
    mocks.state.activePath = "notes.tex";
    mocks.state.files["notes.tex"] = { content: "a\nb", dirty: false };

    await forwardFromCursor();

    expect(mocks.typstForward).not.toHaveBeenCalled();
    expect(mocks.synctexForward).not.toHaveBeenCalled();
    expect(mocks.gotoRect).not.toHaveBeenCalled();
  });

  it("stays out of the way for a Typst project whose Tinymist cannot sync", async () => {
    mocks.state.engine.capabilities.supports_synctex = false;

    await forwardFromCursor();
    await inverseFromClick(1, 10, 10);

    expect(mocks.typstForward).not.toHaveBeenCalled();
    expect(mocks.typstInverse).not.toHaveBeenCalled();
  });
});

describe("forward SyncTeX from the editor", () => {
  const rect = { page: 1, x: 1, y: 2, width: 3, height: 4 };

  it("opens the preview beside the editor before jumping", async () => {
    useSettingsStore.setState({ viewMode: "editor" });
    mocks.synctexForward.mockResolvedValue(rect);

    goToSyncTex();

    expect(useSettingsStore.getState().viewMode).toBe("split");
    await vi.waitFor(() => expect(mocks.gotoRect).toHaveBeenCalledWith(rect));
  });

  it("jumps straight away when the preview is already showing", async () => {
    useSettingsStore.setState({ viewMode: "pdf" });
    mocks.synctexForward.mockResolvedValue(rect);

    goToSyncTex();

    await vi.waitFor(() => expect(mocks.synctexForward).toHaveBeenCalledWith("proj", "main.tex", "main.tex", 1));
    expect(useSettingsStore.getState().viewMode).toBe("pdf");
  });

  it("logs why it could not jump", async () => {
    mocks.getCurrentLine.mockReturnValue(null);
    await forwardFromCursor();
    expect(mocks.logError).toHaveBeenCalledWith("synctex forward", "could not determine cursor line");

    mocks.getCurrentLine.mockReturnValue(2);
    mocks.synctexForward.mockResolvedValue(null);
    await forwardFromCursor();
    expect(mocks.logError).toHaveBeenCalledWith("synctex forward", "no SyncTeX rect for main.tex:2");

    const failure = new Error("synctex binary missing");
    mocks.synctexForward.mockRejectedValue(failure);
    await forwardFromCursor();
    expect(mocks.logError).toHaveBeenCalledWith("synctex forward", failure);
    expect(mocks.gotoRect).not.toHaveBeenCalled();
  });

  it("does nothing until the engine is loaded", async () => {
    mocks.state.engineLoaded = false;

    await forwardFromCursor();

    expect(mocks.synctexForward).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("drops a jump whose compile output was replaced while it ran", async () => {
    mocks.synctexForward.mockImplementation(async () => {
      mocks.isCompileCheckpointCurrent.mockReturnValue(false);
      return rect;
    });

    await forwardFromCursor();

    expect(mocks.gotoRect).not.toHaveBeenCalled();
  });

  describe("with the cursor on a word", () => {
    const spot = { word: "model", before: "and the ", after: " of the data" };
    const first = { page: 1, x: 72, y: 100, width: 400, height: 10, from: 72, to: 472 };
    const third = { page: 2, x: 72, y: 124, width: 400, height: 10, from: 72, to: 300 };
    const runs = [{ str: "the model of the data", x: 72, top: 124, width: 120, height: 10 }];

    beforeEach(() => {
      mocks.wordAtCursor.mockReturnValue(spot);
      mocks.pdfPageText.mockResolvedValue(runs);
    });

    it("jumps to the typeset line the word is on, not the first one of its source line", async () => {
      mocks.synctexForward.mockResolvedValue({ ...rect, lines: [first, third] });
      mocks.pickForwardLine.mockReturnValue(third);

      await forwardFromCursor();

      expect(mocks.pdfPageText.mock.calls).toEqual([[1], [2]]);
      expect(mocks.pickForwardLine).toHaveBeenCalledWith(
        [first, third],
        new Map([
          [1, runs],
          [2, runs],
        ]),
        spot,
      );
      expect(mocks.gotoRect).toHaveBeenCalledWith(third);
    });

    it("keeps SyncTeX's box when the word is on none of the lines", async () => {
      const hit = { ...rect, lines: [first] };
      mocks.synctexForward.mockResolvedValue(hit);

      await forwardFromCursor();

      expect(mocks.gotoRect).toHaveBeenCalledWith(hit);
    });

    it("looks on SyncTeX's page when the source line has no typeset line", async () => {
      const found = { page: 1, x: 200, y: 80, width: 150, height: 14 };
      mocks.synctexForward.mockResolvedValue({ ...rect, lines: [] });
      mocks.findWordOnPages.mockReturnValue(found);

      await forwardFromCursor();

      expect(mocks.findWordOnPages).toHaveBeenCalledWith([1], new Map([[1, runs]]), spot);
      expect(mocks.pickForwardLine).not.toHaveBeenCalled();
      expect(mocks.gotoRect).toHaveBeenCalledWith(found);
    });

    it("reads the word before waiting on SyncTeX, while the cursor is still there", async () => {
      mocks.synctexForward.mockImplementation(async () => {
        expect(mocks.wordAtCursor).toHaveBeenCalledTimes(1);
        return { ...rect, lines: [first] };
      });

      await forwardFromCursor();

      expect(mocks.wordAtCursor).toHaveBeenCalledTimes(1);
    });

    it("keeps SyncTeX's box when the page text cannot be read", async () => {
      const failure = new Error("text layer timed out");
      const hit = { ...rect, lines: [first] };
      mocks.synctexForward.mockResolvedValue(hit);
      mocks.pdfPageText.mockRejectedValue(failure);

      await forwardFromCursor();

      expect(mocks.logError).toHaveBeenCalledWith("synctex forward", failure);
      expect(mocks.gotoRect).toHaveBeenCalledWith(hit);
    });

    it("finds the cursor's word in Typst from the paragraph start the server jumps to", async () => {
      mocks.state.engine.id = "typst";
      mocks.state.engine.source_extensions = ["typ"];
      mocks.state.activePath = "main.typ";
      mocks.state.mainDoc = "main.typ";
      mocks.compileCheckpoint.mainDocument = "main.typ";
      const jump = { page: 2, x: 72, y: 88, width: 96, height: 12 };
      mocks.typstForward.mockResolvedValue(jump);
      mocks.linesFromAnchor.mockReturnValue([first, third]);
      mocks.pickForwardLine.mockReturnValue(third);

      try {
        await forwardFromCursor();
      } finally {
        mocks.compileCheckpoint.mainDocument = "main.tex";
      }

      expect(mocks.pdfPageText.mock.calls).toEqual([[1], [2], [3]]);
      expect(mocks.linesFromAnchor).toHaveBeenCalledWith(jump, expect.any(Map));
      expect(mocks.pickForwardLine).toHaveBeenCalledWith([first, third], expect.any(Map), spot);
      expect(mocks.gotoRect).toHaveBeenCalledWith(third);
    });

    it("keeps the Typst server's point when the word is not around it", async () => {
      mocks.state.engine.id = "typst";
      mocks.state.engine.source_extensions = ["typ"];
      mocks.state.activePath = "main.typ";
      mocks.state.mainDoc = "main.typ";
      mocks.compileCheckpoint.mainDocument = "main.typ";
      mocks.typstForward.mockResolvedValue(rect);

      try {
        await forwardFromCursor();
      } finally {
        mocks.compileCheckpoint.mainDocument = "main.tex";
      }

      expect(mocks.gotoRect).toHaveBeenCalledWith(rect);
    });
  });
});
