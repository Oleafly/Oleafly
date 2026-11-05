import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {
    projectId: "paper-a" as string | null,
    projectName: "My paper",
    flushForQuit: vi.fn(),
    engine: {
      id: "typst",
      source_format: "typst",
      typst_options: {
        system_fonts: true,
        reproducible: false,
        variants: ["final"],
        font_dirs: [],
        flags: [],
        output_formats: ["pdf", "png"],
        pdf_standards: [],
      },
    },
  },
  pickSavePath: vi.fn(),
  exportTypstDocument: vi.fn(),
  exportDocument: vi.fn(),
  ensurePandoc: vi.fn(),
  notifyError: vi.fn(),
  infoUnique: vi.fn(() => 42),
  successUnique: vi.fn(() => 42),
  dismiss: vi.fn(),
}));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => ({ pdfBytes: null }) } }));
vi.mock("@/lib/tex-root", () => ({ resolveEffectiveMainDoc: () => ({ mainDoc: "main.typ" }) }));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/tauri", () => ({
  EXPORT_LOG_EVENT: "export:log",
  cancelCompile: vi.fn(),
  exportDocument: mocks.exportDocument,
  withEventListener: (_event: string, _handler: unknown, run: () => Promise<unknown>) => run(),
}));
vi.mock("@/lib/typst-options", () => ({ exportTypstDocument: mocks.exportTypstDocument }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { infoUnique: mocks.infoUnique, successUnique: mocks.successUnique, info: vi.fn(), dismiss: mocks.dismiss },
}));

import { i18n } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useTypstVariantStore } from "@/store/typst-variant";
import { exportCurrentDocument, exportCurrentTypst } from "./export";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.projectId = "paper-a";
  mocks.state.engine.id = "typst";
  mocks.state.flushForQuit.mockResolvedValue(undefined);
  mocks.pickSavePath.mockResolvedValue("/out/My_paper.png");
  mocks.exportTypstDocument.mockResolvedValue({ files: ["/out/My_paper-1.png", "/out/My_paper-2.png"] });
  mocks.exportDocument.mockResolvedValue(undefined);
  mocks.ensurePandoc.mockResolvedValue(true);
  useTypstVariantStore.setState({ selections: { "paper-a": "final" } });
});

describe("Typst native exports", () => {
  it("saves buffers, exports with the chosen variant and reports the first file", async () => {
    await exportCurrentTypst({ format: "png", ppi: 300, pages: "1-2" });
    expect(mocks.pickSavePath).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "My_paper.png", filters: [{ name: "PNG", extensions: ["png"] }] }),
    );
    expect(mocks.state.flushForQuit).toHaveBeenCalledOnce();
    expect(mocks.exportTypstDocument).toHaveBeenCalledWith(
      "paper-a",
      "main.typ",
      { format: "png", ppi: 300, pages: "1-2", variant: "final" },
      "/out/My_paper.png",
    );
    expect(mocks.successUnique).toHaveBeenCalledExactlyOnceWith(
      "export-result",
      i18n.t(($) => $.core.export.saved, { kind: "PNG", fileName: "My_paper-1.png" }),
      expect.anything(),
      true,
    );
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("names what Typst left out of an HTML export", async () => {
    mocks.pickSavePath.mockResolvedValueOnce("/out/My_paper.html");
    mocks.exportTypstDocument.mockResolvedValueOnce({
      files: ["/out/My_paper.html"],
      skipped: ["layout", "curve"],
      outdatedTypst: null,
    });
    await exportCurrentTypst({ format: "html" });
    expect(mocks.successUnique).not.toHaveBeenCalled();
    expect(mocks.infoUnique).toHaveBeenLastCalledWith(
      "export-result",
      i18n.t(($) => $.core.export.savedWithoutContent, {
        kind: "HTML",
        fileName: "My_paper.html",
        elements: "layout and curve",
      }),
      expect.anything(),
      true,
    );
  });

  it("offers a newer Typst when an old one dropped the equations", async () => {
    mocks.pickSavePath.mockResolvedValueOnce("/out/My_paper.html");
    mocks.exportTypstDocument.mockResolvedValueOnce({
      files: ["/out/My_paper.html"],
      skipped: ["equation"],
      outdatedTypst: "0.14.2",
    });
    await exportCurrentTypst({ format: "html" });
    expect(mocks.infoUnique).toHaveBeenLastCalledWith(
      "export-result",
      i18n.t(($) => $.core.export.savedWithoutEquations, {
        kind: "HTML",
        fileName: "My_paper.html",
        version: "0.14.2",
      }),
      expect.anything(),
      true,
    );
  });

  it("keeps Typst off the network while offline", async () => {
    useSettingsStore.setState({ offline: true });
    try {
      await exportCurrentTypst({ format: "png", ppi: 144 });
      expect(mocks.exportTypstDocument).toHaveBeenCalledWith(
        "paper-a",
        "main.typ",
        { format: "png", ppi: 144, variant: "final", offline: true },
        "/out/My_paper.png",
      );
    } finally {
      useSettingsStore.setState({ offline: false });
    }
  });

  it("does nothing when the save dialog is cancelled", async () => {
    mocks.pickSavePath.mockResolvedValueOnce(null);
    await exportCurrentTypst({ format: "svg" });
    expect(mocks.exportTypstDocument).not.toHaveBeenCalled();
    expect(mocks.infoUnique).not.toHaveBeenCalled();
  });

  it("leaves a Calepin document to its own compiler", async () => {
    mocks.state.engine.id = "calepin";
    await exportCurrentTypst({ format: "png" });
    expect(mocks.pickSavePath).not.toHaveBeenCalled();
    expect(mocks.exportTypstDocument).not.toHaveBeenCalled();
  });

  it("reports a Typst failure once and clears the progress toast", async () => {
    mocks.exportTypstDocument.mockRejectedValueOnce(new Error("main.typ:3:1: unknown variable: foo"));
    await exportCurrentTypst({ format: "pdf", pdfStandard: "a-2b" });
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    expect(mocks.dismiss).toHaveBeenCalledWith(42);
    expect(mocks.successUnique).not.toHaveBeenCalled();
  });
});

describe("Typst conversion exports", () => {
  it("converts with the chosen variant so the export matches the compiled PDF", async () => {
    mocks.pickSavePath.mockResolvedValueOnce("/out/My_paper.docx");
    await exportCurrentDocument("docx");
    expect(mocks.exportDocument).toHaveBeenCalledWith("paper-a", "main.typ", "docx", "/out/My_paper.docx", "final");
  });

  it("uses the base inputs when the chosen variant no longer exists", async () => {
    useTypstVariantStore.setState({ selections: { "paper-a": "removed" } });
    mocks.pickSavePath.mockResolvedValueOnce("/out/My_paper.md");
    await exportCurrentDocument("md");
    expect(mocks.exportDocument).toHaveBeenCalledWith("paper-a", "main.typ", "md", "/out/My_paper.md", null);
  });

  it("passes offline mode to the export", async () => {
    useSettingsStore.setState({ offline: true });
    try {
      mocks.pickSavePath.mockResolvedValueOnce("/out/My_paper.docx");
      await exportCurrentDocument("docx");
      expect(mocks.exportDocument).toHaveBeenCalledWith("paper-a", "main.typ", "docx", "/out/My_paper.docx", "final", true);
    } finally {
      useSettingsStore.setState({ offline: false });
    }
  });

  it("names what Typst could not convert", async () => {
    mocks.pickSavePath.mockResolvedValueOnce("/out/My_paper.docx");
    mocks.exportDocument.mockResolvedValueOnce({ warnings: [], skipped: ["layout"], outdatedTypst: null });
    await exportCurrentDocument("docx");
    expect(mocks.successUnique).not.toHaveBeenCalled();
    expect(mocks.infoUnique).toHaveBeenLastCalledWith(
      "export-result",
      i18n.t(($) => $.core.export.savedWithoutContent, {
        kind: "DOCX",
        fileName: "My_paper.docx",
        elements: "layout",
      }),
      expect.anything(),
      true,
    );
  });

  it("says when an old Typst sent the export through the source reader", async () => {
    mocks.pickSavePath.mockResolvedValueOnce("/out/My_paper.docx");
    mocks.exportDocument.mockResolvedValueOnce({
      warnings: [],
      skipped: [],
      outdatedTypst: null,
      readFromSource: "0.14.2",
    });
    await exportCurrentDocument("docx");
    expect(mocks.successUnique).not.toHaveBeenCalled();
    expect(mocks.infoUnique).toHaveBeenLastCalledWith(
      "export-result",
      i18n.t(($) => $.core.export.savedFromSource, {
        kind: "DOCX",
        fileName: "My_paper.docx",
        version: "0.14.2",
      }),
      expect.anything(),
      true,
    );
  });

  it("names the lost elements when the Typst version is not the cause", async () => {
    mocks.pickSavePath.mockResolvedValueOnce("/out/My_paper.html");
    mocks.exportDocument.mockResolvedValueOnce({
      warnings: [],
      skipped: ["layout", "polygon"],
      outdatedTypst: null,
      readFromSource: null,
    });
    await exportCurrentDocument("html");
    expect(mocks.infoUnique).toHaveBeenLastCalledWith(
      "export-result",
      i18n.t(($) => $.core.export.savedWithoutContent, {
        kind: "HTML",
        fileName: "My_paper.html",
        elements: "layout and polygon",
      }),
      expect.anything(),
      true,
    );
  });

  it("says when an old Typst lost the equations", async () => {
    mocks.pickSavePath.mockResolvedValueOnce("/out/My_paper.md");
    mocks.exportDocument.mockResolvedValueOnce({ warnings: [], skipped: ["equation"], outdatedTypst: "0.13.1" });
    await exportCurrentDocument("md");
    expect(mocks.infoUnique).toHaveBeenLastCalledWith(
      "export-result",
      i18n.t(($) => $.core.export.savedWithoutEquations, {
        kind: "MD",
        fileName: "My_paper.md",
        version: "0.13.1",
      }),
      expect.anything(),
      true,
    );
  });
});
