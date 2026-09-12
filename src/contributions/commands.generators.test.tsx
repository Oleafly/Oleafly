// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registry, type AppContext } from "@oleafly/registry";

const state = vi.hoisted(() => ({
  files: {
    projectId: "project-1" as string | null,
    engine: null,
    engineLoaded: false,
    activePath: "main.tex" as string | null,
    closeProject: vi.fn(async () => {}),
  },
  home: {
    closeTools: vi.fn(),
    goTo: vi.fn(),
    queuePageAfterProjectClose: vi.fn(),
    clearQueuedPageAfterProjectClose: vi.fn(),
  },
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => state.files } }));
vi.mock("@/store/home-view", () => ({ useHomeViewStore: { getState: () => state.home } }));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: vi.fn(),
  wrapSelection: vi.fn(),
  insertAtCursor: vi.fn(),
}));
vi.mock("@/features/export", () => ({ exportCurrentPdf: vi.fn() }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ clearBuildCache: vi.fn() }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => ({}) } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => ({}) } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: () => ({}) } }));

import { registerOmnibarCommands } from "./commands";

const ctx: AppContext = { projectId: "project-1", projectKind: "latex", theme: "dark" };

beforeEach(() => {
  registry.commands.length = 0;
  vi.clearAllMocks();
  state.files.projectId = "project-1";
  registerOmnibarCommands();
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("project tool commands", () => {
  it.each(["generators", "symbols"])("opens %s over the active project", (page) => {
    registry.commands.find((command) => command.id === `tool.${page}`)?.run(ctx);

    expect(state.home.goTo).toHaveBeenCalledWith(page);
    expect(state.files.closeProject).not.toHaveBeenCalled();
  });
});
