// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { commandKeywords, commandLabel, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";

const mocks = vi.hoisted(() => ({
  state: { engine: null as unknown, engineLoaded: false, activePath: null as string | null, projectKind: "document" },
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/features/export", () => ({ exportCurrentPdf: vi.fn() }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ clearBuildCache: vi.fn() }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: vi.fn() } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: vi.fn() } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: vi.fn() } }));

import { registerPaletteCommands } from "./commands";

const CTX: AppContext = { projectId: "paper", projectKind: "document", theme: "light" };
const TYPST_ENGINE = { ...LATEX_ENGINE, id: "typst", source_extensions: ["typ"] };
const MARKDOWN_ENGINE = { ...LATEX_ENGINE, id: "markdown", source_format: "markdown", source_extensions: ["md"] };

function command(id: string) {
  const found = registry.commands.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

beforeAll(() => {
  registerPaletteCommands();
});

describe("Document settings command", () => {
  it("is offered for Typst, LaTeX and Markdown documents", () => {
    const settings = command("palette.document-settings");
    mocks.state.engineLoaded = true;
    mocks.state.projectKind = "document";
    mocks.state.engine = TYPST_ENGINE;
    expect(settings.when?.(CTX)).toBe(true);
    mocks.state.engine = LATEX_ENGINE;
    expect(settings.when?.(CTX)).toBe(true);
    mocks.state.engine = MARKDOWN_ENGINE;
    expect(settings.when?.(CTX)).toBe(true);
    mocks.state.engine = LATEX_ENGINE;
    mocks.state.projectKind = "diagram";
    expect(settings.when?.(CTX)).toBe(false);
    mocks.state.projectKind = "document";
    mocks.state.engineLoaded = false;
    expect(settings.when?.(CTX)).toBe(false);
  });

  it("opens the settings panel and finds engine terms", () => {
    const settings = command("palette.document-settings");
    expect(commandLabel(settings, CTX)).toBe(enShell.commands.typstDocumentSettings.label);
    expect(commandKeywords(settings, CTX)).toContain("geometry");
    settings.run(CTX);
    expect(useTypstDocumentPanelStore.getState().panel).toBe("settings");
  });
});
