// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const createProjectFromConversion = vi.fn(async () => {});
const downloadFigure = vi.fn(async () => {});
const downloadTex = vi.fn(async () => {});
const handleDownloadZipClick = vi.fn(async () => {});
const handlePickedFile = vi.fn(async () => {});
const refineAvailable = vi.fn(async () => false);
const refineWithAi = vi.fn(async () => {});
const pdfPageToPng = vi.fn(async () => "data:image/png;base64,page");
const toastSuccess = vi.fn();
const toastError = vi.fn();
const notifyError = vi.fn();
const nativeDrop = vi.hoisted(() => ({
  files: [] as { name: string; read: () => Promise<File> }[],
}));

vi.mock("@/lib/native-drop", () => ({
  isNativeFileDrop: (transfer: DataTransfer | undefined) =>
    Array.from(transfer?.types ?? []).includes("text/uri-list"),
  takeNativeDrop: async () => nativeDrop.files,
}));

vi.mock("@/features/import", () => ({
  createProjectFromConversion: () => createProjectFromConversion(),
  downloadFigure: (...args: unknown[]) => downloadFigure(...(args as [])),
  downloadTex: () => downloadTex(),
  handleDownloadZipClick: () => handleDownloadZipClick(),
  handlePickedFile: (...args: unknown[]) => handlePickedFile(...(args as [])),
}));

vi.mock("@/features/import-refine", () => ({
  refineAvailable: () => refineAvailable(),
  refineWithAi: () => refineWithAi(),
}));

vi.mock("@/lib/pdf-image", () => ({
  pdfPageToPng: (...args: unknown[]) => pdfPageToPng(...(args as [])),
}));

vi.mock("@/lib/toast", () => ({
  notifyError: (...args: unknown[]) => notifyError(...args),
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/components/tools/ScanTranscribeBanner", () => ({
  ScanTranscribeBanner: ({
    pages,
    range,
  }: {
    pages: readonly { width: number; height: number }[];
    range?: readonly [number, number];
  }) => (
    <div
      data-testid="scan-transcribe-banner"
      data-pages={JSON.stringify(pages)}
      data-range={JSON.stringify(range ?? null)}
    />
  ),
}));

const providerConfig = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("@/components/ai/provider-config", () => ({
  knownProviderConfig: () => providerConfig.current,
  loadProviderConfig: async () => {
    if (!providerConfig.current) throw new Error("no config in tests");
    return providerConfig.current;
  },
  subscribeProviderConfig: () => () => {},
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: () => Promise.resolve(false),
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { PdfImportView } from "@/components/import/PdfImportView";
import { useHomeViewStore } from "@/store/home-view";
import { useImportStore } from "@/store/import";

const writeText = vi.fn(async () => {});

const RESULT = {
  tex: "\\documentclass{article}\\begin{document}Converted\\end{document}",
  report: {
    pages: 3,
    headings: 4,
    paragraphs: 12,
    equations: 2,
    figures: 1,
    likelyScanned: false,
    notes: [],
  },
};

const rerun = vi.fn();

function seedConverted(overrides: Record<string, unknown> = {}) {
  useImportStore.setState({
    open: true,
    fileName: "paper.pdf",
    pdfBytes: new Uint8Array([1, 2, 3]),
    pages: [{} as never],
    figures: [
      { name: "figure-1.png", page: 1, pngDataUrl: "data:image/png;base64,fig" },
    ],
    result: RESULT,
    busy: false,
    error: null,
    view: "split",
    options: {},
    rerun,
    ...overrides,
  });
}

function statsText() {
  return [
    enLibrary.pdfImport.stats.pages_other.replace("{{total}}", "3"),
    enLibrary.pdfImport.stats.headings_other.replace("{{total}}", "4"),
    enLibrary.pdfImport.stats.paragraphs_other.replace("{{total}}", "12"),
    enLibrary.pdfImport.stats.equations_other.replace("{{total}}", "2"),
    enLibrary.pdfImport.stats.figures_one.replace("{{total}}", "1"),
  ].join(" · ");
}

beforeEach(() => {
  createProjectFromConversion.mockReset();
  downloadFigure.mockReset();
  downloadTex.mockReset();
  handleDownloadZipClick.mockReset();
  handlePickedFile.mockReset();
  refineAvailable.mockReset();
  refineAvailable.mockResolvedValue(false);
  refineWithAi.mockReset();
  pdfPageToPng.mockReset();
  pdfPageToPng.mockResolvedValue("data:image/png;base64,page");
  toastSuccess.mockReset();
  notifyError.mockReset();
  writeText.mockReset();
  rerun.mockReset();
  providerConfig.current = null;
  useHomeViewStore.setState({ page: "pdf-import" });
  useImportStore.setState({
    open: false,
    fileName: "",
    pdfBytes: null,
    pages: [],
    figures: [],
    result: null,
    busy: false,
    error: null,
    view: "split",
    options: {},
    scanTranscribed: false,
    scanModel: null,
    scanProgress: null,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

describe("PdfImportView landing", () => {
  it("renders nothing when another page is active", () => {
    useHomeViewStore.setState({ page: "library" });
    const { container } = render(<PdfImportView />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the dropzone and every handled feature", () => {
    render(<PdfImportView />);
    expect(screen.getByTestId("pdf-import-view")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-dropzone")).toBeInTheDocument();
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
    const { word: _word, ...rendered } = enLibrary.pdfImport.handles;
    for (const label of Object.values(rendered)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(enLibrary.pdfImport.local)).toBeInTheDocument();
  });

  it("accepts a dropped file", () => {
    render(<PdfImportView />);
    const dropzone = screen.getByTestId("pdf-dropzone");
    const file = new File(["%PDF"], "paper.pdf", { type: "application/pdf" });
    fireEvent.dragOver(dropzone);
    fireEvent.dragLeave(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(handlePickedFile).toHaveBeenCalledWith(file);
  });

  it("accepts a file chosen through the picker", () => {
    const { container } = render(<PdfImportView />);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
    const file = new File(["%PDF"], "paper.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(handlePickedFile).toHaveBeenCalledWith(file);
  });

  it("opens the picker from the dropzone and the browse link", () => {
    const { container } = render(<PdfImportView />);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
    const click = vi.fn();
    input.click = click;
    fireEvent.click(screen.getByTestId("pdf-dropzone"));
    fireEvent.click(screen.getByTestId("pdf-dropzone-browse"));
    expect(click).toHaveBeenCalledTimes(2);
  });

  it("returns to the tools gallery and closes the import", () => {
    render(<PdfImportView />);
    fireEvent.click(screen.getByTestId("import-back"));
    expect(useHomeViewStore.getState().page).toBe("tools");
    expect(useImportStore.getState().open).toBe(false);
  });
});

describe("PdfImportView converted document", () => {
  it("renders the stats bar, the source pane and the figures strip", async () => {
    seedConverted();
    render(<PdfImportView />);
    expect(screen.getByTestId("import-stats")).toHaveTextContent(statsText());
    expect(screen.getByText("paper.pdf")).toBeInTheDocument();
    expect(screen.getByTestId("import-source")).toBeInTheDocument();
    expect(
      screen.getByTestId("import-figure-figure-1.png"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enLibrary.pdfImport.disclaimer),
    ).toBeInTheDocument();
    await waitFor(() => expect(pdfPageToPng).toHaveBeenCalled());
    expect(
      await screen.findByAltText(
        enLibrary.pdfImport.pageAlt.replace("{{page}}", "1"),
      ),
    ).toBeInTheDocument();
  });

  it("switches between the preview, source and split views", async () => {
    const firstPage = enLibrary.pdfImport.pageAlt.replace("{{page}}", "1");
    seedConverted({ view: "preview" });
    render(<PdfImportView />);
    expect(screen.queryByTestId("import-source")).not.toBeInTheDocument();
    await screen.findByAltText(firstPage);
    fireEvent.click(screen.getByTestId("import-view-source"));
    expect(useImportStore.getState().view).toBe("source");
    expect(screen.queryByAltText(firstPage)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("import-view-split"));
    expect(useImportStore.getState().view).toBe("split");
    await screen.findByAltText(firstPage);
    expect(pdfPageToPng).toHaveBeenCalledTimes(2);
  });

  it("copies the converted source and confirms only after the clipboard write", async () => {
    let finish!: () => void;
    writeText.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    seedConverted();
    render(<PdfImportView />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.pdfImport.copy }),
    );
    expect(writeText).toHaveBeenCalledWith(RESULT.tex);
    expect(toastSuccess).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledExactlyOnceWith(enLibrary.pdfImport.copied));
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("reports a clipboard failure instead of a false success", async () => {
    const failure = new Error("clipboard denied");
    writeText.mockRejectedValueOnce(failure);
    seedConverted();
    render(<PdfImportView />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.pdfImport.copy }),
    );
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledExactlyOnceWith(
        "copy converted LaTeX",
        failure,
        enResearchTools.converter.copyFailed,
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("runs Create project and Refine with AI one at a time", async () => {
    let finish!: () => void;
    createProjectFromConversion.mockReturnValueOnce(
      new Promise<void>((resolve) => { finish = resolve; }),
    );
    refineAvailable.mockResolvedValue(true);
    seedConverted();
    render(<PdfImportView />);
    const refine = await screen.findByTestId("import-refine");
    const create = screen.getByTestId("import-create-project");
    fireEvent.click(create);
    fireEvent.click(create);
    fireEvent.click(refine);
    expect(createProjectFromConversion).toHaveBeenCalledTimes(1);
    expect(refineWithAi).not.toHaveBeenCalled();
    expect(create).toBeDisabled();
    expect(refine).toBeDisabled();
    finish();
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(refine);
    expect(refineWithAi).toHaveBeenCalledTimes(1);
  });

  it("downloads the tex, the zip, a figure and creates a project", () => {
    seedConverted();
    render(<PdfImportView />);
    fireEvent.click(screen.getByRole("button", { name: ".tex" }));
    fireEvent.click(screen.getByRole("button", { name: ".zip" }));
    fireEvent.click(screen.getByTestId("import-figure-figure-1.png"));
    fireEvent.click(screen.getByTestId("import-create-project"));
    expect(downloadTex).toHaveBeenCalledTimes(1);
    expect(handleDownloadZipClick).toHaveBeenCalledTimes(1);
    expect(downloadFigure).toHaveBeenCalledWith(
      expect.objectContaining({ name: "figure-1.png" }),
    );
    expect(createProjectFromConversion).toHaveBeenCalledTimes(1);
  });

  it("offers refine only when a provider is available", async () => {
    refineAvailable.mockResolvedValue(true);
    seedConverted();
    render(<PdfImportView />);
    const refine = await screen.findByTestId("import-refine");
    fireEvent.click(refine);
    expect(refineWithAi).toHaveBeenCalledTimes(1);
  });

  it("starts a new file from the header", () => {
    seedConverted();
    render(<PdfImportView />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.pdfImport.newFile }),
    );
    expect(useImportStore.getState().pdfBytes).toBeNull();
  });

  it("shows the busy and error states", () => {
    seedConverted({ busy: true, error: "conversion failed" });
    render(<PdfImportView />);
    expect(
      screen.getByText(enLibrary.pdfImport.converting),
    ).toBeInTheDocument();
    expect(screen.getByText("conversion failed")).toBeInTheDocument();
  });

  it("warns about a scanned document in the source pane", () => {
    seedConverted({
      view: "source",
      result: { ...RESULT, report: { ...RESULT.report, likelyScanned: true } },
    });
    render(<PdfImportView />);
    expect(
      screen.getByText(
        "This PDF looks scanned. Transcribe it with a vision model to recover editable text.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the Tools banner for a scanned PDF", async () => {
    seedConverted({
      view: "source",
      pages: [
        { width: 612, height: 792, items: [], figureNames: [] },
        { width: 500, height: 700, items: [], figureNames: [] },
      ],
      options: { pageRange: [2, 2] },
      result: { ...RESULT, report: { ...RESULT.report, likelyScanned: true } },
    });
    render(<PdfImportView />);
    const banner = await screen.findByTestId("scan-transcribe-banner");
    expect(JSON.parse(banner.getAttribute("data-pages") ?? "[]")).toEqual([
      { width: 612, height: 792 },
      { width: 500, height: 700 },
    ]);
    expect(JSON.parse(banner.getAttribute("data-range") ?? "null")).toEqual([2, 2]);
  });

  it("shows where scanned pages go and the estimate in every view, not just the source pane", async () => {
    seedConverted({
      view: "preview",
      result: { ...RESULT, report: { ...RESULT.report, likelyScanned: true } },
    });
    render(<PdfImportView />);
    expect(await screen.findByTestId("scan-transcribe-banner")).toBeInTheDocument();
    expect(screen.getByTestId("import-transcribe-scan")).toBeInTheDocument();
  });

  it("names the hosted Tools model's service in the header before a scan is transcribed", async () => {
    providerConfig.current = {
      ai_tools_model: { provider: "openai", model: "gpt-5" },
      ai_keys: { openai: "sk-test" },
    };
    seedConverted({
      view: "preview",
      result: { ...RESULT, report: { ...RESULT.report, likelyScanned: true } },
      scanTranscribed: false,
    });
    render(<PdfImportView />);
    const pill = screen.getByTestId("import-destination");
    expect(pill).toHaveTextContent("Scans go to OpenAI");
    expect(pill).toHaveAttribute("data-destination", "remote");
  });

  it("keeps the Local pill for a document that isn't scanned, whatever the Tools model", () => {
    providerConfig.current = {
      ai_tools_model: { provider: "openai", model: "gpt-5" },
      ai_keys: { openai: "sk-test" },
    };
    seedConverted();
    render(<PdfImportView />);
    expect(screen.getByTestId("import-destination")).toHaveTextContent(enLibrary.pdfImport.local);
  });

  it("labels the transcribe button without promising local", () => {
    seedConverted({
      result: { ...RESULT, report: { ...RESULT.report, likelyScanned: true } },
      scanTranscribed: false,
    });
    render(<PdfImportView />);
    expect(screen.getByTestId("import-transcribe-scan")).toHaveTextContent("Transcribe scan");
    expect(screen.getByTestId("import-destination")).toHaveTextContent(enLibrary.pdfImport.local);
  });

  it("after a hosted transcription the header names where the scan went and the footer names the model", () => {
    seedConverted({
      result: { ...RESULT, report: { ...RESULT.report, likelyScanned: true } },
      scanTranscribed: true,
      scanModel: { label: "Claude Opus 5.5", sentTo: "Anthropic" },
    });
    render(<PdfImportView />);
    expect(screen.getByTestId("import-destination")).toHaveTextContent("Sent to Anthropic");
    expect(
      screen.getByText("Transcribed with Claude Opus 5.5. Review equations and tables."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("scan-transcribe-banner")).not.toBeInTheDocument();
  });

  it("names a local model in the footer and keeps the Local badge", () => {
    seedConverted({
      result: { ...RESULT, report: { ...RESULT.report, likelyScanned: true } },
      scanTranscribed: true,
      scanModel: { label: "glm-ocr", sentTo: null },
    });
    render(<PdfImportView />);
    expect(screen.getByTestId("import-destination")).toHaveTextContent(enLibrary.pdfImport.local);
    expect(screen.getByText("Transcribed with glm-ocr. Review equations and tables.")).toBeInTheDocument();
  });

  it("re-runs the conversion with a page range and a column count", async () => {
    seedConverted();
    render(<PdfImportView />);
    const trigger = screen.getByRole("button", {
      name: enLibrary.pdfImport.options.label,
    });
    fireEvent.pointerDown(
      trigger,
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    fireEvent.click(trigger);
    const range = await screen.findByPlaceholderText(
      enLibrary.pdfImport.options.pageRangePlaceholder,
    );
    fireEvent.change(range, { target: { value: "2-5" } });
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.pdfImport.options.rerun }),
    );
    expect(rerun).toHaveBeenCalledWith(
      expect.objectContaining({ pageRange: [2, 5] }),
    );

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(rerun).toHaveBeenLastCalledWith(
      expect.objectContaining({ columns: 2 }),
    );
  });

  it("passes no page range when the input does not parse", async () => {
    seedConverted();
    render(<PdfImportView />);
    const trigger = screen.getByRole("button", {
      name: enLibrary.pdfImport.options.label,
    });
    fireEvent.pointerDown(
      trigger,
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    fireEvent.click(trigger);
    const range = await screen.findByPlaceholderText(
      enLibrary.pdfImport.options.pageRangePlaceholder,
    );
    fireEvent.change(range, { target: { value: "everything" } });
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.pdfImport.options.rerun }),
    );
    expect(rerun).toHaveBeenCalledWith(
      expect.objectContaining({ pageRange: undefined }),
    );
  });

  it("stops rendering page previews when rasterization fails", async () => {
    pdfPageToPng.mockRejectedValue(new Error("no page"));
    seedConverted({ view: "preview" });
    render(<PdfImportView />);
    await waitFor(() => expect(pdfPageToPng).toHaveBeenCalled());
    expect(
      screen.queryByAltText(
        enLibrary.pdfImport.pageAlt.replace("{{page}}", "1"),
      ),
    ).not.toBeInTheDocument();
  });

  it("opens a PDF a Linux file manager dropped as a link, and accepts the drag on entering", async () => {
    handlePickedFile.mockClear();
    const pdf = new File(["%PDF"], "paper.pdf", { type: "application/pdf" });
    const read = vi.fn(async () => pdf);
    nativeDrop.files = [{ name: "paper.pdf", read }];
    render(<PdfImportView />);
    const dropzone = screen.getByTestId("pdf-dropzone");
    const links = { types: ["text/uri-list", "text/html"], files: [] };

    expect(fireEvent.dragEnter(dropzone, { dataTransfer: links })).toBe(false);
    fireEvent.drop(dropzone, { dataTransfer: links });

    await waitFor(() => expect(handlePickedFile).toHaveBeenCalledWith(pdf));
  });

  it("turns away a Linux drop that is not a PDF without reading it", async () => {
    toastError.mockClear();
    handlePickedFile.mockClear();
    const read = vi.fn(async () => new File(["x"], "paper.docx"));
    nativeDrop.files = [{ name: "paper.docx", read }];
    render(<PdfImportView />);

    fireEvent.drop(screen.getByTestId("pdf-dropzone"), {
      dataTransfer: { types: ["text/uri-list", "text/html"], files: [] },
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(enLibrary.pdfImport.choosePdf));
    expect(read).not.toHaveBeenCalled();
    expect(handlePickedFile).not.toHaveBeenCalled();
  });

  it("turns away a file that is not a PDF", () => {
    toastError.mockClear();
    handlePickedFile.mockClear();
    render(<PdfImportView />);

    fireEvent.drop(screen.getByTestId("pdf-dropzone"), {
      dataTransfer: { files: [new File(["x"], "paper.docx")] },
    });
    fireEvent.drop(screen.getByTestId("pdf-dropzone"), { dataTransfer: { files: [] } });

    expect(toastError).toHaveBeenCalledWith(enLibrary.pdfImport.choosePdf);
    expect(handlePickedFile).not.toHaveBeenCalled();
  });

  it("transcribes a scanned document on request and then stops offering it", () => {
    const transcribeScan = vi.fn(async () => {});
    seedConverted({
      result: { ...RESULT, report: { ...RESULT.report, likelyScanned: true } },
      scanTranscribed: false,
      transcribeScan,
    });
    render(<PdfImportView />);

    fireEvent.click(screen.getByTestId("import-transcribe-scan"));
    expect(transcribeScan).toHaveBeenCalledTimes(1);

    act(() => useImportStore.setState({ scanTranscribed: true }));
    expect(screen.queryByTestId("import-transcribe-scan")).toBeNull();
    expect(screen.queryByText(enLibrary.pdfImport.disclaimer)).toBeNull();
  });

  it("shows the page a scan transcription is on and cancels it without closing the PDF", () => {
    const cancelScan = vi.fn();
    seedConverted({
      result: { ...RESULT, report: { ...RESULT.report, likelyScanned: true } },
      busy: true,
      scanProgress: { step: "transcribingPage", page: 1, total: 10, pdfPage: 41, model: "glm-ocr" },
      cancelScan,
    });
    render(<PdfImportView />);

    expect(screen.getByTestId("import-progress")).toHaveTextContent("Transcribing page 41 (1 of 10) with glm-ocr");
    expect(screen.getByTestId("import-cancel-scan")).toHaveTextContent(enResearchTools.converter.cancel);
    fireEvent.click(screen.getByTestId("import-cancel-scan"));
    expect(cancelScan).toHaveBeenCalledOnce();
    expect(screen.getByTestId("pdf-import-view")).toBeInTheDocument();

    act(() => useImportStore.setState({ busy: true, scanProgress: null }));
    expect(screen.getByTestId("import-progress")).toHaveTextContent(enLibrary.pdfImport.converting);
    expect(screen.queryByTestId("import-cancel-scan")).toBeNull();
  });
});
