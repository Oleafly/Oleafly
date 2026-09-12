// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { LabSearchPanel } from "@/components/tools/LabSearchPanel";
import { LabSearchToolView } from "@/components/tools/LabSearchToolView";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { toolName } from "@/lib/tool-catalog";

const fetchMock = vi.fn();

const BROAD = {
  id: "https://openalex.org/I123",
  display_name: "Broad Institute",
  country_code: "US",
  type: "facility",
  works_count: 12_500_000,
  cited_by_count: 42_000,
  homepage_url: "https://broadinstitute.org",
  ror: "https://ror.org/05a0ya142",
  geo: { city: "Cambridge", region: "Massachusetts", country: "United States" },
};

const BARE = {
  id: "https://openalex.org/I999",
  display_name: "Unlisted Lab",
  country_code: null,
  type: null,
  works_count: 4200,
  cited_by_count: 12,
  homepage_url: null,
  ror: null,
  geo: {},
};

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function searchField() {
  return screen.getByLabelText(enResearchTools.labSearch.searchAria);
}

function submitButton() {
  return screen.getByRole("button", { name: enResearchTools.labSearch.search });
}

async function searchFor(term: string, body: unknown) {
  fetchMock.mockResolvedValue(okResponse(body));
  render(<LabSearchPanel />);
  fireEvent.change(searchField(), { target: { value: term } });
  fireEvent.click(submitButton());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useSettingsStore.setState({ offline: false });
  useHomeViewStore.setState({ page: "library" });
});

describe("LabSearchPanel", () => {
  it("opens on the getting started panel with suggestions", () => {
    render(<LabSearchPanel />);
    expect(screen.getByTestId("lab-search-panel")).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.labSearch.heading),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.labSearch.gettingStarted),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.labSearch.startBody),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.labSearch.suggestion.genomics),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("warns and refuses to search while offline", () => {
    useSettingsStore.setState({ offline: true });
    render(<LabSearchPanel />);
    expect(
      screen.getByText(enResearchTools.labSearch.offline),
    ).toBeInTheDocument();
    fireEvent.change(searchField(), { target: { value: "Broad" } });
    expect(submitButton()).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a populated institution card", async () => {
    await searchFor("Broad Institute", {
      meta: { count: 3 },
      results: [BROAD],
    });
    expect(
      await screen.findByText(BROAD.display_name),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("api.openalex.org/institutions"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      screen.getByText("Cambridge, Massachusetts, United States"),
    ).toBeInTheDocument();
    expect(screen.getByText("13M")).toBeInTheDocument();
    expect(screen.getByText("42K")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Website/ }),
    ).toHaveAttribute("href", "https://broadinstitute.org/");
    expect(
      screen.getByRole("link", { name: /ROR record/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        enResearchTools.labSearch.resultCount_one.replace("{{count}}", "1"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        enResearchTools.labSearch.matches
          .replace("{{total}}", "3")
          .replace("{{query}}", "Broad Institute"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.labSearch.attribution),
    ).toBeInTheDocument();
  });

  it("falls back to the default type and location for a bare record", async () => {
    await searchFor("Unlisted", { meta: { count: 1 }, results: [BARE] });
    expect(await screen.findByText(BARE.display_name)).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.labSearch.defaultType),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.labSearch.noLocation),
    ).toBeInTheDocument();
    expect(screen.getByText("4.2K")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Website/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the no-results panel for an empty payload", async () => {
    await searchFor("nothing here", { meta: { count: 0 }, results: [] });
    expect(
      await screen.findByText(enResearchTools.labSearch.noResultsHeading),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.labSearch.noResultsBody),
    ).toBeInTheDocument();
  });

  it("runs a search from a suggestion row", async () => {
    fetchMock.mockResolvedValue(okResponse({ meta: { count: 1 }, results: [BROAD] }));
    render(<LabSearchPanel />);
    fireEvent.click(screen.getByText("Broad Institute"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(searchField()).toHaveValue("Broad Institute");
    expect(await screen.findByText("Cambridge, Massachusetts, United States")).toBeInTheDocument();
  });

  it("reports the rate limit message on HTTP 429", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as unknown as Response);
    render(<LabSearchPanel />);
    fireEvent.change(searchField(), { target: { value: "Broad" } });
    fireEvent.click(submitButton());
    expect(
      await screen.findByText(enResearchTools.labSearch.errorRateLimited),
    ).toBeInTheDocument();
  });

  it("reports the status code for other HTTP failures", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response);
    render(<LabSearchPanel />);
    fireEvent.change(searchField(), { target: { value: "Broad" } });
    fireEvent.click(submitButton());
    expect(
      await screen.findByText(
        enResearchTools.labSearch.errorHttp.replace("{{status}}", "503"),
      ),
    ).toBeInTheDocument();
  });

  it("reports a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<LabSearchPanel />);
    fireEvent.change(searchField(), { target: { value: "Broad" } });
    fireEvent.click(submitButton());
    expect(
      await screen.findByText(enResearchTools.labSearch.errorNetwork),
    ).toBeInTheDocument();
  });

  it("stays quiet when the in-flight request is aborted", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("aborted", "AbortError"),
    );
    render(<LabSearchPanel />);
    fireEvent.change(searchField(), { target: { value: "Broad" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText(enResearchTools.labSearch.gettingStarted),
      ).toBeInTheDocument(),
    );
  });

  it("shows the loading skeleton while a search is in flight", async () => {
    const pending: { settle: ((value: Response) => void) | null } = {
      settle: null,
    };
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.settle = resolve;
        }),
    );
    render(<LabSearchPanel />);
    fireEvent.change(searchField(), { target: { value: "Broad" } });
    fireEvent.click(submitButton());
    expect(
      await screen.findByRole("status", {
        name: enResearchTools.labSearch.loadingAria,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: enResearchTools.labSearch.searching }),
    ).toBeDisabled();
    pending.settle?.(okResponse({ meta: { count: 0 }, results: [] }));
    await waitFor(() =>
      expect(
        screen.getByText(enResearchTools.labSearch.noResultsHeading),
      ).toBeInTheDocument(),
    );
  });
});

describe("LabSearchToolView", () => {
  it("renders the panel inside the tool shell", () => {
    useHomeViewStore.setState({ page: "lab-search" });
    render(<LabSearchToolView />);
    expect(screen.getByTestId("lab-search-tool-view")).toBeInTheDocument();
    expect(screen.getAllByText(toolName("lab-search")).length).toBeGreaterThan(0);
    expect(
      screen.getByText(enResearchTools.labSearch.subtitle),
    ).toBeInTheDocument();
    expect(screen.getByTestId("lab-search-panel")).toBeInTheDocument();
  });
});
