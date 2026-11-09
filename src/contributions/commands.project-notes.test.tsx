import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandGroup, commandKeywords, commandLabel, commandsFor, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  settings: {
    notes: true,
    setRailTab: vi.fn(),
    setShowTree: vi.fn(),
  },
  startProjectNote: vi.fn(async () => "fresh"),
  createProjectNoteFile: vi.fn(async () => "notes/Untitled.md"),
  openNotes: vi.fn(async () => {}),
  logError: vi.fn(),
}));

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
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => mocks.settings } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => ({}) } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: () => ({}) } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/components/notes/project-notes", () => ({ startProjectNote: mocks.startProjectNote }));
vi.mock("@/components/notes/project-note-actions", () => ({ createProjectNoteFile: mocks.createProjectNoteFile }));
vi.mock("@/features/open-tool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/open-tool")>()),
  openNotes: mocks.openNotes,
}));

import { registerOmnibarCommands, registerPaletteCommands } from "./commands";

const project: AppContext = { projectId: "paper", projectKind: "latex", theme: "light" };
const library: AppContext = { projectId: null, projectKind: null, theme: "light" };
const note: AppContext = { projectId: "idea", projectKind: "note", theme: "light" };

function command(id: string, ctx: AppContext) {
  return commandsFor("palette", ctx).find((entry) => entry.id === id);
}

beforeEach(() => {
  registry.commands.length = 0;
  vi.clearAllMocks();
  mocks.settings.notes = true;
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("project notes commands", () => {
  it("are offered in a project while Notes is on", () => {
    const open = command("palette.project-notes", project);
    const create = command("palette.new-project-note", project);
    const shared = command("palette.new-project-note-file", project);
    expect(open && commandLabel(open, project)).toBe(enShell.commands.projectNotes.open);
    expect(create && commandLabel(create, project)).toBe(enShell.commands.projectNotes.newPersonal);
    expect(shared && commandLabel(shared, project)).toBe(enShell.commands.projectNotes.newShared);
    expect(shared && commandKeywords(shared, project)).toContain("shared");
    expect(create && commandKeywords(create, project)).toContain("personal");
    expect(open && commandGroup(open, project)).toBe(enShell.commandGroups.project);
    expect(open && commandKeywords(open, project)).toContain(enShell.commands.projectNotes.keywords);
    expect(create && commandKeywords(create, project)).toContain("new");
  });

  it("stay hidden without a project, inside a note, or while Notes is off", () => {
    for (const ctx of [library, note]) {
      expect(command("palette.project-notes", ctx)).toBeUndefined();
      expect(command("palette.new-project-note", ctx)).toBeUndefined();
      expect(command("palette.new-project-note-file", ctx)).toBeUndefined();
    }
    mocks.settings.notes = false;
    expect(command("palette.project-notes", project)).toBeUndefined();
    expect(command("palette.new-project-note", project)).toBeUndefined();
    expect(command("palette.new-project-note-file", project)).toBeUndefined();
  });

  it("opens the Notes rail tab with the sidebar showing", () => {
    command("palette.project-notes", project)?.run(project);
    expect(mocks.settings.setRailTab).toHaveBeenCalledWith("notes");
    expect(mocks.settings.setShowTree).toHaveBeenCalledWith(true);
  });

  it("starts a note linked to the open project", async () => {
    command("palette.new-project-note", project)?.run(project);
    await vi.waitFor(() => expect(mocks.startProjectNote).toHaveBeenCalledWith("paper"));
  });

  it("creates a project note file that travels with the project", async () => {
    command("palette.new-project-note-file", project)?.run(project);
    await vi.waitFor(() => expect(mocks.createProjectNoteFile).toHaveBeenCalledWith("paper", ""));
    expect(mocks.startProjectNote).not.toHaveBeenCalled();
    command("palette.new-project-note-file", project)?.run(library);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.createProjectNoteFile).toHaveBeenCalledOnce();
  });

  it("does nothing without a project id", async () => {
    const create = command("palette.new-project-note", project);
    create?.run(library);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.startProjectNote).not.toHaveBeenCalled();
  });

  it("logs a notes chunk that cannot load", async () => {
    vi.doMock("@/components/notes/project-notes", () => {
      throw new Error("chunk failed");
    });
    vi.resetModules();
    registry.commands.length = 0;
    const fresh = await import("./commands");
    const registryModule = await import("@oleafly/registry");
    fresh.registerPaletteCommands();
    registryModule.commandsFor("palette", project).find((entry) => entry.id === "palette.new-project-note")?.run(project);
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("load project notes", expect.any(Error)));
    registryModule.registry.commands.length = 0;
    vi.doUnmock("@/components/notes/project-notes");
  });
});

describe("Open Notes command", () => {
  beforeEach(() => {
    registry.commands.length = 0;
    registerOmnibarCommands();
  });

  it("opens Notes from the palette and the omnibar while Notes is on", () => {
    for (const surface of ["palette", "omnibar"] as const) {
      const open = commandsFor(surface, library).find((entry) => entry.id === "omnibar.notes");
      expect(open && commandLabel(open, library)).toBe(enShell.commands.notes.label);
      expect(open && commandGroup(open, library)).toBe(enShell.commandGroups.tools);
      expect(open && commandKeywords(open, library)).toContain(enShell.commands.notes.keywords);
    }
    commandsFor("palette", project).find((entry) => entry.id === "omnibar.notes")?.run(project);
    expect(mocks.openNotes).toHaveBeenCalledOnce();
  });

  it("stays hidden while Notes is off", () => {
    mocks.settings.notes = false;
    expect(commandsFor("palette", project).find((entry) => entry.id === "omnibar.notes")).toBeUndefined();
  });
});
