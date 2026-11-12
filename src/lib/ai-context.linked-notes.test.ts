import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  logError: vi.fn(),
  files: {
    projectId: "p1",
    projectName: "Thesis",
    projectKind: "tex",
    activePath: null,
    mainDoc: "",
    files: {},
    openTabs: [],
    projects: [{ id: "n1", name: "Masking", kind: "note", related_project: "p1", updated_at: 1 }],
  },
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => state.files } }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ status: "idle", errors: [], lastCompiledAt: null }) },
}));
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => ({ index: null, rebuildFromDisk: async () => {} }) },
}));
vi.mock("@/store/agent-memory", () => ({ useAgentMemoryStore: { getState: () => ({ asPromptBlock: () => "" }) } }));
vi.mock("@/components/editor/cm/controller", () => ({ getCurrentLine: () => null }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteFacts: async () => [],
}));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: (...args: unknown[]) => state.logError(...args),
}));
vi.mock("@/components/notes/project-notes", () => ({
  projectNotes: () => {
    throw new Error("bad note");
  },
  projectNotesPrompt: () => "",
}));

import { useSettingsStore } from "@/store/settings";
import { buildWorkspaceContext } from "./ai-context";

afterEach(() => {
  useSettingsStore.setState({ notes: false });
});

describe("linked notes that cannot be listed", () => {
  it("logs the failure and leaves the section out", async () => {
    useSettingsStore.setState({ notes: true });
    const text = await buildWorkspaceContext();
    expect(text).not.toContain("Research notes linked to this project");
    expect(text).toContain("Project: Thesis");
    expect(state.logError).toHaveBeenCalledWith("list linked notes for the assistant", expect.any(Error));
  });
});
