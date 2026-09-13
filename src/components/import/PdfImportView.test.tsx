// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const createProjectFromConversion = vi.fn(async () => {});
const downloadFigure = vi.fn(async () => {});
const downloadTex = vi.fn(async () => {});
const handleDownloadZipClick = vi.fn(async () => {});
const handlePickedFile = vi.fn(async () => {});
const refineAvailable = vi.fn(async () => false);
const refineWithAi = vi.fn(async () => {});
const pdfPageToPng = vi.fn(async () => "data:image/png;base64,page");
const toastSuccess = vi.fn();

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
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: () => Promise.resolve(false),
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
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
  writeText.mockReset();
  rerun.mockReset();
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

  it("switches between the preview, source and split views", () => {
    seedConverted({ view: "preview" });
    render(<PdfImportView />);
    expect(screen.queryByTestId("import-source")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("import-view-source"));
    expect(useImportStore.getState().view).toBe("source");
    fireEvent.click(screen.getByTestId("import-view-split"));
    expect(useImportStore.getState().view).toBe("split");
  });

  it("copies the converted source", () => {
    seedConverted();
    render(<PdfImportView />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.pdfImport.copy }),
    );
    expect(writeText).toHaveBeenCalledWith(RESULT.tex);
    expect(toastSuccess).toHaveBeenCalledWith(enLibrary.pdfImport.copied);
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
        "This PDF looks scanned. Transcribe it with a local vision model to recover editable text.",
      ),
    ).toBeInTheDocument();
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
});
