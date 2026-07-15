import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE, UNKNOWN_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  state: { engine: null as unknown, engineLoaded: false, activePath: null as string | null },
  wrapSelection: vi.fn(),
  insertAtCursor: vi.fn(),
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/components/editor/cm/controller", () => ({
  wrapSelection: mocks.wrapSelection,
  insertAtCursor: mocks.insertAtCursor,
}));
vi.mock("@/features/export", () => ({ exportCurrentPdf: vi.fn() }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ clearBuildCache: vi.fn() }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: vi.fn() } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: vi.fn() } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: vi.fn() } }));

import { engineFormattingAvailable, runEngineFormatting } from "./commands";

beforeEach(() => {
  mocks.state.engine = UNKNOWN_ENGINE;
  mocks.state.engineLoaded = false;
  mocks.state.activePath = null;
  mocks.wrapSelection.mockReset();
  mocks.insertAtCursor.mockReset();
});

describe("palette engine formatting", () => {
  it("is hidden and every handler no-ops while the engine is unresolved", () => {
    expect(engineFormattingAvailable()).toBe(false);
    for (const action of ["bold", "italic", "section", "list"] as const) {
      runEngineFormatting(action);
    }
    expect(mocks.wrapSelection).not.toHaveBeenCalled();
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
  });

  it("is available and emits LaTeX output after LaTeX resolves", () => {
    mocks.state.engine = LATEX_ENGINE;
    mocks.state.engineLoaded = true;
    mocks.state.activePath = "main.tex";
    expect(engineFormattingAvailable()).toBe(true);
    runEngineFormatting("bold");
    runEngineFormatting("italic");
    runEngineFormatting("section");
    runEngineFormatting("list");
    expect(mocks.wrapSelection).toHaveBeenNthCalledWith(1, "\\textbf{", "}");
    expect(mocks.wrapSelection).toHaveBeenNthCalledWith(2, "\\textit{", "}");
    expect(mocks.insertAtCursor).toHaveBeenNthCalledWith(1, "\\section{}\n");
    expect(mocks.insertAtCursor).toHaveBeenNthCalledWith(
      2,
      "\\begin{itemize}\n  \\item \n\\end{itemize}\n",
    );
  });

  it("is available and emits Typst output after Typst resolves", () => {
    mocks.state.engine = {
      ...LATEX_ENGINE,
      id: "typst",
      source_extensions: ["typ"],
      capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" },
    };
    mocks.state.engineLoaded = true;
    mocks.state.activePath = "main.typ";
    expect(engineFormattingAvailable()).toBe(true);
    runEngineFormatting("bold");
    runEngineFormatting("italic");
    runEngineFormatting("section");
    runEngineFormatting("list");
    expect(mocks.wrapSelection).toHaveBeenNthCalledWith(1, "*", "*");
    expect(mocks.wrapSelection).toHaveBeenNthCalledWith(2, "_", "_");
    expect(mocks.insertAtCursor).toHaveBeenNthCalledWith(1, "= Heading\n");
    expect(mocks.insertAtCursor).toHaveBeenNthCalledWith(2, "- Item\n");
  });

  it("is unavailable for a non-source file even after the engine resolves", () => {
    mocks.state.engine = LATEX_ENGINE;
    mocks.state.engineLoaded = true;
    mocks.state.activePath = "references.bib";
    expect(engineFormattingAvailable()).toBe(false);
    runEngineFormatting("bold");
    expect(mocks.wrapSelection).not.toHaveBeenCalled();
  });
});
