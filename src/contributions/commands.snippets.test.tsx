// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { commandGroup, commandKeywords, commandLabel, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  state: { engine: null as unknown, engineLoaded: true, activePath: "main.tex" as string | null, projectKind: "document" },
  view: { current: {} as unknown },
  settings: { setSearchOpen: vi.fn() },
  canSaveSelection: vi.fn(() => true),
  openSaveSnippet: vi.fn(() => true),
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: () => mocks.view.current,
  insertAtCursor: vi.fn(),
  wrapSelection: vi.fn(),
}));
vi.mock("@/features/snippets/save-dialog", () => ({
  canSaveSelection: mocks.canSaveSelection,
  openSaveSnippet: mocks.openSaveSnippet,
}));
vi.mock("@/features/snippets/fast-math", () => ({ toggleFastMath: vi.fn() }));
vi.mock("@/features/export", () => ({ exportCurrentPdf: vi.fn() }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ clearBuildCache: vi.fn() }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => mocks.settings } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: vi.fn() } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: vi.fn() } }));

import { registerPaletteCommands } from "./commands";

const CTX: AppContext = { projectId: "paper", projectKind: "document", theme: "light" };

function command(id: string) {
  const found = registry.commands.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

beforeAll(() => {
  registerPaletteCommands();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.view.current = {};
  mocks.canSaveSelection.mockReturnValue(true);
  Object.assign(mocks.state, { engine: LATEX_ENGINE, engineLoaded: true, activePath: "main.tex" });
});

describe("snippet commands", () => {
  it("opens the palette on the snippets from Insert snippet", () => {
    const insert = command("snippets.insert");
    expect(commandLabel(insert, CTX)).toBe(enShell.commands.insertSnippet.label);
    expect(commandGroup(insert, CTX)).toBe(enShell.commandGroups.insert);
    expect(commandKeywords(insert, CTX)).toContain("templates");
    expect(insert.when?.(CTX)).toBe(true);
    insert.run(CTX);
    expect(mocks.settings.setSearchOpen).toHaveBeenCalledWith(true, "/snippets ");
  });

  it("saves the selection as a snippet only while text is selected", () => {
    const save = command("snippets.saveSelection");
    expect(commandLabel(save, CTX)).toBe(enShell.commands.saveSnippet.label);
    expect(commandGroup(save, CTX)).toBe(enShell.commandGroups.editor);
    expect(commandKeywords(save, CTX)).toContain("selection");
    expect(save.when?.(CTX)).toBe(true);
    save.run(CTX);
    expect(mocks.openSaveSnippet).toHaveBeenCalledOnce();
    mocks.canSaveSelection.mockReturnValue(false);
    expect(save.when?.(CTX)).toBe(false);
  });

  it("is not offered without a source editor", () => {
    mocks.view.current = null;
    expect(command("snippets.insert").when?.(CTX)).toBe(false);
    expect(command("snippets.saveSelection").when?.(CTX)).toBe(false);
  });
});
