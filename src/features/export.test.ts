import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { toast } from "@/lib/toast";
import type { ToastAction } from "@/store/toast";

const mocks = vi.hoisted(() => ({
  state: {
    projectId: "paper-a",
    projectName: "My paper",
    flushForQuit: vi.fn(),
    engine: { id: "latex", source_format: "latex", typst_options: null },
  },
  pdfBytes: new Uint8Array([1, 2]) as Uint8Array | null, exportPdf: vi.fn(), exportProjectImage: vi.fn(),
  compileStatus: "success" as string, checkpointCurrent: true, checkpoint: null as { mainDocument: string } | null, pdfPageToPng: vi.fn(),
  pickSavePath: vi.fn(), ensurePandoc: vi.fn(), exportDocument: vi.fn(), downloadProjectZip: vi.fn(),
  revealInDir: vi.fn(), cancelCompile: vi.fn(async () => true),
  exportLog: [] as ((chunk: string) => void)[],
  notifyError: vi.fn(), infoUnique: vi.fn<typeof toast.infoUnique>(() => 42), successUnique: vi.fn<typeof toast.successUnique>(() => 42), info: vi.fn(), dismiss: vi.fn(), update: vi.fn(),
}));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/store/compile", () => ({
  isCompileCheckpointCurrent: () => mocks.checkpointCurrent,
  useCompileStore: { getState: () => ({ pdfBytes: mocks.pdfBytes, status: mocks.compileStatus, lastCompileCheckpoint: mocks.checkpoint }) },
}));
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
  uint8ToBase64: (bytes: Uint8Array) => `base64:${[...bytes].join(",")}`,
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
import { useConfirmDialogStore } from "@/store/confirm-dialog";
import { usePdfViewStore } from "@/store/pdf-view";
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
  mocks.downloadProjectZip.mockResolvedValue({ skippedLinks: 0 });
  mocks.pdfPageToPng.mockResolvedValue("data:image/png;base64,AQ==");
  mocks.compileStatus = "success";
  mocks.checkpointCurrent = true;
  mocks.checkpoint = null;
  usePdfViewStore.setState({ page: 1 });
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

  it("tells the palette user to compile first when there is no PDF", async () => {
    mocks.pdfBytes = null;
    await exportCurrentPdf();
    mocks.pdfBytes = new Uint8Array([1, 2]);

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(i18n.t(($) => $.shell.toolbar.compilePdfFirst));
    expect(mocks.pickSavePath).not.toHaveBeenCalled();
  });
});

describe("the exported PDF is the one on screen", () => {
  it("sends the preview's bytes as they are when the save dialog closes", async () => {
    mocks.pickSavePath.mockImplementationOnce(async () => {
      mocks.pdfBytes = new Uint8Array([9, 8]);
      return "/tmp/out.pdf";
    });
    await exportCurrentPdf();
    mocks.pdfBytes = new Uint8Array([1, 2]);

    expect(mocks.exportPdf).toHaveBeenCalledExactlyOnceWith("paper-a", "/tmp/out.pdf", "base64:9,8");
  });

  it("still saves the shown PDF while a new compile is running", async () => {
    mocks.compileStatus = "compiling";
    await exportCurrentPdf();

    expect(mocks.exportPdf).toHaveBeenCalledExactlyOnceWith("paper-a", "/tmp/paper.typ", "base64:1,2");
    expect(mocks.successUnique).toHaveBeenCalledOnce();
    expect(mocks.infoUnique).not.toHaveBeenCalled();
  });

  it("copies the compiled PDF on disk instead of sending bytes when it is the one on screen", async () => {
    mocks.checkpoint = { mainDocument: "main.tex" };
    await exportCurrentPdf();

    expect(mocks.exportPdf).toHaveBeenCalledExactlyOnceWith("paper-a", "/tmp/paper.typ", undefined);
  });

  it("sends the bytes when the build folder may hold another PDF than the preview", async () => {
    for (const [status, current, mainDocument] of [
      ["compiling", true, "main.tex"],
      ["error", true, "main.tex"],
      ["success", false, "main.tex"],
      ["success", true, "chapters/main.tex"],
    ] as const) {
      mocks.exportPdf.mockClear();
      mocks.compileStatus = status;
      mocks.checkpointCurrent = current;
      mocks.checkpoint = { mainDocument };
      await exportCurrentPdf();

      expect(mocks.exportPdf).toHaveBeenCalledExactlyOnceWith("paper-a", "/tmp/paper.typ", "base64:1,2");
    }
  });

  it("stops quietly if the PDF went away while the dialog was open", async () => {
    mocks.pickSavePath.mockImplementationOnce(async () => {
      mocks.pdfBytes = null;
      return "/tmp/out.pdf";
    });
    await exportCurrentPdf();
    await exportCurrentImagePng();
    mocks.pdfBytes = new Uint8Array([1, 2]);

    expect(mocks.exportPdf).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });
});

describe("stale and failed compiles", () => {
  const notices = () => mocks.infoUnique.mock.calls.map((call) => call[1]);

  it.each([
    ["PDF", exportCurrentPdf],
    ["PNG", exportCurrentImagePng],
  ] as const)("says a %s comes from the last compile when the source has moved on", async (kind, exportFile) => {
    mocks.checkpointCurrent = false;
    await exportFile();

    expect(mocks.successUnique).not.toHaveBeenCalled();
    expect(notices()).toEqual([i18n.t(($) => $.core.export.savedStale, { kind, fileName: "paper.typ" })]);
    expect(mocks.infoUnique.mock.calls[0][0]).toBe(EXPORT_KEY);
    expect(mocks.infoUnique.mock.calls[0][2]?.label).toBe(i18n.t(($) => $.core.export.showInFolder));
  });

  it.each(["error", "unavailable"])("warns that a %s compile may have left an incomplete file", async (status) => {
    mocks.compileStatus = status;
    await exportCurrentPdf();

    expect(notices()).toEqual([
      i18n.t(($) => $.core.export.savedAfterFailedCompile, { kind: "PDF", fileName: "paper.typ" }),
    ]);
  });

  it("checks the state when the dialog closes, not when it opened", async () => {
    mocks.pickSavePath.mockImplementationOnce(async () => {
      mocks.checkpointCurrent = false;
      return "/tmp/out.pdf";
    });
    await exportCurrentPdf();

    expect(notices()).toEqual([i18n.t(($) => $.core.export.savedStale, { kind: "PDF", fileName: "out.pdf" })]);
  });
});

describe("coded export errors", () => {
  const coded = (code: string, params: Record<string, string> = {}) =>
    `${APP_ERROR_PREFIX}${JSON.stringify({ code, params, detail: null })}`;

  it("explains a coded failure in words for PDF and PNG", async () => {
    const missing = coded("project.linked_missing", { folder: "thesis" });
    mocks.exportPdf.mockRejectedValueOnce(missing);
    mocks.exportProjectImage.mockRejectedValueOnce(coded("export.inside_project"));
    await exportCurrentPdf();
    await exportCurrentImagePng();

    const [pdf, png] = mocks.notifyError.mock.calls.map((call) => String(call[2]));
    expect(pdf).not.toContain(APP_ERROR_PREFIX);
    expect(pdf).toContain("thesis");
    expect(png).toBe(i18n.t(($) => $.core.export.pngFailedDetail, { detail: enErrors.export.inside_project }));
  });

  it("translates the project-changed refusal", async () => {
    mocks.pickSavePath.mockImplementationOnce(async () => { mocks.state.projectId = "paper-b"; return "/tmp/out.pdf"; });
    await exportCurrentPdf();

    expect(mocks.notifyError.mock.calls[0][2]).toBe(
      i18n.t(($) => $.core.export.pdfFailedDetail, { detail: i18n.t(($$) => $$.core.export.projectChanged) }),
    );
  });
});

describe("page and archive exports", () => {
  it("renders the page being viewed", async () => {
    usePdfViewStore.setState({ page: 4 });
    await exportCurrentImagePng(2);

    expect(mocks.pdfPageToPng).toHaveBeenCalledExactlyOnceWith(mocks.pdfBytes, 4, 2);
  });

  it("falls back to the first page when the remembered page is gone", async () => {
    usePdfViewStore.setState({ page: 9 });
    mocks.pdfPageToPng.mockRejectedValueOnce(new Error("page 9 out of range (document has 2)"));
    await exportCurrentImagePng();

    expect(mocks.pdfPageToPng.mock.calls.map((call) => call[1])).toEqual([9, 1]);
    expect(mocks.exportProjectImage).toHaveBeenCalledOnce();
  });

  it("keeps non-ASCII project names in the suggested file name", async () => {
    mocks.state.projectName = "论文 初稿";
    try {
      await exportCurrentPdf();
      await exportCurrentImagePng();
      await exportCurrentDocument("docx");
    } finally {
      mocks.state.projectName = "My paper";
    }

    expect(mocks.pickSavePath.mock.calls.map(([options]) => options.defaultPath)).toEqual([
      "论文_初稿.pdf",
      "论文_初稿.png",
      "论文_初稿.docx",
    ]);
  });

  it("says how many links a source archive left out", async () => {
    mocks.downloadProjectZip.mockResolvedValueOnce({ skippedLinks: 2 });
    await exportCurrentDocument("zip");

    expect(mocks.successUnique).not.toHaveBeenCalled();
    expect(mocks.infoUnique.mock.calls.at(-1)?.[1]).toBe(
      i18n.t(($) => $.core.export.savedWithoutLinks, { kind: "ZIP", fileName: "paper.typ", count: 2 }),
    );
  });
});

describe("export warnings", () => {
  const warning = (name: string) =>
    `${APP_ERROR_PREFIX}${JSON.stringify({ code: "export.warning_image_missing", params: { name } })}`;

  afterEach(() => {
    useConfirmDialogStore.setState({ queue: [] });
  });

  it("keeps the plain saved toast when nothing was lost", async () => {
    mocks.exportDocument.mockResolvedValueOnce({ warnings: [], skipped: [], outdatedTypst: null });
    await exportCurrentDocument("docx");
    expect(mocks.successUnique).toHaveBeenCalledExactlyOnceWith(
      EXPORT_KEY,
      savedMessage("DOCX", "paper.typ"),
      expect.objectContaining({ label: i18n.t(($) => $.core.export.showInFolder) }),
      true,
    );
  });

  it("says how many things went wrong and lists them in the user's language", async () => {
    mocks.exportDocument.mockResolvedValueOnce({
      warnings: [warning("a.png"), warning("b.png")],
      skipped: [],
      outdatedTypst: null,
    });
    await exportCurrentDocument("docx");

    expect(mocks.successUnique).not.toHaveBeenCalled();
    const [key, message, action] = mocks.infoUnique.mock.calls.at(-1) as [string, string, ToastAction];
    expect(key).toBe(EXPORT_KEY);
    expect(message).toBe(
      i18n.t(($) => $.core.export.savedWithWarnings, { kind: "DOCX", fileName: "paper.typ", count: 2 }),
    );
    expect(action.label).toBe(i18n.t(($) => $.core.export.showWarnings));

    mocks.revealInDir.mockResolvedValueOnce(undefined);
    action.onClick();
    const pending = useConfirmDialogStore.getState().queue[0];
    expect(pending.title).toBe(i18n.t(($) => $.core.export.warningsTitle));
    expect(pending.message).toBe(
      [
        i18n.t(($) => $.errors.export.warning_image_missing, { name: "a.png" }),
        i18n.t(($) => $.errors.export.warning_image_missing, { name: "b.png" }),
      ].join("\n"),
    );
    pending.settle(true);
    await vi.waitFor(() => expect(mocks.revealInDir).toHaveBeenCalledExactlyOnceWith("/tmp/paper.typ"));
  });

  it("leaves the folder closed when the warnings are dismissed", async () => {
    mocks.exportDocument.mockResolvedValueOnce({ warnings: [warning("a.png")], skipped: [], outdatedTypst: null });
    await exportCurrentDocument("docx");
    const action = mocks.infoUnique.mock.calls.at(-1)?.[2] as ToastAction;
    action.onClick();
    useConfirmDialogStore.getState().queue[0].settle(false);
    await Promise.resolve();
    expect(mocks.revealInDir).not.toHaveBeenCalled();
  });

  it.each(["tex", "typst", "md"] as const)("reminds that a %s export needs its project files", async (format) => {
    mocks.state.engine.id = "latex";
    await exportCurrentDocument(format);

    const kind = (format === "typst" ? "typ" : format).toUpperCase();
    expect(mocks.successUnique).not.toHaveBeenCalled();
    expect(mocks.infoUnique.mock.calls.at(-1)?.[1]).toBe(
      i18n.t(($) => $.core.export.savedSource, { kind, fileName: "paper.typ" }),
    );
  });
});
