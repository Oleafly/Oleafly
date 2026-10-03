import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandLabel, commandsFor, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  openTypstPackages: vi.fn(),
  files: { engine: null as unknown, engineLoaded: true, activePath: "main.typ" },
}));

vi.mock("@/components/typst-packages/open", () => ({ openTypstPackages: mocks.openTypstPackages }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));
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

import { LATEX_ENGINE } from "@/lib/document-engine";
import { registerPaletteCommands } from "./commands";

const TYPST = { ...LATEX_ENGINE, id: "typst" };

const library: AppContext = { projectId: null, projectKind: null, theme: "light" };
const project: AppContext = { projectId: "paper", projectKind: null, theme: "light" };

function packagesCommand(ctx: AppContext) {
  return commandsFor("palette", ctx).find((command) => command.id === "palette.typst-packages");
}

beforeEach(() => {
  registry.commands.length = 0;
  mocks.openTypstPackages.mockReset();
  mocks.files.engine = TYPST;
  mocks.files.engineLoaded = true;
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("Typst packages command", () => {
  it("is offered for an open Typst project and opens the browser", () => {
    const command = packagesCommand(project);
    expect(command && commandLabel(command, project)).toBe(enShell.commands.typstPackages.label);
    command?.run(project);
    expect(mocks.openTypstPackages).toHaveBeenCalledOnce();
  });

  it("is hidden without a project or for other engines", () => {
    expect(packagesCommand(library)).toBeUndefined();
    mocks.files.engine = LATEX_ENGINE;
    expect(packagesCommand(project)).toBeUndefined();
    mocks.files.engineLoaded = false;
    mocks.files.engine = TYPST;
    expect(packagesCommand(project)).toBeUndefined();
  });
});
