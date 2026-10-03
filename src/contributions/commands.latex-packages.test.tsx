import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandLabel, commandsFor, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  openLatexPackages: vi.fn(),
  files: { engine: null as unknown, engineLoaded: true, activePath: "main.tex" },
}));

vi.mock("@/components/packages/open", () => ({ openLatexPackages: mocks.openLatexPackages }));
vi.mock("@/components/typst-packages/open", () => ({ openTypstPackages: vi.fn() }));
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

const library: AppContext = { projectId: null, projectKind: null, theme: "light" };
const project: AppContext = { projectId: "paper", projectKind: null, theme: "light" };

function packagesCommand(ctx: AppContext) {
  return commandsFor("palette", ctx).find((command) => command.id === "palette.latex-packages");
}

beforeEach(() => {
  registry.commands.length = 0;
  mocks.openLatexPackages.mockReset();
  mocks.files.engine = LATEX_ENGINE;
  mocks.files.engineLoaded = true;
  registerPaletteCommands();
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("LaTeX packages command", () => {
  it("is offered for Tectonic and latexmk projects and opens the browser", () => {
    const command = packagesCommand(project);
    expect(command && commandLabel(command, project)).toBe(enShell.commands.latexPackages.label);
    command?.run(project);
    expect(mocks.openLatexPackages).toHaveBeenCalledOnce();
    mocks.files.engine = { ...LATEX_ENGINE, id: "latexmk" };
    expect(packagesCommand(project)).toBeDefined();
  });

  it("is hidden without a project or for other engines", () => {
    expect(packagesCommand(library)).toBeUndefined();
    mocks.files.engine = { ...LATEX_ENGINE, id: "typst", source_format: "typst" };
    expect(packagesCommand(project)).toBeUndefined();
    mocks.files.engine = { ...LATEX_ENGINE, id: "markdown", source_format: "markdown" };
    expect(packagesCommand(project)).toBeUndefined();
    mocks.files.engine = LATEX_ENGINE;
    mocks.files.engineLoaded = false;
    expect(packagesCommand(project)).toBeUndefined();
  });
});
