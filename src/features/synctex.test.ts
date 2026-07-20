import { describe, it, expect, beforeEach, vi } from "vitest";

// Inverse SyncTeX reaches into the tauri bridge, the editor/pdf controllers and
// the files store. Mock them all so we can assert the multi-file switch logic.
const mocks = vi.hoisted(() => ({
  synctexInverse: vi.fn(),
  synctexForward: vi.fn(),
  gotoLine: vi.fn(),
  selectWordNearLine: vi.fn(),
  getCurrentLine: vi.fn(),
  gotoRect: vi.fn(),
  openFile: vi.fn(),
  state: {
    projectId: "proj" as string | null,
    mainDoc: "main.tex",
    engine: { capabilities: { supports_synctex: true } },
    engineLoaded: true,
    activePath: "main.tex" as string | null,
    tree: [] as { path: string; is_dir: boolean }[],
  },
}));

vi.mock("@/lib/tauri", () => ({
  synctexInverse: mocks.synctexInverse,
  synctexForward: mocks.synctexForward,
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
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { inverseFromClick } from "./synctex";

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
  ] as const)
    mocks[k].mockReset();
  mocks.state.projectId = "proj";
  mocks.state.mainDoc = "main.tex";
  mocks.state.engine.capabilities.supports_synctex = true;
  mocks.state.engineLoaded = true;
  mocks.state.activePath = "main.tex";
  mocks.state.tree = [
    { path: "main.tex", is_dir: false },
    { path: "sections/intro.tex", is_dir: false },
  ];
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
