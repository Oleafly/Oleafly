// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getConfig = vi.fn(async () => ({}));
const hasConfiguredProvider = vi.fn((_config?: unknown) => false);
const scanDocumentForCitations = vi.fn(async (_args?: unknown) => ({
  paragraphs: [],
  totalParagraphs: 0,
}));
const addCitation = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getConfig: () => getConfig(),
}));

vi.mock("@/lib/ai-providers", () => ({
  hasConfiguredProvider: (config: unknown) => hasConfiguredProvider(config),
}));

vi.mock("@/features/citation", () => ({
  addCitation: (...args: unknown[]) => addCitation(...args),
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
  const actual = await vi.importActual<
    typeof import("@/lib/document-citation")
  >("@/lib/document-citation");
  return {
    ...actual,
    scanDocumentForCitations: (args: unknown) =>
      scanDocumentForCitations(args),
  };
});

import { LiteratureSearchPanel } from "@/components/tools/LiteratureSearchPanel";
import { DocumentCitationScanPanel } from "@/components/tools/DocumentCitationScanPanel";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { useLiteratureLibraryStore } from "@/store/literature";
import type { LiteratureRecord } from "@/lib/literature-search";

const sampleRecord: LiteratureRecord = {
  id: "s2:paper-1",
  sourceIds: { "semantic-scholar": "paper-1" },
  sources: ["semantic-scholar"],
  title: "Attention Is All You Need",
  authors: ["Vaswani"],
  year: 2017,
  publicationDate: null,
  venue: "NeurIPS",
  type: "article",
  doi: "10.1000/test",
  url: null,
  pdfUrl: null,
  abstract: null,
  citationCount: 100,
  openAccess: null,
};

beforeEach(() => {
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
  toastSuccess.mockReset();
  toastError.mockReset();

  useSettingsStore.setState({ offline: false });
  useDocumentCitationUiStore.setState({
    modeRequest: "search",
    selectionOverride: null,
    bibOverride: null,
  });
  useLiteratureLibraryStore.setState({ saved: [] });
  useFilesStore.setState({
    projectId: "proj-1",
    activePath: "main.tex",
    mainDoc: "main.tex",
    tree: [{ path: "main.tex", is_dir: false, name: "main.tex" } as never],
    files: {
      "main.tex": {
        content:
          "Deep learning models require large datasets for training.\n\nTransformers improve sequence modeling.",
        dirty: false,
      },
    },
  });
});

async function runScanWithSuggestion() {
  scanDocumentForCitations.mockImplementation(async (args?: unknown) => {
    const onParagraph = (
      args as { onParagraph?: (result: unknown) => void } | undefined
    )?.onParagraph;
    onParagraph?.({
      paragraphIndex: 0,
      paragraphPreview: "Transformers improve sequence modeling.",
      query: "transformers",
      sourceErrors: [],
      suggestions: [
        {
          record: sampleRecord,
          score: 88,
          reasoning: null,
        },
      ],
    });
    return { paragraphs: [], totalParagraphs: 1 };
  });

  render(<DocumentCitationScanPanel />);
  const button = screen.getByTestId("document-citation-scan");
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => {
    expect(screen.getByTestId("document-citation-save")).toBeInTheDocument();
  });
}

describe("DocumentCitationScanPanel", () => {
  it("renders Find citations control", async () => {
    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Find citations");
    // Disabled until provider check finishes
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("shows heuristic ranking banner when no AI provider is configured", async () => {
    render(<DocumentCitationScanPanel />);
    expect(
      await screen.findByText(
        /Ranking will use citation counts only until an AI provider is configured/i,
      ),
    ).toBeInTheDocument();
  });

  it("calls scanDocumentForCitations with rankMode heuristic when no provider", async () => {
    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);

    await waitFor(() => {
      expect(scanDocumentForCitations).toHaveBeenCalledTimes(1);
    });

    expect(scanDocumentForCitations).toHaveBeenCalledWith(
      expect.objectContaining({
        rankMode: "heuristic",
        sourceText: expect.stringContaining("Deep learning models"),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("calls scanDocumentForCitations with rankMode llm when provider is ready", async () => {
    hasConfiguredProvider.mockReturnValue(true);
    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);

    await waitFor(() => {
      expect(scanDocumentForCitations).toHaveBeenCalledTimes(1);
    });

    expect(scanDocumentForCitations).toHaveBeenCalledWith(
      expect.objectContaining({
        rankMode: "llm",
      }),
    );
  });

  it("Save citation uses literature library when no project is open", async () => {
    useFilesStore.setState({
      projectId: null,
      activePath: null,
      mainDoc: "",
      tree: [],
      files: {},
    });
    useDocumentCitationUiStore
      .getState()
      .requestDocumentScan("Selected prose about transformers for citations.");

    await runScanWithSuggestion();

    fireEvent.click(screen.getByTestId("document-citation-save"));

    expect(useLiteratureLibraryStore.getState().saved).toHaveLength(1);
    expect(useLiteratureLibraryStore.getState().saved[0]?.record.title).toBe(
      sampleRecord.title,
    );
    expect(toastSuccess).toHaveBeenCalledWith("Citation saved");
    expect(addCitation).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalledWith(
      expect.stringMatching(/Added \\cite/),
    );
  });

  it("Add to .bib without project toasts error and does not claim success", async () => {
    useFilesStore.setState({
      projectId: null,
      activePath: null,
      mainDoc: "",
      tree: [],
      files: {},
    });
    useDocumentCitationUiStore
      .getState()
      .requestDocumentScan("Selected prose about transformers for citations.");

    await runScanWithSuggestion();

    fireEvent.click(screen.getByTestId("document-citation-add-bib"));

    expect(toastError).toHaveBeenCalledWith(
      "Open a project to append to a bibliography file",
    );
    expect(addCitation).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("uses bibOverride when set from command path", async () => {
    useFilesStore.setState({
      projectId: null,
      activePath: null,
      mainDoc: "",
      tree: [],
      files: {},
    });
    useDocumentCitationUiStore
      .getState()
      .requestDocumentScan(
        "Selected prose about transformers for citations.",
        "@article{existing,\n  title={Existing Work},\n}",
      );

    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    await waitFor(() => {
      expect(scanDocumentForCitations).toHaveBeenCalledTimes(1);
    });
    expect(scanDocumentForCitations).toHaveBeenCalledWith(
      expect.objectContaining({
        bibText: "@article{existing,\n  title={Existing Work},\n}",
      }),
    );
    expect(useDocumentCitationUiStore.getState().bibOverride).toBeNull();
  });
});

describe("LiteratureSearchPanel mode toggle", () => {
  it("switches to From document mode and shows scan panel", async () => {
    render(<LiteratureSearchPanel />);
    expect(screen.getByTestId("citation-search-mode")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("citation-search-mode-document"));
    expect(screen.getByTestId("document-citation-scan")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("document-citation-scan")).not.toBeDisabled(),
    );
  });

  it("opens From document mode when modeRequest is document", async () => {
    useDocumentCitationUiStore.getState().requestDocumentScan("Selected prose about transformers.");
    render(<LiteratureSearchPanel />);
    expect(screen.getByTestId("document-citation-scan")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("document-citation-scan")).not.toBeDisabled(),
    );
    expect(screen.getByText(/editor selection/i)).toBeInTheDocument();
    expect(useDocumentCitationUiStore.getState().modeRequest).toBe("search");
  });
});

describe("DocumentCitationScanPanel selection override", () => {
  it("uses selectionOverride as sourceText without a project", async () => {
    useFilesStore.setState({
      projectId: null,
      activePath: null,
      mainDoc: "",
      tree: [],
      files: {},
    });
    useDocumentCitationUiStore
      .getState()
      .requestDocumentScan("Selected prose about transformers for citations.");

    render(<DocumentCitationScanPanel />);
    const button = screen.getByTestId("document-citation-scan");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    await waitFor(() => {
      expect(scanDocumentForCitations).toHaveBeenCalledTimes(1);
    });
    expect(scanDocumentForCitations).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: "Selected prose about transformers for citations.",
      }),
    );
    expect(useDocumentCitationUiStore.getState().selectionOverride).toBeNull();
  });
});
