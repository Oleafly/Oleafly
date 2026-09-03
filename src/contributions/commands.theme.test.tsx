// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFilter } from "cmdk";
import {
  commandLabel,
  commandsFor,
  registry,
  type AppContext,
  type CommandContribution,
} from "@oleafly/registry";

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

const ctx: AppContext = { projectId: null, projectKind: null, theme: "dark" };

function settingsCommands(): CommandContribution[] {
  return commandsFor("palette", ctx).filter((command) => command.group === "Settings");
}

function searchText(command: CommandContribution): string {
  return `${commandLabel(command, ctx)} ${command.keywords ?? ""}`;
}

beforeEach(() => {
  registry.commands.length = 0;
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("appearance palette commands", () => {
  it("keeps the toggle and adds one command per preference", () => {
    const labels = settingsCommands()
      .slice(0, 4)
      .map((command) => commandLabel(command, ctx));
    expect(labels).toEqual([
      "Switch to light theme",
      "Use system appearance",
      "Use light appearance",
      "Use dark appearance",
    ]);
  });

  it("requests the chosen preference when run", () => {
    const seen: unknown[] = [];
    const onSet = (event: Event) => {
      seen.push(event instanceof CustomEvent ? event.detail : null);
    };
    window.addEventListener("oleafly:set-theme-preference", onSet);
    for (const preference of ["system", "light", "dark"]) {
      registry.commands
        .find((command) => command.id === `palette.theme-${preference}`)
        ?.run(ctx);
    }
    window.removeEventListener("oleafly:set-theme-preference", onSet);
    expect(seen).toEqual(["system", "light", "dark"]);
  });

  it("keeps the toggle ranked first for a theme search", () => {
    const [toggle, ...preferences] = settingsCommands().slice(0, 4);
    const toggleScore = defaultFilter(searchText(toggle), "theme");
    expect(toggleScore).toBeGreaterThan(0);
    for (const command of preferences) {
      const score = defaultFilter(searchText(command), "theme");
      expect(score).toBeGreaterThan(0);
      expect(toggleScore).toBeGreaterThanOrEqual(score);
    }
  });
});
