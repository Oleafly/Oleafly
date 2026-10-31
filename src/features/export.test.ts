import { beforeEach, describe, expect, it, vi } from "vitest";
import type { toast } from "@/lib/toast";

const mocks = vi.hoisted(() => ({
  state: {
    projectId: "paper-a",
    projectName: "My paper",
    flushForQuit: vi.fn(),
    engine: { id: "latex", source_format: "latex", typst_options: null },
  },
  pdfBytes: new Uint8Array([1, 2]) as Uint8Array | null, exportPdf: vi.fn(), exportProjectImage: vi.fn(),
  pdfPageToPng: vi.fn(),
  pickSavePath: vi.fn(), ensurePandoc: vi.fn(), exportDocument: vi.fn(), downloadProjectZip: vi.fn(),
  revealInDir: vi.fn(), cancelCompile: vi.fn(async () => true),
  exportLog: [] as ((chunk: string) => void)[],
  notifyError: vi.fn(), infoUnique: vi.fn<typeof toast.infoUnique>(() => 42), successUnique: vi.fn<typeof toast.successUnique>(() => 42), info: vi.fn(), dismiss: vi.fn(), update: vi.fn(),
}));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => ({ pdfBytes: mocks.pdfBytes }) } }));
vi.mock("@/lib/tex-root", () => ({ resolveEffectiveMainDoc: () => ({ mainDoc: "chapters/main.tex" }) }));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: mocks.pdfPageToPng }));
vi.mock("@/lib/tauri", () => ({
  EXPORT_LOG_EVENT: "export:log",
  cancelCompile: mocks.cancelCompile,
  exportPdf: mocks.exportPdf,
  exportProjectImage: mocks.exportProjectImage,
  exportDocument: mocks.exportDocument,
  downloadProjectZip: mocks.downloadProjectZip,
  revealInDir: mocks.revealInDir,
  withEventListener: async (event: string, handler: (chunk: string) => void, run: () => Promise<unknown>) => {
    if (event === "export:log") mocks.exportLog.push(handler);
    try {
      return await run();
    } finally {
      mocks.exportLog.splice(mocks.exportLog.indexOf(handler), 1);
    }
  },
}));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError, toast: { infoUnique: mocks.infoUnique, successUnique: mocks.successUnique, info: mocks.info, dismiss: mocks.dismiss, update: mocks.update } }));
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import { i18n } from "@/i18n";
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import { exportCurrentDocument, exportCurrentPdf, exportCurrentImagePng } from "./export";

const EXPORT_KEY = "export-result";

function savedMessage(kind: string, fileName: string): string {
  return i18n.t(($) => $.core.export.saved, { kind, fileName });
}

function resultCalls() {
  return mocks.successUnique.mock.calls as unknown[][];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.projectId = "paper-a";
  mocks.state.flushForQuit.mockResolvedValue(undefined);
  mocks.pickSavePath.mockResolvedValue("/tmp/paper.typ");
  mocks.ensurePandoc.mockResolvedValue(true);
  mocks.exportDocument.mockResolvedValue(undefined);
  mocks.pdfPageToPng.mockResolvedValue("data:image/png;base64,AQ==");
});

describe("document exports", () => {
  it("saves dirty buffers before exporting the captured main document", async () => {
    await exportCurrentDocument("typst");
    expect(mocks.pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "My_paper.typ", filters: [{ name: "TYP", extensions: ["typ"] }] }));
    expect(mocks.state.flushForQuit).toHaveBeenCalledOnce();
    expect(mocks.exportDocument).toHaveBeenCalledWith("paper-a", "chapters/main.tex", "typst", "/tmp/paper.typ", null);
    expect(mocks.state.flushForQuit.mock.invocationCallOrder[0]).toBeLessThan(mocks.exportDocument.mock.invocationCallOrder[0]);
  });
  it("turns the progress toast into the result in place instead of stacking a second toast", async () => {
    await exportCurrentDocument("docx");
    expect(mocks.ensurePandoc).toHaveBeenCalledWith({ notify: true });
    expect(mocks.infoUnique).toHaveBeenNthCalledWith(
      1,
      EXPORT_KEY,
      i18n.t(($) => $.shell.toolbar.exporting, { format: "docx" }),
      undefined,
      true,
    );
    expect(mocks.successUnique).toHaveBeenCalledExactlyOnceWith(
      EXPORT_KEY,
      savedMessage("DOCX", "paper.typ"),
      expect.objectContaining({ label: i18n.t(($) => $.core.export.showInFolder) }),
      true,
    );
    expect(mocks.infoUnique).toHaveBeenCalledTimes(1);
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });
  it("keeps every export result in one slot so a later export replaces the earlier one", async () => {
    await exportCurrentDocument("docx");
    await exportCurrentPdf();
    await exportCurrentImagePng();
    expect(resultCalls()).toHaveLength(3);
    const keys = [...mocks.infoUnique.mock.calls, ...mocks.successUnique.mock.calls].map((call) => (call as unknown[])[0]);
    expect(new Set(keys)).toEqual(new Set([EXPORT_KEY]));
  });
  it("clears the progress slot and reports once when the export itself fails", async () => {
    const failure = new Error("pandoc crashed");
    mocks.exportDocument.mockRejectedValueOnce(failure);
    await exportCurrentDocument("docx");
    expect(mocks.notifyError).toHaveBeenCalledExactlyOnceWith("export document", failure);
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith(42);
    expect(resultCalls()).toHaveLength(0);
  });
  it("shows no export toast when Pandoc is not available", async () => {
    mocks.ensurePandoc.mockResolvedValueOnce(false);
    await exportCurrentDocument("docx");
    expect(mocks.exportDocument).not.toHaveBeenCalled();
    expect(mocks.infoUnique).not.toHaveBeenCalled();
    expect(mocks.successUnique).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });
  it("stops if the project changes while the save dialog is open", async () => {
    mocks.pickSavePath.mockImplementationOnce(async () => { mocks.state.projectId = "paper-b"; return "/tmp/paper.typ"; });
    await exportCurrentDocument("typst");
    expect(mocks.exportDocument).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith("export document", expect.objectContaining({ message: expect.stringContaining("project changed") }));
  });
  it("stops when saving dirty files fails", async () => {
    mocks.state.flushForQuit.mockRejectedValueOnce(new Error("Disk full"));
    await exportCurrentDocument("docx");
    expect(mocks.exportDocument).not.toHaveBeenCalled();
    expect(mocks.infoUnique).not.toHaveBeenCalled();
  });
  it("saves a source archive without requiring Pandoc", async () => {
    await exportCurrentDocument("zip");
    expect(mocks.ensurePandoc).not.toHaveBeenCalled();
    expect(mocks.downloadProjectZip).toHaveBeenCalledWith("paper-a", "/tmp/paper.typ");
    expect(mocks.state.flushForQuit).toHaveBeenCalledOnce();
  });
  it("handles picker errors and lets the user retry", async () => {
    mocks.pickSavePath.mockRejectedValueOnce(new Error("Picker failed"));
    await exportCurrentDocument("typst");
    expect(mocks.notifyError).toHaveBeenCalled();
    await exportCurrentDocument("typst");
    expect(mocks.exportDocument).toHaveBeenCalledOnce();
  });
  it("shows the latest step a notebook export prints in the same progress toast", async () => {
    mocks.state.engine.id = "quarto";
    mocks.exportDocument.mockImplementationOnce(async () => {
      const [log] = mocks.exportLog;
      log("Starting\n");
      log("processing file: report.qmd\n   \n");
      log("half a li");
    });
    try {
      await exportCurrentDocument("docx");
    } finally {
      mocks.state.engine.id = "latex";
    }
    const step = (text: string) => i18n.t(($) => $.shell.toolbar.exportingStep, { format: "docx", step: text });
    expect(mocks.update.mock.calls).toEqual([
      [42, step("Starting")],
      [42, step("processing file: report.qmd")],
    ]);
    expect(mocks.infoUnique).toHaveBeenCalledTimes(1);
    expect(mocks.successUnique).toHaveBeenCalledOnce();
    expect(mocks.exportLog).toEqual([]);
  });

  it("offers Stop on a notebook export, stops it through cancel_compile and says so once", async () => {
    mocks.state.engine.id = "calepin";
    mocks.exportDocument.mockImplementationOnce(async () => {
      const action = mocks.infoUnique.mock.calls[0]?.[2];
      expect(action?.label).toBe(i18n.t(($) => $.shell.toolbar.stopExport));
      action?.onClick();
      throw `${APP_ERROR_PREFIX}${JSON.stringify({ code: "notebook.export_stopped", params: {}, detail: null })}`;
    });
    try {
      await exportCurrentDocument("html");
    } finally {
      mocks.state.engine.id = "latex";
    }
    expect(mocks.cancelCompile).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(enErrors.notebook.export_stopped);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.successUnique).not.toHaveBeenCalled();
  });

  it("offers no Stop on a source archive", async () => {
    mocks.state.engine.id = "quarto";
    try {
      await exportCurrentDocument("zip");
    } finally {
      mocks.state.engine.id = "latex";
    }
    expect(mocks.infoUnique.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("does not start a second export while a picker is pending", async () => {
    let finish!: (path: string | null) => void;
    mocks.pickSavePath.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const first = exportCurrentDocument("typst");
    await exportCurrentDocument("docx");
    expect(mocks.pickSavePath).toHaveBeenCalledOnce();
    finish(null);
    await first;
    expect(mocks.exportDocument).not.toHaveBeenCalled();
  });
});


describe("compiled exports", () => {
  it.each([exportCurrentPdf, exportCurrentImagePng])("reports picker failures and permits retry", async (exportFile) => {
    mocks.pickSavePath.mockRejectedValueOnce(new Error("Picker failed"));
    await exportFile();
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    await exportFile();
    expect(resultCalls()).toEqual([
      [EXPORT_KEY, expect.stringContaining("paper.typ"), expect.any(Object), true],
    ]);
  });
  it.each([exportCurrentPdf, exportCurrentImagePng])("refuses to export after changing projects", async (exportFile) => {
    mocks.pickSavePath.mockImplementationOnce(async () => { mocks.state.projectId = "paper-b"; return "/tmp/export"; });
    await exportFile();
    expect(mocks.exportPdf).not.toHaveBeenCalled();
    expect(mocks.exportProjectImage).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledOnce();
  });
  it("stops when the project changes while rendering an image", async () => {
    mocks.pdfPageToPng.mockImplementationOnce(async () => { mocks.state.projectId = "paper-b"; return "data:image/png;base64,AQ=="; });
    await exportCurrentImagePng();
    expect(mocks.exportProjectImage).not.toHaveBeenCalled();
    expect(mocks.infoUnique).not.toHaveBeenCalled();
  });
});

describe("export edge cases", () => {
  it("does nothing without an open project or a compiled PDF", async () => {
    mocks.state.projectId = null as unknown as string;
    await exportCurrentDocument("docx");
    await exportCurrentPdf();
    await exportCurrentImagePng();
    mocks.state.projectId = "paper-a";
    mocks.pdfBytes = null;
    await exportCurrentPdf();
    await exportCurrentImagePng();
    mocks.pdfBytes = new Uint8Array([1, 2]);

    expect(mocks.pickSavePath).not.toHaveBeenCalled();
  });

  it("names an untitled export after its kind", async () => {
    mocks.state.projectName = "";
    try {
      await exportCurrentDocument("md");
      await exportCurrentImagePng();
    } finally {
      mocks.state.projectName = "My paper";
    }

    expect(mocks.pickSavePath.mock.calls.map(([options]) => options.defaultPath)).toEqual(["document.md", "figure.png"]);
  });

  it("stops when the save dialog is cancelled", async () => {
    mocks.pickSavePath.mockResolvedValue(null);

    await exportCurrentDocument("docx");
    await exportCurrentPdf();
    await exportCurrentImagePng();

    expect(mocks.exportDocument).not.toHaveBeenCalled();
    expect(mocks.exportPdf).not.toHaveBeenCalled();
    expect(mocks.exportProjectImage).not.toHaveBeenCalled();
  });

  it("explains a failed PDF or PNG save with or without the reason", async () => {
    mocks.exportPdf.mockRejectedValueOnce("disk full").mockRejectedValueOnce({ code: 5 });
    await exportCurrentPdf();
    await exportCurrentPdf();
    mocks.exportProjectImage.mockRejectedValueOnce(new Error("read only")).mockRejectedValueOnce({ code: 5 });
    await exportCurrentImagePng();
    await exportCurrentImagePng();

    expect(mocks.notifyError.mock.calls.map((call) => call[2])).toEqual([
      i18n.t(($) => $.core.export.pdfFailedDetail, { detail: "disk full" }),
      i18n.t(($) => $.core.export.pdfFailed),
      i18n.t(($) => $.core.export.pngFailedDetail, { detail: "read only" }),
      i18n.t(($) => $.core.export.pngFailed),
    ]);
  });

  it("reveals a saved file and says so when its folder cannot be opened", async () => {
    mocks.revealInDir.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("no file manager"));
    mocks.pickSavePath.mockResolvedValue("/tmp/out.pdf");
    await exportCurrentPdf();
    const action = mocks.successUnique.mock.calls[0][2];

    action?.onClick();
    expect(mocks.revealInDir).toHaveBeenCalledWith("/tmp/out.pdf");
    expect(mocks.info).not.toHaveBeenCalled();

    action?.onClick();
    await vi.waitFor(() => expect(mocks.info).toHaveBeenCalledWith(i18n.t(($) => $.core.export.revealFailed)));
  });

  it("shows the kind as the name of a destination without a file name", async () => {
    mocks.pickSavePath.mockResolvedValue("/");
    await exportCurrentPdf();

    expect(mocks.successUnique.mock.calls[0][1]).toBe(savedMessage("PDF", "pdf"));
  });
});
