import { describe, it, expect, beforeEach, vi } from "vitest";

// Inverse SyncTeX reaches into the tauri bridge, the editor/pdf controllers and
// the files store. Mock them all so we can assert the multi-file switch logic.
const mocks = vi.hoisted(() => ({
  synctexInverse: vi.fn(),
  synctexForward: vi.fn(),
  gotoLine: vi.fn(),
  getCurrentLine: vi.fn(),
  gotoRect: vi.fn(),
  openFile: vi.fn(),
  state: {
    projectId: "proj" as string | null,
    mainDoc: "main.tex",
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
  for (const k of ["synctexInverse", "gotoLine", "openFile"] as const) mocks[k].mockReset();
  mocks.state.projectId = "proj";
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
    // Resolves the basename against the tree, opens the right path...
    expect(mocks.openFile).toHaveBeenCalledWith("sections/intro.tex");
    // ...then jumps to the line in the now-active file.
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

  it("no-ops with no project open (never calls into the backend)", async () => {
    mocks.state.projectId = null;
    await inverseFromClick(1, 10, 10);
    expect(mocks.synctexInverse).not.toHaveBeenCalled();
  });
});
