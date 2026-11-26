// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { commandGroup, commandKeywords, commandLabel, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  state: { engine: null as unknown, engineLoaded: true, activePath: null as string | null, projectKind: "document" },
  view: { current: {} as unknown },
  toggleFastMath: vi.fn(async () => undefined),
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: () => mocks.view.current,
  insertAtCursor: vi.fn(),
  wrapSelection: vi.fn(),
}));
vi.mock("@/features/snippets/fast-math", () => ({ toggleFastMath: mocks.toggleFastMath }));
vi.mock("@/features/export", () => ({ exportCurrentPdf: vi.fn() }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ clearBuildCache: vi.fn() }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: vi.fn(() => ({})) } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: vi.fn() } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: vi.fn() } }));

import { registerPaletteCommands } from "./commands";

const CTX: AppContext = { projectId: "paper", projectKind: "document", theme: "light" };
const TYPST_ENGINE = { ...LATEX_ENGINE, id: "typst", source_extensions: ["typ"] };

function fastMath() {
  const found = registry.commands.find((candidate) => candidate.id === "palette.fast-math");
  if (!found) throw new Error("missing palette.fast-math");
  return found;
}

beforeAll(() => {
  registerPaletteCommands();
});

beforeEach(() => {
  mocks.toggleFastMath.mockClear();
  mocks.view.current = {};
  Object.assign(mocks.state, { engine: LATEX_ENGINE, engineLoaded: true, activePath: "main.tex" });
});

describe("Toggle Fast math command", () => {
  it("sits with the settings commands and is found by what Fast math does", () => {
    const command = fastMath();
    expect(command.surfaces).toEqual(["palette"]);
    expect(commandLabel(command, CTX)).toBe(enShell.commands.fastMath.label);
    expect(commandGroup(command, CTX)).toBe(enShell.commandGroups.settings);
    for (const word of ["fraction", "snippets", "latex", "typst"]) expect(commandKeywords(command, CTX)).toContain(word);
  });

  it("toggles Fast math for the language of the open source file", () => {
    const command = fastMath();
    expect(command.when?.(CTX)).toBe(true);
    command.run(CTX);
    expect(mocks.toggleFastMath).toHaveBeenLastCalledWith("latex");

    Object.assign(mocks.state, { engine: TYPST_ENGINE, activePath: "main.typ" });
    expect(command.when?.(CTX)).toBe(true);
    command.run(CTX);
    expect(mocks.toggleFastMath).toHaveBeenLastCalledWith("typst");
  });

  it("is not offered outside a LaTeX or Typst source editor", () => {
    const command = fastMath();
    mocks.state.activePath = "notes.md";
    expect(command.when?.(CTX)).toBe(false);
    mocks.state.activePath = "main.tex";
    mocks.view.current = null;
    expect(command.when?.(CTX)).toBe(false);
    command.run(CTX);
    expect(mocks.toggleFastMath).not.toHaveBeenCalled();
  });
});
