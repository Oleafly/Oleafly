// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const searchLiterature = vi.fn();

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/lib/tauri", () => ({
  getConfig: async () => ({}),
}));

vi.mock("@/lib/ai-providers", () => ({
  hasConfiguredProvider: () => false,
}));

vi.mock("@/lib/literature-search", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/literature-search")>(
      "@/lib/literature-search",
    );
  return {
    ...actual,
    searchLiterature: (args: unknown) => searchLiterature(args),
  };
});

import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { LiteratureSearchPanel } from "@/components/tools/LiteratureSearchPanel";
import { LiteratureSearchToolView } from "@/components/tools/LiteratureSearchToolView";
import {
  DEFAULT_LITERATURE_SOURCES,
  LITERATURE_SOURCES,
  type LiteratureRecord,
  type LiteratureSearchResponse,
} from "@/lib/literature-search";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { useHomeViewStore } from "@/store/home-view";
import { useLiteratureLibraryStore } from "@/store/literature";
import { useSettingsStore } from "@/store/settings";
import { toolName } from "@/lib/tool-catalog";

const writeText = vi.fn(async () => {});

const FULL_RECORD: LiteratureRecord = {
  id: "s2:paper-1",
  sourceIds: { "semantic-scholar": "paper-1", arxiv: "1706.03762" },
  sources: ["semantic-scholar", "arxiv"],
  title: "Attention Is All You Need",
  authors: ["Vaswani", "Shazeer", "Parmar", "Uszkoreit", "Jones"],
  year: 2017,
  publicationDate: null,
  venue: "NeurIPS",
  type: "journal-article",
  doi: "10.1000/test",
  url: "https://example.org/paper",
  pdfUrl: "https://example.org/paper.pdf",
  abstract: "The dominant sequence transduction models are recurrent.",
  citationCount: 125_000,
  openAccess: true,
};

const SPARSE_RECORD: LiteratureRecord = {
  id: "crossref:paper-2",
  sourceIds: { crossref: "paper-2" },
  sources: ["crossref"],
  title: "A Quiet Paper",
  authors: [],
  year: null,
  publicationDate: null,
  venue: null,
  type: null,
  doi: null,
  url: null,
  pdfUrl: null,
  abstract: null,
  citationCount: null,
  openAccess: null,
};

function response(
  overrides: Partial<LiteratureSearchResponse> = {},
): LiteratureSearchResponse {
  return {
    results: [FULL_RECORD, SPARSE_RECORD],
    runs: [
      {
        source: "semantic-scholar",
        status: "ok",
        count: 2,
        total: 1_400_000,
        durationMs: 120,
      },
      {
        source: "pubmed",
        status: "error",
        count: 0,
        total: null,
        durationMs: 40,
        error: "PubMed rate limited the request.",
      },
    ],
    searchedAt: Date.now(),
    cached: false,
    ...overrides,
  };
}

function queryField() {
  return screen.getByLabelText(enResearchTools.literature.queryAria);
}

function searchButton() {
  return screen.getByRole("button", {
    name: enResearchTools.literature.search,
  });
}

async function runQuery(term: string) {
  render(<LiteratureSearchPanel />);
  fireEvent.change(queryField(), { target: { value: term } });
  fireEvent.click(searchButton());
  await waitFor(() => expect(searchLiterature).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  writeText.mockReset();
  searchLiterature.mockReset();
  searchLiterature.mockResolvedValue(response());
  localStorage.clear();
  useSettingsStore.setState({ offline: false, settingsOpen: false });
  useLiteratureLibraryStore.setState({ saved: [] });
  useDocumentCitationUiStore.setState({
    modeRequest: "search",
    selectionOverride: null,
    bibOverride: null,
  });
  useHomeViewStore.setState({ page: "library" });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

describe("LiteratureSearchPanel search mode", () => {
  it("opens on the getting started panel with every source chip", () => {
    render(<LiteratureSearchPanel />);
    expect(screen.getByTestId("literature-search-panel")).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.literature.heading),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.literature.gettingStarted),
    ).toBeInTheDocument();
    for (const source of LITERATURE_SOURCES) {
      expect(screen.getAllByText(source.label).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByText(enResearchTools.literature.pausedTag),
    ).toBeInTheDocument();
    expect(searchButton()).toBeDisabled();
  });

  it("renders results with their metadata and run summary", async () => {
    await runQuery("transformers");
    expect(await screen.findByText(FULL_RECORD.title)).toBeInTheDocument();
    expect(searchLiterature).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "transformers",
        sources: DEFAULT_LITERATURE_SOURCES,
        limit: 12,
        openAccessOnly: false,
        ignoreCache: false,
      }),
    );
    expect(
      screen.getByText(enResearchTools.literature.openAccess),
    ).toBeInTheDocument();
    expect(screen.getByText(/Vaswani, Shazeer, Parmar \+2/)).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.literature.unknownAuthors),
    ).toBeInTheDocument();
    expect(screen.getByText("125k citations")).toBeInTheDocument();
    expect(screen.getByText("doi:10.1000/test")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open PDF/ }),
    ).toHaveAttribute("href", FULL_RECORD.pdfUrl);
    expect(
      screen.getByText(/PubMed rate limited the request/),
    ).toBeInTheDocument();
  });

  it("saves a result into the citation library and lists it under My citations", async () => {
    await runQuery("transformers");
    await screen.findByText(FULL_RECORD.title);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: enResearchTools.literature.saveCitation,
      })[0],
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      enResearchTools.literature.toastSaved,
    );
    expect(useLiteratureLibraryStore.getState().saved).toHaveLength(1);

    const savedTab = screen.getByRole("tab", {
      name: new RegExp(enResearchTools.literature.tabMyCitations),
    });
    fireEvent.mouseDown(savedTab, { button: 0, ctrlKey: false });
    fireEvent.click(savedTab);
    expect(
      await screen.findByText(
        enResearchTools.literature.libraryCount_one.replace("{{count}}", "1"),
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.literature.removeCitation,
      }),
    );
    expect(useLiteratureLibraryStore.getState().saved).toHaveLength(0);
    expect(
      screen.getByText(enResearchTools.literature.libraryHeading),
    ).toBeInTheDocument();
  });

  it("copies BibTeX for a result", async () => {
    await runQuery("transformers");
    await screen.findByText(FULL_RECORD.title);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: enResearchTools.literature.copyBibtex,
      })[0],
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(FULL_RECORD.title),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      enResearchTools.literature.toastCopied,
    );
  });

  it("reports a clipboard failure", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await runQuery("transformers");
    await screen.findByText(FULL_RECORD.title);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: enResearchTools.literature.copyBibtex,
      })[0],
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        enResearchTools.literature.toastCopyFailed,
      ),
    );
  });

  it("shows the no-results panel with the source error banner", async () => {
    searchLiterature.mockResolvedValue(response({ results: [] }));
    await runQuery("nothing");
    expect(
      await screen.findByText(enResearchTools.literature.noResultsHeading),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/PubMed rate limited the request/),
    ).toBeInTheDocument();
  });

  it("surfaces a search failure", async () => {
    searchLiterature.mockRejectedValue(new Error("index unavailable"));
    await runQuery("transformers");
    expect(await screen.findByText("index unavailable")).toBeInTheDocument();
  });

  it("refuses to search while offline", () => {
    useSettingsStore.setState({ offline: true });
    render(<LiteratureSearchPanel />);
    expect(
      screen.getByText(enResearchTools.literature.offline),
    ).toBeInTheDocument();
    fireEvent.change(queryField(), { target: { value: "transformers" } });
    expect(searchButton()).toBeDisabled();
    expect(searchLiterature).not.toHaveBeenCalled();
  });

  it("asks for at least one source once every chip is deselected", () => {
    render(<LiteratureSearchPanel />);
    for (const source of DEFAULT_LITERATURE_SOURCES) {
      const definition = LITERATURE_SOURCES.find(
        (candidate) => candidate.id === source,
      );
      if (!definition) continue;
      fireEvent.click(
        screen.getByRole("button", { name: definition.label, pressed: true }),
      );
    }
    fireEvent.change(queryField(), { target: { value: "transformers" } });
    expect(searchButton()).toBeDisabled();
  });

  it("runs a search from a suggestion row", async () => {
    render(<LiteratureSearchPanel />);
    fireEvent.click(
      screen.getByText("perovskite silicon tandem solar cells"),
    );
    await waitFor(() => expect(searchLiterature).toHaveBeenCalledTimes(1));
    expect(searchLiterature).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "perovskite silicon tandem solar cells",
      }),
    );
  });

  it("opens the filter drawer and toggles open access only", async () => {
    render(<LiteratureSearchPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.literature.filters }),
    );
    const toggle = screen.getByLabelText(
      enResearchTools.literature.openAccessOnly,
    );
    fireEvent.click(toggle);
    fireEvent.change(queryField(), { target: { value: "transformers" } });
    fireEvent.click(searchButton());
    await waitFor(() => expect(searchLiterature).toHaveBeenCalledTimes(1));
    expect(searchLiterature).toHaveBeenCalledWith(
      expect.objectContaining({ openAccessOnly: true }),
    );
  });

  it("re-runs the search ignoring the cache from the refresh control", async () => {
    await runQuery("transformers");
    await screen.findByText(FULL_RECORD.title);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.literature.refreshAria,
      }),
    );
    await waitFor(() => expect(searchLiterature).toHaveBeenCalledTimes(2));
    expect(searchLiterature).toHaveBeenLastCalledWith(
      expect.objectContaining({ ignoreCache: true }),
    );
  });

  it("opens settings from the source setup button", () => {
    render(<LiteratureSearchPanel />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.literature.sourceSetup,
      }),
    );
    const settings = useSettingsStore.getState();
    expect(settings.settingsOpen).toBe(true);
    expect(settings.settingsInitialSection).toBe("integrations");
    expect(settings.settingsScrollTarget).toBe("citation-search");
  });

  it("shows the loading skeleton while a search is in flight", async () => {
    const pending: {
      settle: ((value: LiteratureSearchResponse) => void) | null;
    } = { settle: null };
    searchLiterature.mockImplementation(
      () =>
        new Promise<LiteratureSearchResponse>((resolve) => {
          pending.settle = resolve;
        }),
    );
    render(<LiteratureSearchPanel />);
    fireEvent.change(queryField(), { target: { value: "transformers" } });
    fireEvent.click(searchButton());
    expect(
      await screen.findByRole("status", {
        name: enResearchTools.literature.loadingAria,
      }),
    ).toBeInTheDocument();
    pending.settle?.(response({ results: [] }));
    await waitFor(() =>
      expect(
        screen.getByText(enResearchTools.literature.noResultsHeading),
      ).toBeInTheDocument(),
    );
  });

  it("lists every source in the about popover", async () => {
    render(<LiteratureSearchPanel />);
    const trigger = screen.getByRole("button", {
      name: enResearchTools.literature.sourcesAbout,
    });
    fireEvent.pointerDown(
      trigger,
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    fireEvent.click(trigger);
    expect(
      await screen.findByText(enResearchTools.literature.sourcesTitle),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(enResearchTools.literature.available).length,
    ).toBe(LITERATURE_SOURCES.filter((source) => source.available).length);
    expect(
      screen.getAllByText(enResearchTools.literature.paused).length,
    ).toBe(LITERATURE_SOURCES.filter((source) => !source.available).length);
  });
});

describe("LiteratureSearchPanel review mode", () => {
  it("switches to the paper review surface", () => {
    render(<LiteratureSearchPanel />);
    fireEvent.click(screen.getByTestId("citation-search-mode-review"));
    expect(screen.getByTestId("paper-review-panel")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.literature.modeSearch,
      }),
    );
    expect(screen.queryByTestId("paper-review-panel")).not.toBeInTheDocument();
  });
});

describe("LiteratureSearchToolView", () => {
  it("renders the panel inside the tool shell", () => {
    useHomeViewStore.setState({ page: "literature-search" });
    render(<LiteratureSearchToolView />);
    expect(
      screen.getByTestId("literature-search-tool-view"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(toolName("literature-search")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(enResearchTools.literature.subtitle),
    ).toBeInTheDocument();
    expect(screen.getByTestId("literature-search-panel")).toBeInTheDocument();
  });
});
