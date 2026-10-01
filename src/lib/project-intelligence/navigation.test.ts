// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revealEditor: vi.fn(),
  setViewMode: vi.fn(),
  revealSourceEditor: vi.fn(),
  revealEditorRange: vi.fn(),
}));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create<{
      projectId: string | null;
      activePath: string | null;
      openFile: (path: string) => Promise<void>;
    }>((set) => ({
      projectId: "proj",
      activePath: null,
      openFile: async (path) => set({ activePath: path }),
    })),
  };
});
vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({
      viewMode: "pdf",
      revealEditor: mocks.revealEditor,
      setViewMode: mocks.setViewMode,
    }),
  },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  revealSourceEditor: mocks.revealSourceEditor,
}));
vi.mock("@/components/editor/cm/controller", () => ({
  waitForEditorDocument: async () => ({ state: { doc: { length: 100 } } }),
  gotoLine: vi.fn(),
  revealEditorRange: mocks.revealEditorRange,
  getEditorView: () => null,
}));

import { navigateToProjectRange } from "./navigation";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("navigateToProjectRange", () => {
  it("swaps the PDF-only view for the editor, as outline and diagnostic jumps always have", async () => {
    await navigateToProjectRange({ path: "chapters/intro.tex", range: { from: 5, to: 9 } });
    expect(mocks.setViewMode).toHaveBeenCalledExactlyOnceWith("editor");
    expect(mocks.revealEditor).not.toHaveBeenCalled();
    expect(mocks.revealSourceEditor).toHaveBeenCalled();
    expect(mocks.revealEditorRange).toHaveBeenCalledExactlyOnceWith(expect.anything(), 5, 9);
  });
});
