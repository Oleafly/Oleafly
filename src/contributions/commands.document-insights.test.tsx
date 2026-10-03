// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { commandLabel, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";

const mocks = vi.hoisted(() => ({
  state: {
    engine: null as unknown,
    engineLoaded: false,
    activePath: null as string | null,
    projectKind: "document" as string | null,
  },
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
const engines = {
  latex: LATEX_ENGINE,
  latexmk: { ...LATEX_ENGINE, id: "latexmk" },
  typst: { ...LATEX_ENGINE, id: "typst", source_format: "typst", source_extensions: ["typ"] },
  markdown: { ...LATEX_ENGINE, id: "markdown", source_format: "markdown", source_extensions: ["md"] },
  unknown: { ...LATEX_ENGINE, id: "unknown", source_format: "unknown", source_extensions: [] },
};

function insights() {
  const found = registry.commands.find((candidate) => candidate.id === "palette.document-insights");
  if (!found) throw new Error("missing palette.document-insights");
  return found;
}

beforeAll(() => {
  registerPaletteCommands();
});

describe("Document insights command", () => {
  it("is offered for LaTeX, Typst and Markdown documents", () => {
    mocks.state.engineLoaded = true;
    for (const name of ["latex", "latexmk", "typst", "markdown"] as const) {
      mocks.state.engine = engines[name];
      expect(insights().when?.(CTX)).toBe(true);
    }
    mocks.state.engine = engines.unknown;
    expect(insights().when?.(CTX)).toBe(false);
    mocks.state.engine = engines.latex;
    mocks.state.projectKind = "diagram";
    expect(insights().when?.(CTX)).toBe(false);
    mocks.state.projectKind = "document";
    mocks.state.engineLoaded = false;
    expect(insights().when?.(CTX)).toBe(false);
  });

  it("opens the insights panel", () => {
    expect(commandLabel(insights(), CTX)).toBe(enShell.commands.typstInsights.label);
    insights().run(CTX);
    expect(useTypstDocumentPanelStore.getState().panel).toBe("insights");
    useTypstDocumentPanelStore.getState().closePanel();
  });
});
