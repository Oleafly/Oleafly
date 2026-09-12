// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const openExternal = vi.fn(async (_url: string) => {});

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (url: string) => openExternal(url),
}));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { DeadlinesView, subLabel } from "@/components/deadlines/DeadlinesView";
import type { Venue } from "@/lib/deadlines";
import { useDeadlinesStore } from "@/store/deadlines";
import { useHomeViewStore } from "@/store/home-view";

const NOW = new Date("2026-03-01T00:00:00Z");

const NEURIPS: Venue = {
  id: "neurips-2026",
  title: "NeurIPS",
  full_name: "Conference on Neural Information Processing Systems",
  sub: "AI",
  rank: "CCF-A",
  link: "https://neurips.cc",
  timezone: "AoE",
  deadlines: [{ kind: "abstract_submission", at: "2026-03-04 23:59:59" }],
  conf_date: "December 6 to 12, 2026",
  place: "Vancouver, Canada",
};

const ICSE: Venue = {
  id: "icse-2027",
  title: "ICSE",
  full_name: "International Conference on Software Engineering",
  sub: "SE",
  rank: "CORE-A*",
  link: "",
  timezone: "UTC-7",
  deadlines: [{ kind: "submission", at: "2026-08-20 23:59:59" }],
  conf_date: "",
  place: "",
  estimated: true,
};

const PASSED: Venue = {
  id: "old-2025",
  title: "OLD",
  full_name: "A Finished Conference",
  sub: "ZZ",
  rank: "",
  link: "",
  timezone: "UTC+0",
  deadlines: [{ kind: "submission", at: "2025-01-01 23:59:59" }],
  conf_date: "",
  place: "",
};

const openView = vi.fn(async () => {});
const refresh = vi.fn(async () => {});

function seed(venues: Venue[] | null, overrides: Record<string, unknown> = {}) {
  useDeadlinesStore.setState({
    venues,
    generatedAt: "2026-02-20T08:00:00Z",
    busy: false,
    error: null,
    openView,
    refresh,
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  openExternal.mockReset();
  openView.mockReset();
  refresh.mockReset();
  useHomeViewStore.setState({ page: "deadlines" });
  seed([NEURIPS, ICSE, PASSED]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subLabel", () => {
  it("resolves a label for every catalogued research area", () => {
    for (const code of Object.keys(enLibrary.deadlines.areas)) {
      expect(subLabel(code)).toBe(
        enLibrary.deadlines.areas[
          code as keyof typeof enLibrary.deadlines.areas
        ],
      );
    }
  });

  it("passes an unknown area through unchanged", () => {
    expect(subLabel("ZZ")).toBe("ZZ");
  });
});

describe("DeadlinesView", () => {
  it("renders nothing when another page is active", () => {
    useHomeViewStore.setState({ page: "library" });
    const { container } = render(<DeadlinesView />);
    expect(container).toBeEmptyDOMElement();
    expect(openView).not.toHaveBeenCalled();
  });

  it("loads the dataset and renders a card per upcoming venue", () => {
    render(<DeadlinesView />);
    expect(openView).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("deadlines-view")).toBeInTheDocument();
    expect(
      screen.getByText(enLibrary.deadlines.heading),
    ).toBeInTheDocument();
    expect(screen.getByTestId("deadline-card-neurips-2026")).toBeInTheDocument();
    expect(screen.getByTestId("deadline-card-icse-2027")).toBeInTheDocument();
    expect(
      screen.queryByTestId("deadline-card-old-2025"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        enLibrary.deadlines.shown_other.replace("{{total}}", "2"),
      ),
    ).toBeInTheDocument();
  });

  it("renders the countdown, urgency and timezone line for the soonest venue", () => {
    render(<DeadlinesView />);
    const card = screen.getByTestId("deadline-card-neurips-2026");
    expect(card).toHaveTextContent(
      enLibrary.deadlines.nextDeadline.replace(
        "{{kind}}",
        "Abstract Submission",
      ),
    );
    expect(card).toHaveTextContent(enLibrary.deadlines.urgency.soon);
    expect(card).toHaveTextContent(enLibrary.deadlines.units.days);
    expect(card.querySelector('[data-countdown-unit="days"]')).toHaveAttribute(
      "data-countdown-value",
      "4",
    );
    expect(card).toHaveTextContent("Mar 4, 2026 at 11:59 PM AoE");
    expect(card).toHaveTextContent(NEURIPS.conf_date);
    expect(card).toHaveTextContent(NEURIPS.place);
  });

  it("marks the closing-soon urgency inside three days", () => {
    seed([
      {
        ...NEURIPS,
        deadlines: [{ kind: "submission", at: "2026-03-02 12:00:00" }],
      },
    ]);
    render(<DeadlinesView />);
    expect(screen.getByTestId("deadline-card-neurips-2026")).toHaveTextContent(
      enLibrary.deadlines.urgency.critical,
    );
  });

  it("marks an estimated venue and its comfortable urgency", () => {
    render(<DeadlinesView />);
    const card = screen.getByTestId("deadline-card-icse-2027");
    expect(card).toHaveTextContent(enLibrary.deadlines.estimatedBadge);
    expect(card).toHaveTextContent(enLibrary.deadlines.urgency.comfortable);
    expect(card).toHaveTextContent(subLabel("SE"));
  });

  it("counts the venues closing within seven and thirty days", () => {
    render(<DeadlinesView />);
    const sevenDays = screen
      .getByText(enLibrary.deadlines.stats.next7Days)
      .closest("div");
    expect(sevenDays).toHaveTextContent("1");
    const estimated = screen
      .getByText(enLibrary.deadlines.stats.estimated)
      .closest("div");
    expect(estimated).toHaveTextContent("1");
  });

  it("opens the venue website through the shell plugin", () => {
    render(<DeadlinesView />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enLibrary.deadlines.officialWebsite,
      }),
    );
    expect(openExternal).toHaveBeenCalledWith(NEURIPS.link);
  });

  it("filters by search text and resets the filters", () => {
    render(<DeadlinesView />);
    fireEvent.change(screen.getByTestId("deadlines-search"), {
      target: { value: "icse" },
    });
    expect(
      screen.queryByTestId("deadline-card-neurips-2026"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("deadline-card-icse-2027")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: enLibrary.deadlines.resetFilters,
      }),
    );
    expect(screen.getByTestId("deadline-card-neurips-2026")).toBeInTheDocument();
  });

  it("clears the query from the inline clear button", () => {
    render(<DeadlinesView />);
    const search = screen.getByTestId("deadlines-search");
    fireEvent.change(search, { target: { value: "icse" } });
    fireEvent.click(
      screen.getByRole("button", { name: enCommon.actions.clear }),
    );
    expect(search).toHaveValue("");
  });

  it("shows the empty state when nothing matches and clears from it", () => {
    render(<DeadlinesView />);
    fireEvent.change(screen.getByTestId("deadlines-search"), {
      target: { value: "zzzz-no-venue" },
    });
    expect(
      screen.getByText(enLibrary.deadlines.emptyTitle),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: enLibrary.deadlines.clearFilters,
      }),
    );
    expect(screen.getByTestId("deadline-card-neurips-2026")).toBeInTheDocument();
  });

  it("includes passed deadlines when the switch is on", () => {
    render(<DeadlinesView />);
    fireEvent.click(
      screen.getByLabelText(enLibrary.deadlines.includePassedLabel),
    );
    expect(screen.getByTestId("deadline-card-old-2025")).toBeInTheDocument();
    expect(
      screen.getByText(enLibrary.deadlines.allPassed),
    ).toBeInTheDocument();
  });

  it("refreshes the dataset", () => {
    render(<DeadlinesView />);
    fireEvent.click(screen.getByTestId("deadlines-refresh"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("disables refresh while the store is busy", () => {
    seed([NEURIPS], { busy: true });
    render(<DeadlinesView />);
    expect(
      screen.getByLabelText(enLibrary.deadlines.refreshingLabel),
    ).toBeDisabled();
  });

  it("opens the help dialog", async () => {
    render(<DeadlinesView />);
    fireEvent.click(screen.getByTestId("deadlines-help"));
    expect(
      await screen.findByText(enLibrary.deadlines.help.timezonesTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enLibrary.deadlines.help.confirm),
    ).toBeInTheDocument();
  });

  it("shows the skeleton before the dataset arrives", () => {
    seed(null);
    render(<DeadlinesView />);
    expect(
      screen.getByText(enLibrary.deadlines.loadingConferences),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("deadline-card-neurips-2026"),
    ).not.toBeInTheDocument();
  });

  it("surfaces a load failure", () => {
    seed([], { error: "boom" });
    render(<DeadlinesView />);
    expect(
      screen.getByText(enLibrary.deadlines.loadFailed),
    ).toBeInTheDocument();
  });

  it("formats a legacy epoch timestamp and omits an unparsable one", () => {
    seed([NEURIPS], { generatedAt: "epoch:1740000000" });
    const { unmount } = render(<DeadlinesView />);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
    unmount();

    seed([NEURIPS], { generatedAt: "not a date" });
    render(<DeadlinesView />);
    expect(
      screen.getByText(
        enLibrary.deadlines.datasetUpdated.replace("{{date}}", "not a date"),
      ),
    ).toBeInTheDocument();
  });

  it("ticks the countdown once a second", async () => {
    render(<DeadlinesView />);
    const card = screen.getByTestId("deadline-card-neurips-2026");
    const before = card
      .querySelector('[data-countdown-unit="seconds"]')
      ?.getAttribute("data-countdown-value");
    await vi.advanceTimersByTimeAsync(1100);
    await waitFor(() => {
      const after = screen
        .getByTestId("deadline-card-neurips-2026")
        .querySelector('[data-countdown-unit="seconds"]')
        ?.getAttribute("data-countdown-value");
      expect(after).not.toBe(before);
    });
  });
});
