import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandLabel, commandsFor, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const files = vi.hoisted(() => ({
  engine: null,
  engineLoaded: false,
  activePath: null,
  manifestHome: "library",
  saveSettingsToFolder: vi.fn(async () => {}),
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));
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

import { registerPaletteCommands } from "./commands";

const opened: AppContext = { projectId: "linked-0123", projectKind: null, theme: "dark" };

function saveCommand(ctx: AppContext) {
  return commandsFor("palette", ctx).find(
    (command) => command.id === "palette.save-settings-to-folder",
  );
}

beforeEach(() => {
  registry.commands.length = 0;
  files.manifestHome = "library";
  files.saveSettingsToFolder.mockClear();
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("save project settings to this folder", () => {
  it("is offered only for an open folder whose settings live on this device", () => {
    for (const home of ["library", "folder", "device_foreign"]) {
      files.manifestHome = home;
      expect(saveCommand(opened), home).toBeUndefined();
    }
    files.manifestHome = "device";
    expect(saveCommand({ ...opened, projectId: null })).toBeUndefined();
    const command = saveCommand(opened);
    expect(command && commandLabel(command, opened)).toBe(
      enShell.commands.saveSettingsToFolder.label,
    );
  });

  it("asks the store to save once when run", () => {
    files.manifestHome = "device";
    saveCommand(opened)?.run(opened);
    expect(files.saveSettingsToFolder).toHaveBeenCalledTimes(1);
  });
});
