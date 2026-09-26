import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commandGroup,
  commandHint,
  commandLabel,
  commandsFor,
  registry,
  type AppContext,
} from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";

const mocks = vi.hoisted(() => ({ openFolderWithPicker: vi.fn() }));

vi.mock("@/features/open-folder", () => ({ openFolderWithPicker: mocks.openFolderWithPicker }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ engine: null, engineLoaded: false, activePath: null }) },
}));
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

const library: AppContext = { projectId: null, projectKind: null, theme: "light" };
const project: AppContext = { projectId: "thesis-1", projectKind: null, theme: "dark" };

function openFolder(surface: "palette" | "omnibar", ctx: AppContext) {
  return commandsFor(surface, ctx).find((command) => command.id === "palette.open-folder");
}

beforeEach(() => {
  registry.commands.length = 0;
  mocks.openFolderWithPicker.mockReset();
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("open folder command", () => {
  it("is offered in the palette and the search bar, with or without a project open", () => {
    for (const surface of ["palette", "omnibar"] as const) {
      for (const ctx of [library, project]) {
        const command = openFolder(surface, ctx);
        expect(command && commandLabel(command, ctx), `${surface} ${ctx.projectId}`).toBe(
          enShell.commands.openFolder.label,
        );
      }
    }
  });

  it("sits with the project commands and shows the current shortcut", () => {
    const command = openFolder("palette", library);
    expect(command && commandGroup(command, library)).toBe(enShell.commandGroups.project);
    expect(command && commandHint(command, library)).toBe(
      shortcutLabel(useShortcutStore.getState().bindings.openFolder),
    );
  });

  it("opens the folder picker when run", () => {
    openFolder("palette", project)?.run(project);
    expect(mocks.openFolderWithPicker).toHaveBeenCalledTimes(1);
  });
});
