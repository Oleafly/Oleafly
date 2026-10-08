import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commandGroup,
  commandHint,
  commandKeywords,
  commandLabel,
  commandsFor,
  registry,
  type AppContext,
} from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";

const mocks = vi.hoisted(() => ({ toggleZenMode: vi.fn() }));

vi.mock("@/lib/zen-mode", () => ({ toggleZenMode: mocks.toggleZenMode }));
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

function zenCommand(surface: "palette" | "omnibar", ctx: AppContext) {
  return commandsFor(surface, ctx).find((command) => command.id === "palette.zen-mode");
}

beforeEach(() => {
  registry.commands.length = 0;
  mocks.toggleZenMode.mockReset();
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("Toggle Zen Mode command", () => {
  it("is in the command palette while a project is open", () => {
    const command = zenCommand("palette", project);
    expect(command && commandLabel(command, project)).toBe(enShell.commands.zenMode.label);
    expect(enShell.commands.zenMode.label).toBe("Toggle Zen Mode");
  });

  it("is not offered without a project, or in the search bar", () => {
    expect(zenCommand("palette", library)).toBeUndefined();
    expect(zenCommand("omnibar", project)).toBeUndefined();
  });

  it("sits with the settings commands and shows the current shortcut", () => {
    const command = zenCommand("palette", project);
    expect(command && commandGroup(command, project)).toBe(enShell.commandGroups.settings);
    expect(command && commandHint(command, project)).toBe(
      shortcutLabel(useShortcutStore.getState().bindings.toggleZenMode),
    );
    useShortcutStore.getState().setBinding("toggleZenMode", { key: "z", mod: true, alt: true });
    try {
      expect(command && commandHint(command, project)).toBe(
        shortcutLabel({ key: "z", mod: true, alt: true }),
      );
    } finally {
      useShortcutStore.getState().resetBinding("toggleZenMode");
    }
  });

  it("is found by the other names for Zen mode", () => {
    const command = zenCommand("palette", project);
    const keywords = command ? commandKeywords(command, project) : "";
    for (const word of ["distraction", "focus", "full screen"]) expect(keywords).toContain(word);
  });

  it("turns Zen mode on or off when run", () => {
    zenCommand("palette", project)?.run(project);
    expect(mocks.toggleZenMode).toHaveBeenCalledTimes(1);
  });
});
