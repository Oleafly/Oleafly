// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const toastSuccess = vi.fn();
const notifyError = vi.fn();

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
  },
  notifyError: (...args: unknown[]) => notifyError(...args),
}));

import enUsage from "@/i18n/locales/en/usage.json" with { type: "json" };
import type {
  UsageReport as UsageReportData,
  UsageReportFilter,
  UsageReportTotals,
  UsageSessionDetail,
} from "@/lib/usage-report";
import { useFilesStore } from "@/store/files";
import { UsageReport, UsageReportDialog } from "@/components/usage/UsageReport";

const LONG_ID = "a".repeat(40);

function totals(overrides: Partial<UsageReportTotals> = {}): UsageReportTotals {
  return {
    recordCount: 4,
    sessionCount: 4,
    childRunCount: 1,
    inputTotal: 0,
    inputKnownRecords: 0,
    inputUnknownRecords: 2,
    inputFresh: 0,
    inputFreshKnownRecords: 0,
    outputTotal: 0,
    outputKnownRecords: 0,
    outputUnknownRecords: 2,
    cacheReadTotal: 500,
    cacheWriteTotal: 0,
    cacheKnownRecords: 2,
    cacheUnknownRecords: 1,
    cacheRate: 0.25,
    estimatedCostUsd: 0,
    costKnownRecords: 0,
    costUnknownRecords: 4,
    unpricedRecords: 0,
    planRecords: 4,
    reportedRecords: 4,
    estimatedRecords: 0,
    unavailableRecords: 2,
    excludedChildRecords: 3,
    ...overrides,
  };
}

function session(overrides: Partial<UsageSessionDetail>): UsageSessionDetail {
  return {
    sessionId: "session",
    projectId: "global",
    runtimeId: "built-in",
    providerId: "openai",
    modelId: "gpt-5",
    occurredAtMs: Date.UTC(2026, 7, 1, 12),
    inputTotal: 100,
    outputTotal: 20,
    cacheReadTotal: 0,
    cacheWriteTotal: 0,
    estimatedCostUsd: null,
    priceVersion: null,
    recordCount: 1,
    unmeasuredRecords: 0,
    unpricedRecords: 0,
    planRecords: 1,
    scope: "session",
    status: "completed",
    measurement: "provider_reported",
    billingMode: "api",
    ...overrides,
  } as UsageSessionDetail;
}

const SESSIONS: UsageSessionDetail[] = [
  session({
    sessionId: "helper-session",
    runtimeId: "built-in:helper",
    scope: "helper",
    status: "in_progress",
    measurement: "runtime_reported",
    billingMode: "local",
    projectId: "Mixed",
  }),
  session({
    sessionId: "acp-session",
    runtimeId: "acp",
    scope: "child",
    status: "failed",
    measurement: "estimated",
    billingMode: "unknown",
    providerId: "Mixed",
    modelId: null,
  }),
  session({
    sessionId: "claude-session",
    runtimeId: "acp:claude",
    status: "cancelled",
    measurement: "unavailable",
    billingMode: "mixed",
    inputTotal: null,
    outputTotal: null,
  }),
  session({
    sessionId: LONG_ID,
    runtimeId: LONG_ID,
    projectId: "named-project",
    status: "interrupted",
    measurement: "mixed_or_unavailable",
    planRecords: 0,
    unpricedRecords: 1,
  }),
  session({
    sessionId: "odd-session",
    status: "queued_up",
    measurement: "who_knows",
    billingMode: "barter",
    estimatedCostUsd: 1.25,
    recordCount: 4,
    unpricedRecords: 2,
    priceVersion: "model-metadata:test",
  }),
];

function report(overrides: Partial<UsageReportData> = {}): UsageReportData {
  return {
    startMs: Date.UTC(2026, 7, 1),
    endMs: Date.UTC(2026, 7, 4),
    timezone: "UTC",
    generatedAtMs: Date.UTC(2026, 7, 4),
    totals: totals(),
    daily: [
      {
        day: "2026-08-01",
        inputTotal: 100,
        outputTotal: 20,
        cacheReadTotal: 0,
        estimatedCostUsd: null,
        recordCount: 1,
        unmeasuredRecords: 0,
      },
      {
        day: "2026-08-02",
        inputTotal: null,
        outputTotal: null,
        cacheReadTotal: 0,
        estimatedCostUsd: null,
        recordCount: 1,
        unmeasuredRecords: 1,
      },
      {
        day: "2026-08-03",
        inputTotal: 4000,
        outputTotal: 1_200_000,
        cacheReadTotal: 0,
        estimatedCostUsd: 0.5,
        recordCount: 2,
        unmeasuredRecords: 0,
      },
    ],
    heatmap: [
      { weekday: 6, hour: 12, tokenTotal: 120, recordCount: 1 },
      { weekday: 1, hour: 3, tokenTotal: null, recordCount: 1 },
    ],
    byProject: [
      {
        key: "global",
        inputTotal: 100,
        outputTotal: 20,
        cacheReadTotal: 0,
        estimatedCostUsd: 0.25,
        recordCount: 4,
        sessionCount: 2,
        unmeasuredRecords: 0,
        unpricedRecords: 1,
        planRecords: 0,
      },
      {
        key: "Unknown",
        inputTotal: null,
        outputTotal: null,
        cacheReadTotal: 0,
        estimatedCostUsd: null,
        recordCount: 1,
        sessionCount: 1,
        unmeasuredRecords: 1,
        unpricedRecords: 0,
        planRecords: 1,
      },
    ],
    byRuntime: [
      {
        key: "acp:claude",
        inputTotal: 10,
        outputTotal: 5,
        cacheReadTotal: 0,
        estimatedCostUsd: null,
        recordCount: 1,
        sessionCount: 1,
        unmeasuredRecords: 0,
        unpricedRecords: 0,
        planRecords: 1,
      },
    ],
    byProvider: [
      {
        key: "openai",
        inputTotal: 10,
        outputTotal: 5,
        cacheReadTotal: 0,
        estimatedCostUsd: null,
        recordCount: 1,
        sessionCount: 1,
        unmeasuredRecords: 0,
        unpricedRecords: 0,
        planRecords: 0,
      },
      {
        key: "Unknown",
        inputTotal: 10,
        outputTotal: 5,
        cacheReadTotal: 0,
        estimatedCostUsd: null,
        recordCount: 1,
        sessionCount: 1,
        unmeasuredRecords: 0,
        unpricedRecords: 0,
        planRecords: 0,
      },
    ],
    byModel: [],
    sessions: {
      page: 1,
      pageSize: 25,
      total: 60,
      items: SESSIONS,
    },
    ...overrides,
  } as UsageReportData;
}

function sectionByHeading(name: string): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  if (!section) throw new Error(`no section for ${name}`);
  return section;
}

function rowFor(sessionId: string): HTMLTableRowElement {
  const cell = within(sectionByHeading(enUsage.sessions.title)).getByText(
    sessionId,
  );
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${sessionId}`);
  return row as HTMLTableRowElement;
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  toastSuccess.mockReset();
  notifyError.mockReset();
  useFilesStore.setState({ projects: [] });
});

afterEach(() => {
  cleanup();
});

describe("UsageReport labels", () => {
  it("names every runtime, billing mode, scope and status it knows", () => {
    render(
      <UsageReport
        report={report()}
        projectNames={new Map([["named-project", "Named project"]])}
      />,
    );

    const sessions = sectionByHeading(enUsage.sessions.title);
    expect(within(sessions).getByText(enUsage.labels.runtimeHelper)).toBeVisible();
    expect(within(sessions).getByText(enUsage.labels.runtimeAcp)).toBeVisible();
    expect(within(sessions).getByText("Claude Code")).toBeVisible();
    expect(
      within(sessions).getAllByText(enUsage.labels.mixed).length,
    ).toBeGreaterThan(0);
    expect(
      within(sessions).getAllByText(enUsage.labels.generalProject).length,
    ).toBeGreaterThan(0);
    expect(within(sessions).getByText("Named project")).toBeVisible();

    expect(rowFor("helper-session")).toHaveTextContent(enUsage.scope.helper);
    expect(rowFor("helper-session")).toHaveTextContent(enUsage.billing.local);
    expect(rowFor("helper-session")).toHaveTextContent(enUsage.status.in_progress);
    expect(rowFor("acp-session")).toHaveTextContent(enUsage.scope.child);
    expect(rowFor("acp-session")).toHaveTextContent(enUsage.billing.unknown);
    expect(rowFor("acp-session")).toHaveTextContent(enUsage.status.failed);
    expect(rowFor("claude-session")).toHaveTextContent(enUsage.billing.mixed);
    expect(rowFor("claude-session")).toHaveTextContent(enUsage.status.cancelled);
    expect(rowFor("odd-session")).toHaveTextContent("queued up");
    expect(rowFor("odd-session")).toHaveTextContent("barter");
  });

  it("truncates a long identifier in the middle", () => {
    render(<UsageReport report={report()} />);
    const shortened = `${LONG_ID.slice(0, 12)}…${LONG_ID.slice(-8)}`;
    expect(
      within(sectionByHeading(enUsage.sessions.title)).getAllByText(shortened)
        .length,
    ).toBe(2);
  });

  it("marks plan-only costs and partial estimates", () => {
    render(<UsageReport report={report()} />);
    const sessions = sectionByHeading(enUsage.sessions.title);
    expect(
      within(sessions).getAllByText(enUsage.cost.local).length,
    ).toBeGreaterThan(0);
    expect(within(sessions).getAllByText(enUsage.cost.plan).length).toBeGreaterThan(0);
    expect(rowFor("odd-session")).toHaveTextContent("$1.25");
    const longRow = within(sessions)
      .getAllByText(`${LONG_ID.slice(0, 12)}…${LONG_ID.slice(-8)}`)[0]
      .closest("tr");
    expect(longRow).toHaveTextContent(enUsage.cost.noEstimate);
  });

  it("keeps unknown totals unknown in the metric row", () => {
    render(<UsageReport report={report()} />);
    const inputMetric = screen
      .getByText(enUsage.report.inputTokens, { selector: "dt" })
      .parentElement;
    expect(inputMetric).toHaveTextContent(enUsage.labels.unknown);
    expect(inputMetric).toHaveTextContent(
      enUsage.counts.inputUnknown_other.replace("{{total}}", "2"),
    );
    expect(
      screen.getByText(enUsage.report.outputTokens, { selector: "dt" })
        .parentElement,
    ).toHaveTextContent(
      enUsage.counts.outputUnknown_other.replace("{{total}}", "2"),
    );
    expect(
      screen.getByText(enUsage.report.cacheReads).parentElement,
    ).toHaveTextContent(
      enUsage.cache.rateWithUnknown
        .replace("{{percent}}", "25.0")
        .replace("{{unknown}}", "1"),
    );
  });

  it("explains excluded child records and unmeasured records", () => {
    render(<UsageReport report={report()} />);
    expect(
      screen.getByText(
        enUsage.counts.excludedChildRecords_other.replace("{{total}}", "3"),
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        enUsage.counts.unmeasured_other.replace("{{total}}", "2"),
      ),
    ).toBeVisible();
  });

  it("reports a cache rate with no unknown records", () => {
    render(
      <UsageReport
        report={report({
          totals: totals({ cacheUnknownRecords: 0, cacheRate: 0.5 }),
        })}
      />,
    );
    expect(
      screen.getByText(enUsage.report.cacheReads).parentElement,
    ).toHaveTextContent(
      enUsage.cache.rate.replace("{{percent}}", "50.0"),
    );
  });

  it("reports an entirely unknown cache rate", () => {
    render(
      <UsageReport
        report={report({
          totals: totals({ cacheRate: null, cacheUnknownRecords: 4 }),
        })}
      />,
    );
    expect(
      screen.getByText(enUsage.report.cacheReads).parentElement,
    ).toHaveTextContent(
      enUsage.counts.cacheUnknown_other.replace("{{total}}", "4"),
    );
  });

  it("says all records are priced when nothing is outstanding", () => {
    render(
      <UsageReport
        report={report({
          totals: totals({
            estimatedCostUsd: 2,
            costKnownRecords: 4,
            unpricedRecords: 0,
            planRecords: 0,
            excludedChildRecords: 0,
            unavailableRecords: 0,
          }),
        })}
      />,
    );
    expect(
      screen.getByText(enUsage.report.costEstimate).parentElement,
    ).toHaveTextContent(enUsage.report.allRecordsPriced);
  });
});

describe("UsageReport charts and tables", () => {
  it("reveals a daily reading on hover and marks a day without counts", () => {
    render(<UsageReport report={report()} />);
    const chart = screen.getByRole("img", {
      name: enUsage.trend.chartLabel,
    });
    const host = chart.parentElement;
    if (!host) throw new Error("no chart host");
    host.getBoundingClientRect = () =>
      ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.mouseMove(host, { clientX: 50 });
    expect(screen.getByRole("status")).toHaveTextContent(
      enUsage.trend.tokensUnavailable,
    );
    fireEvent.mouseMove(host, { clientX: 0 });
    expect(screen.getByRole("status")).toHaveTextContent("100");
    fireEvent.mouseLeave(host);
  });

  it("reports an empty heatmap cell and an unavailable count", () => {
    render(<UsageReport report={report()} />);
    expect(
      screen.getByTitle(
        enUsage.heatmap.cell
          .replace("{{weekday}}", enUsage.heatmap.weekdays.mon)
          .replace("{{hour}}", "3")
          .replace("{{detail}}", enUsage.heatmap.tokenUnavailable),
      ),
    ).toBeInTheDocument();
  });

  it("says a breakdown has no rows", () => {
    render(<UsageReport report={report()} />);
    expect(
      within(sectionByHeading(enUsage.report.models)).getByText(
        enUsage.breakdown.empty,
      ),
    ).toBeVisible();
  });

  it("selects a breakdown row and refuses to select an unknown one", () => {
    const onSelectFilter = vi.fn();
    render(<UsageReport report={report()} onSelectFilter={onSelectFilter} />);
    const providers = sectionByHeading(enUsage.report.providers);
    fireEvent.click(within(providers).getByRole("button", { name: "OpenAI" }));
    expect(onSelectFilter).toHaveBeenCalledWith("provider", "openai");
    expect(
      within(providers).queryByRole("button", { name: "Unknown" }),
    ).not.toBeInTheDocument();

    const agents = sectionByHeading(enUsage.report.agents);
    fireEvent.click(
      within(agents).getByRole("button", { name: "Claude Code" }),
    );
    expect(onSelectFilter).toHaveBeenLastCalledWith("runtime", "acp:claude");
  });

  it("selects a session filter from the session table", () => {
    const onSelectFilter = vi.fn();
    render(<UsageReport report={report()} onSelectFilter={onSelectFilter} />);
    fireEvent.click(
      within(sectionByHeading(enUsage.sessions.title)).getByRole("button", {
        name: "helper-session",
      }),
    );
    expect(onSelectFilter).toHaveBeenCalledWith("session", "helper-session");
  });

  it("pages backwards through the session list", () => {
    const onPageChange = vi.fn();
    render(<UsageReport report={report()} onPageChange={onPageChange} />);
    expect(
      screen.getByText(
        enUsage.sessions.page.replace("{{page}}", "2").replace("{{pageCount}}", "3"),
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: enUsage.sessions.previous }),
    );
    expect(onPageChange).toHaveBeenCalledWith(0);
  });

  it("shows the empty session state", () => {
    render(
      <UsageReport
        report={report({
          sessions: { page: 0, pageSize: 25, total: 0, items: [] },
        })}
      />,
    );
    expect(screen.getByText(enUsage.sessions.emptyTitle)).toBeVisible();
  });

  it("reports a failed export", async () => {
    render(
      <UsageReport
        report={report()}
        onExport={async () => {
          throw new Error("no disk");
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: enUsage.report.exportCsv }),
    );
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("UsageReportDialog controls", () => {
  function renderDialog(
    query: (filter: UsageReportFilter) => Promise<UsageReportData>,
  ) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <UsageReportDialog
          trigger={
            <button type="button">
              <span>{"open-usage"}</span>
            </button>
          }
          query={query}
        />
      </QueryClientProvider>,
    );
  }

  it("refetches from the refresh control", async () => {
    const query = vi.fn(async (_filter: UsageReportFilter) => report());
    renderDialog(query);
    fireEvent.click(screen.getByRole("button", { name: "open-usage" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole("button", { name: enUsage.dialog.refreshLabel }),
    );
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  });

  it("applies a breakdown selection as a filter", async () => {
    const query = vi.fn(async (_filter: UsageReportFilter) => report());
    renderDialog(query);
    fireEvent.click(screen.getByRole("button", { name: "open-usage" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    await screen.findByRole("heading", { name: enUsage.report.providers });
    fireEvent.click(
      within(sectionByHeading(enUsage.report.providers)).getByRole("button", {
        name: "OpenAI",
      }),
    );
    await waitFor(() =>
      expect(query.mock.calls.at(-1)?.[0]).toMatchObject({
        providerIds: ["openai"],
        page: 0,
      }),
    );
  });
});
