// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commandGroup,
  commandKeywords,
  commandLabel,
  commandsFor,
  registry,
  type AppContext,
} from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

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
import { usePersonalDetailsStore } from "@/store/personal-details";

const ctx: AppContext = { projectId: null, projectKind: null, theme: "dark" };

function personalDetailsCommand() {
  const command = commandsFor("palette", ctx).find((entry) => entry.id === "palette.personal-details");
  if (!command) throw new Error("personal details command is not registered");
  return command;
}

beforeEach(() => {
  registry.commands.length = 0;
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
  usePersonalDetailsStore.getState().setHidden(false);
});

describe("personal details palette command", () => {
  it("is offered everywhere, in the settings group, and found by screenshot words", () => {
    const command = personalDetailsCommand();
    expect(commandGroup(command, ctx)).toBe(enShell.commandGroups.settings);
    expect(commandsFor("palette", { ...ctx, projectId: "p1" })).toContain(command);
    expect(commandKeywords(command, ctx)).toContain("screenshot");
    // Palette keywords live with the other commands, where the translation
    // pass looks for them.
    expect(commandKeywords(command, ctx)).toContain(enShell.commands.personalDetails.keywords);
  });

  it("names what it will do next and flips the mode when run", () => {
    const command = personalDetailsCommand();
    expect(commandLabel(command, ctx)).toBe(enShell.personalDetails.hide);

    command.run(ctx);
    expect(usePersonalDetailsStore.getState().hidden).toBe(true);
    expect(commandLabel(command, ctx)).toBe(enShell.personalDetails.show);

    command.run(ctx);
    expect(usePersonalDetailsStore.getState().hidden).toBe(false);
  });
});
