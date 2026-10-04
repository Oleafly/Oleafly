import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  importState: {
    pdfBytes: new Uint8Array([1]) as Uint8Array | null,
    result: { report: { pages: 2 } } as { report: { pages: number } } | null,
  },
  filesState: {
    engine: null as unknown,
    engineLoaded: true,
    mainDoc: "main.tex",
  },
  createProjectFromConversion: vi.fn(async () => true),
  handoffToAssistant: vi.fn(),
  pdfPageToPng: vi.fn(async (_bytes: Uint8Array, page: number) => `data:image/png;base64,P${page}`),
  getConfig: vi.fn(async () => ({})),
  hasConfiguredProvider: vi.fn(() => true),
}));

vi.mock("@/store/import", () => ({ useImportStore: { getState: () => mocks.importState } }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.filesState } }));
vi.mock("@/features/import", () => ({
  createProjectFromConversion: mocks.createProjectFromConversion,
}));
vi.mock("@/features/assistant-handoff", () => ({ handoffToAssistant: mocks.handoffToAssistant }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: mocks.pdfPageToPng }));
vi.mock("@/lib/tauri", () => ({ getConfig: mocks.getConfig }));
vi.mock("@/lib/ai-providers", () => ({
  hasConfiguredProvider: mocks.hasConfiguredProvider,
  pickActiveProvider: vi.fn(() => ({ providerId: "openai", modelId: "gpt-4o" })),
}));

import { refineAvailable, refinePrompt, refineWithAi } from "./import-refine";

const TYPST: DocumentEngineDescriptor = {
  ...LATEX_ENGINE,
  id: "typst",
  label: "Typst",
  source_format: "typst",
  main_document: "main.typ",
  source_extensions: ["typ"],
  capabilities: {
    ...LATEX_ENGINE.capabilities,
    formatting_profile: "typst",
    supports_isolated_compile: false,
  },
};

beforeEach(() => {
  mocks.importState.pdfBytes = new Uint8Array([1]);
  mocks.importState.result = { report: { pages: 2 } };
  mocks.filesState.engine = LATEX_ENGINE;
  mocks.filesState.mainDoc = "main.tex";
  mocks.createProjectFromConversion.mockReset().mockResolvedValue(true);
  mocks.handoffToAssistant.mockReset();
});

describe("refinePrompt", () => {
  it("keeps the LaTeX instructions for a LaTeX project", () => {
    const prompt = refinePrompt({ profile: "latex", mainDoc: "main.tex", attached: 2, total: 2 });

    expect(prompt).toContain("Improve main.tex to match the originals");
    expect(prompt).toContain("rebuild tables as tabular");
    expect(prompt).toContain("edit main.tex with write_file");
    expect(prompt).not.toContain("Only the first");
  });

  it("asks for Typst math and #table in a Typst project", () => {
    const prompt = refinePrompt({ profile: "typst", mainDoc: "paper.typ", attached: 8, total: 12 });

    expect(prompt).toContain("Improve paper.typ to match the originals");
    expect(prompt).toContain("Typst math");
    expect(prompt).toContain("#table");
    expect(prompt).toContain("edit paper.typ with write_file");
    expect(prompt).not.toContain("tabular");
    expect(prompt).not.toContain("main.tex");
    expect(prompt).toContain("Only the first 8 pages are attached.");
  });

  it("asks for pipe tables in a Markdown project", () => {
    const prompt = refinePrompt({ profile: "markdown", mainDoc: "main.md", attached: 1, total: 1 });

    expect(prompt).toContain("pipe tables");
    expect(prompt).not.toContain("tabular");
  });
});

describe("refineWithAi", () => {
  it("hands the page images to the assistant with the opened project's main file", async () => {
    mocks.createProjectFromConversion.mockImplementation(async () => {
      mocks.filesState.engine = TYPST;
      mocks.filesState.mainDoc = "main.typ";
      return true;
    });

    await refineWithAi();

    expect(mocks.handoffToAssistant).toHaveBeenCalledWith(
      expect.stringContaining("Improve main.typ to match the originals"),
      { autoSend: true, images: ["data:image/png;base64,P1", "data:image/png;base64,P2"] },
    );
  });

  it("does not start a refine run when the project did not open", async () => {
    mocks.createProjectFromConversion.mockResolvedValue(false);

    await refineWithAi();

    expect(mocks.handoffToAssistant).not.toHaveBeenCalled();
  });
});

describe("refine availability", () => {
  it("needs a configured provider whose model can read images", async () => {
    mocks.hasConfiguredProvider.mockReturnValueOnce(false);
    await expect(refineAvailable()).resolves.toBe(false);

    await expect(refineAvailable()).resolves.toBe(true);

    mocks.getConfig.mockRejectedValueOnce(new Error("no config"));
    await expect(refineAvailable()).resolves.toBe(false);
  });
});

describe("refine runs with partial input", () => {
  it("does nothing without a converted PDF", async () => {
    mocks.importState.result = null;

    await refineWithAi();

    expect(mocks.createProjectFromConversion).not.toHaveBeenCalled();
  });

  it("stops attaching pages at the first page that cannot be drawn and falls back to the engine's main file", async () => {
    mocks.importState.result = { report: { pages: 20 } };
    mocks.filesState.mainDoc = "";
    mocks.pdfPageToPng.mockImplementation(async (_bytes: Uint8Array, page: number) => {
      if (page === 3) throw new Error("render failed");
      return `data:image/png;base64,P${page}`;
    });

    await refineWithAi();

    const [prompt, options] = mocks.handoffToAssistant.mock.calls[0];
    expect(options.images).toEqual(["data:image/png;base64,P1", "data:image/png;base64,P2"]);
    expect(prompt).toContain(`Improve ${LATEX_ENGINE.main_document} to match the originals`);
    expect(prompt).toContain("Only the first 8 pages are attached.");
  });

  it("uses a generic repair list for an unknown formatting profile", () => {
    expect(refinePrompt({ profile: "asciidoc", mainDoc: "a.adoc", attached: 1, total: 1 })).toContain(
      "fix display math, rebuild tables, and repair layout",
    );
  });
});
