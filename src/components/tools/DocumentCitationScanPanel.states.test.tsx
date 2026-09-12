// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getConfig = vi.fn(async () => ({}) as unknown);
const hasConfiguredProvider = vi.fn((_config?: unknown) => false);
interface ScanOutcome {
  paragraphs: ParagraphCitationResult[];
  totalParagraphs: number;
}

const scanDocumentForCitations = vi.fn(
  async (_args?: unknown): Promise<ScanOutcome> => ({
    paragraphs: [],
    totalParagraphs: 0,
  }),
);
const addCitation = vi.fn(async (_bibtex?: string) => ({ key: "vaswani2017" }));
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getConfig: () => getConfig(),
}));

vi.mock("@/lib/ai-providers", () => ({
  hasConfiguredProvider: (config: unknown) => hasConfiguredProvider(config),
}));

vi.mock("@/features/citation", () => ({
  addCitation: (...args: unknown[]) => addCitation(...(args as [string])),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/lib/document-citation", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/document-citation")>(
      "@/lib/document-citation",
    );
  return {
    ...actual,
    scanDocumentForCitations: (args: unknown) => scanDocumentForCitations(args),
  };
});

import type { ParagraphCitationResult } from "@/lib/document-citation";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { DocumentCitationScanPanel } from "@/components/tools/DocumentCitationScanPanel";
import { clearDocumentScanCache } from "@/lib/document-citation";
import type { LiteratureRecord } from "@/lib/literature-search";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { useFilesStore } from "@/store/files";
import { useLiteratureLibraryStore } from "@/store/literature";
import { useSettingsStore } from "@/store/settings";

const writeText = vi.fn(async () => {});

const RICH_RECORD: LiteratureRecord = {
  id: "s2:paper-1",
  sourceIds: { "semantic-scholar": "paper-1" },
  sources: ["semantic-scholar"],
  title: "Attention Is All You Need",
  authors: ["Vaswani", "Shazeer", "Parmar", "Uszkoreit"],
  year: 2017,
  publicationDate: null,
  venue: "NeurIPS",
  type: "article",
  doi: "10.1000/test",
  url: "https://example.org/attention",
  pdfUrl: null,
  abstract: null,
  citationCount: 2_400_000,
  openAccess: null,
};

const BARE_RECORD: LiteratureRecord = {
  ...RICH_RECORD,
  id: "crossref:paper-2",
  sourceIds: { crossref: "paper-2" },
  sources: ["crossref"],
  title: "An Unlinked Paper",
  authors: [],
  year: null,
  url: null,
  doi: null,
  citationCount: null,
};

function paragraph(
  overrides: Partial<ParagraphCitationResult> = {},
): ParagraphCitationResult {
  return {
    paragraphIndex: 0,
    paragraphPreview: "Transformers improve sequence modeling.",
    query: "transformers",
    sourceErrors: [],
    suggestions: [
      {
        record: RICH_RECORD,
        score: 88,
        reasoning: {
          for: "Directly introduces the architecture.",
          against: "Predates the specific claim.",
        },
      },
    ],
    ...overrides,
  } as ParagraphCitationResult;
}

function seedProject() {
  useFilesStore.setState({
    projectId: "proj-1",
    activePath: "main.tex",
    mainDoc: "main.tex",
    tree: [
      { path: "main.tex", is_dir: false, name: "main.tex" } as never,
      { path: "refs.bib", is_dir: false, name: "refs.bib" } as never,
    ],
    files: {
      "main.tex": {
        content:
          "Deep learning models require large datasets.\n\nTransformers improve sequence modeling.",
        dirty: false,
      },
      "refs.bib": { content: "@article{existing, title={Existing}}", dirty: false },
    },
  });
}

async function scanYielding(...results: ParagraphCitationResult[]) {
  scanDocumentForCitations.mockImplementation(async (args?: unknown) => {
    const callbacks = args as
      | { onParagraph?: (result: ParagraphCitationResult) => void }
      | undefined;
    for (const result of results) callbacks?.onParagraph?.(result);
    return { paragraphs: results, totalParagraphs: results.length };
  });
  render(<DocumentCitationScanPanel />);
  const button = screen.getByTestId("document-citation-scan");
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() =>
    expect(
      screen.queryByText(enResearchTools.citationScan.emptyHeading),
    ).not.toBeInTheDocument(),
  );
}

beforeEach(() => {
  clearDocumentScanCache();
  localStorage.clear();
  getConfig.mockReset();
  getConfig.mockResolvedValue({});
  hasConfiguredProvider.mockReset();
  hasConfiguredProvider.mockReturnValue(false);
  scanDocumentForCitations.mockReset();
  scanDocumentForCitations.mockResolvedValue({
    paragraphs: [],
    totalParagraphs: 0,
  });
  addCitation.mockReset();
  addCitation.mockResolvedValue({ key: "vaswani2017" });
  toastSuccess.mockReset();
  toastError.mockReset();
  writeText.mockReset();
  useSettingsStore.setState({ offline: false });
  useDocumentCitationUiStore.setState({
    modeRequest: "search",
    selectionOverride: null,
    bibOverride: null,
  });
  useLiteratureLibraryStore.setState({ saved: [] });
  seedProject();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

describe("DocumentCitationScanPanel banners", () => {
  it("blocks scanning and explains offline mode", async () => {
    useSettingsStore.setState({ offline: true });
    render(<DocumentCitationScanPanel />);
    expect(
      await screen.findByText(enResearchTools.citationScan.offline),
    ).toBeInTheDocument();
    expect(screen.getByTestId("document-citation-scan")).toBeDisabled();
  });

  it("asks for an open project when there is none", async () => {
    useFilesStore.setState({
      projectId: null,
      activePath: null,
      mainDoc: "",
      tree: [],
      files: {},
    });
    render(<DocumentCitationScanPanel />);
    expect(
      await screen.findByText(enResearchTools.citationScan.noProject),
    ).toBeInTheDocument();
  });

  it("warns when the open project has no source text", async () => {
    useFilesStore.setState({
      projectId: "proj-1",
      activePath: "main.tex",
      mainDoc: "main.tex",
      tree: [{ path: "main.tex", is_dir: false, name: "main.tex" } as never],
      files: { "main.tex": { content: "   ", dirty: false } },
    });
    render(<DocumentCitationScanPanel />);
    expect(
      await screen.findByText(/Source document is empty or not loaded/),
    ).toBeInTheDocument();
  });

  it("shows the empty results state before any scan", async () => {
    render(<DocumentCitationScanPanel />);
    expect(
      await screen.findByText(enResearchTools.citationScan.emptyHeading),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.citationScan.emptyBody),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Scan prose paragraphs in/),
    ).toBeInTheDocument();
  });
});

describe("DocumentCitationScanPanel settings", () => {
  it("persists each tuning input", async () => {
    render(<DocumentCitationScanPanel />);
    const threshold = screen.getByLabelText(
      enResearchTools.citationScan.scoreThreshold,
    );
    fireEvent.change(threshold, { target: { value: "75" } });
    expect(threshold).toHaveValue(75);

    const perParagraph = screen.getByLabelText(
      enResearchTools.citationScan.maxPerParagraph,
    );
    fireEvent.change(perParagraph, { target: { value: "5" } });
    expect(perParagraph).toHaveValue(5);

    const maxParagraphs = screen.getByLabelText(
      enResearchTools.citationScan.maxParagraphs,
    );
    fireEvent.change(maxParagraphs, { target: { value: "9" } });
    expect(maxParagraphs).toHaveValue(9);

    await waitFor(() =>
      expect(screen.getByTestId("document-citation-scan")).not.toBeDisabled(),
    );
  });

  it("falls back to the floor when a tuning input is blanked", () => {
    render(<DocumentCitationScanPanel />);
    const perParagraph = screen.getByLabelText(
      enResearchTools.citationScan.maxPerParagraph,
    );
    fireEvent.change(perParagraph, { target: { value: "" } });
    expect(perParagraph).toHaveValue(1);
    const threshold = screen.getByLabelText(
      enResearchTools.citationScan.scoreThreshold,
    );
    fireEvent.change(threshold, { target: { value: "" } });
    expect(threshold).toHaveValue(0);
  });
});

describe("DocumentCitationScanPanel results", () => {
  it("renders a suggestion with its reasoning toggle", async () => {
    await scanYielding(paragraph());
    expect(
      await screen.findByText(RICH_RECORD.title),
    ).toBeInTheDocument();
    expect(screen.getByText("2.4m citations")).toBeInTheDocument();
    expect(screen.getByText(/Vaswani, Shazeer, Parmar \+1/)).toBeInTheDocument();
    expect(
      screen.getByText(
        enResearchTools.citationScan.query.replace("{{query}}", "transformers"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        enResearchTools.citationScan.paragraph.replace("{{index}}", "1"),
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.citationScan.forAgainst,
      }),
    );
    expect(
      screen.getByText("Directly introduces the architecture."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Predates the specific claim."),
    ).toBeInTheDocument();
  });

  it("renders a bare record without a link or citation count", async () => {
    await scanYielding(
      paragraph({
        suggestions: [{ record: BARE_RECORD, score: 40, reasoning: null }],
      }),
    );
    expect(await screen.findByText(BARE_RECORD.title)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: new RegExp(BARE_RECORD.title) }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.citationScan.unknownAuthors),
    ).toBeInTheDocument();
  });

  it("reports a paragraph with no candidates and its source errors", async () => {
    await scanYielding(
      paragraph({
        suggestions: [],
        sourceErrors: ["PubMed rate limited the request."],
      }),
    );
    expect(
      await screen.findByText(enResearchTools.citationScan.noCandidates),
    ).toBeInTheDocument();
    expect(
      screen.getByText("PubMed rate limited the request."),
    ).toBeInTheDocument();
  });

  it("collapses and reopens a paragraph group", async () => {
    await scanYielding(paragraph());
    const header = await screen.findByText(
      "Transformers improve sequence modeling.",
    );
    const toggle = header.closest("button");
    if (!toggle) throw new Error("no paragraph toggle");
    fireEvent.click(toggle);
    expect(screen.queryByText(RICH_RECORD.title)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText(RICH_RECORD.title)).toBeInTheDocument();
  });

  it("clears the results list", async () => {
    await scanYielding(paragraph());
    await screen.findByText(RICH_RECORD.title);
    fireEvent.click(
      screen.getByRole("button", { name: enCommon.actions.clear }),
    );
    expect(
      screen.getByText(enResearchTools.citationScan.emptyHeading),
    ).toBeInTheDocument();
  });
});

describe("DocumentCitationScanPanel suggestion actions", () => {
  it("copies BibTeX and reports a clipboard failure", async () => {
    await scanYielding(paragraph());
    await screen.findByText(RICH_RECORD.title);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.citationScan.copyBibtex,
      }),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        enResearchTools.citationScan.toastCopied,
      ),
    );

    writeText.mockRejectedValue(new Error("denied"));
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.citationScan.copyBibtex,
      }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        enResearchTools.citationScan.toastCopyFailed,
      ),
    );
  });

  it("appends to the project bibliography and reports the inserted key", async () => {
    await scanYielding(paragraph());
    await screen.findByText(RICH_RECORD.title);
    fireEvent.click(screen.getByTestId("document-citation-add-bib"));
    await waitFor(() => expect(addCitation).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith(
      enResearchTools.citationScan.citeAdded.replace(
        "{{citation}}",
        "\\cite{vaswani2017}",
      ),
    );
  });

  it("surfaces a rejected bibliography write", async () => {
    addCitation.mockResolvedValue({
      error: "No bibliography file",
    } as unknown as { key: string });
    await scanYielding(paragraph());
    await screen.findByText(RICH_RECORD.title);
    fireEvent.click(screen.getByTestId("document-citation-add-bib"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("No bibliography file"),
    );
  });

  it("surfaces a thrown bibliography write", async () => {
    addCitation.mockRejectedValue(new Error("disk full"));
    await scanYielding(paragraph());
    await screen.findByText(RICH_RECORD.title);
    fireEvent.click(screen.getByTestId("document-citation-add-bib"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("disk full"));
  });

  it("reports an updated citation when the record is already saved", async () => {
    await scanYielding(paragraph());
    await screen.findByText(RICH_RECORD.title);
    fireEvent.click(screen.getByTestId("document-citation-save"));
    expect(toastSuccess).toHaveBeenLastCalledWith(
      enResearchTools.citationScan.toastSaved,
    );
    fireEvent.click(screen.getByTestId("document-citation-save"));
    expect(toastSuccess).toHaveBeenLastCalledWith(
      enResearchTools.citationScan.toastUpdated,
    );
  });
});

describe("DocumentCitationScanPanel scan lifecycle", () => {
  it("shows progress, then restores the cached run on a second scan", async () => {
    scanDocumentForCitations.mockImplementation(async (args?: unknown) => {
      const callbacks = args as
        | {
            onProgress?: (progress: unknown) => void;
            onParagraph?: (result: ParagraphCitationResult) => void;
          }
        | undefined;
      callbacks?.onProgress?.({
        phase: "searching",
        completedParagraphs: 1,
        totalParagraphs: 2,
        message: null,
      });
      callbacks?.onParagraph?.(paragraph());
      return { paragraphs: [paragraph()], totalParagraphs: 2 };
    });
    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(
      await screen.findByText(
        enResearchTools.citationScan.progressProcessing
          .replace("{{completed}}", "1")
          .replace("{{total}}", "2"),
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: enCommon.actions.clear }),
    );
    fireEvent.click(screen.getByTestId("document-citation-scan"));
    await waitFor(() =>
      expect(scanDocumentForCitations).toHaveBeenCalledTimes(2),
    );
  });

  it("reports a scan failure and dismisses the banner", async () => {
    scanDocumentForCitations.mockRejectedValue(new Error("index down"));
    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(await screen.findByText("index down")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.citationScan.dismissError,
      }),
    );
    expect(screen.queryByText("index down")).not.toBeInTheDocument();
  });

  it("marks the run cancelled when the scan aborts", async () => {
    scanDocumentForCitations.mockImplementation(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(
      await screen.findByText(
        enResearchTools.citationScan.progressCancelled,
      ),
    ).toBeInTheDocument();
  });

  it("offers a cancel control while the scan is in flight", async () => {
    const pending: { release: (() => void) | null } = { release: null };
    scanDocumentForCitations.mockImplementation(
      () =>
        new Promise<ScanOutcome>((_resolve, reject) => {
          pending.release = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
        }),
    );
    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    const cancel = await screen.findByRole("button", {
      name: enCommon.actions.cancel,
    });
    expect(
      screen.getByText(enResearchTools.citationScan.progressSplitting),
    ).toBeInTheDocument();
    fireEvent.click(cancel);
    pending.release?.();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: enCommon.actions.cancel }),
      ).not.toBeInTheDocument(),
    );
  });

  it("passes the project bib files as bibText", async () => {
    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(scanDocumentForCitations).toHaveBeenCalledTimes(1),
    );
    expect(scanDocumentForCitations).toHaveBeenCalledWith(
      expect.objectContaining({
        bibText: "@article{existing, title={Existing}}",
      }),
    );
  });
});
