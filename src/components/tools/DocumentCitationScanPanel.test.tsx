// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getConfig = vi.fn(async () => ({}));
const hasConfiguredProvider = vi.fn((_config?: unknown) => false);
const scanDocumentForCitations = vi.fn(async (_args?: unknown) => ({
  paragraphs: [],
  totalParagraphs: 0,
}));

vi.mock("@/lib/tauri", () => ({
  getConfig: () => getConfig(),
}));

vi.mock("@/lib/ai-providers", () => ({
  hasConfiguredProvider: (config: unknown) => hasConfiguredProvider(config),
}));

vi.mock("@/features/citation", () => ({
  addCitation: vi.fn(),
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

  useSettingsStore.setState({ offline: false });
  useDocumentCitationUiStore.setState({
    modeRequest: "search",
    selectionOverride: null,
  });
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
