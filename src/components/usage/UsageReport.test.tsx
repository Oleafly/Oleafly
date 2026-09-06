// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "@/lib/tauri";
import {
  usageQuickRange,
  type UsageReport as UsageReportData,
  type UsageReportFilter,
} from "@/lib/usage-report";
import { useFilesStore } from "@/store/files";
import { UsageReport, UsageReportDialog } from "./UsageReport";

const toastSuccess = vi.fn();
vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
  },
  notifyError: vi.fn(),
}));

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

afterEach(() => {
  cleanup();
  toastSuccess.mockClear();
  useFilesStore.setState({ projects: [] });
});

function report(recordCount = 1): UsageReportData {
  return {
    startMs: Date.UTC(2026, 7, 1),
    endMs: Date.UTC(2026, 8, 1),
    timezone: "UTC",
    generatedAtMs: Date.UTC(2026, 8, 1),
    totals: {
      recordCount,
      sessionCount: recordCount === 0 ? 0 : 1,
      childRunCount: 0,
      inputTotal: recordCount === 0 ? 0 : 100,
      inputKnownRecords: recordCount,
      inputUnknownRecords: 0,
      inputFresh: 0,
      inputFreshKnownRecords: 0,
      outputTotal: recordCount === 0 ? 0 : 20,
      outputKnownRecords: recordCount,
      outputUnknownRecords: 0,
      cacheReadTotal: 0,
      cacheWriteTotal: 0,
      cacheKnownRecords: 0,
      cacheUnknownRecords: recordCount,
      cacheRate: null,
      estimatedCostUsd: 0,
      costKnownRecords: 0,
      costUnknownRecords: recordCount,
      unpricedRecords: recordCount,
      planRecords: 0,
      reportedRecords: recordCount,
      estimatedRecords: 0,
      unavailableRecords: 0,
      excludedChildRecords: 0,
    },
    daily:
      recordCount === 0
        ? []
        : [
            {
              day: "2026-08-01",
              inputTotal: 100,
              outputTotal: 20,
              cacheReadTotal: 0,
              estimatedCostUsd: null,
              recordCount: 1,
              unmeasuredRecords: 0,
            },
          ],
    heatmap: recordCount === 0 ? [] : [{ weekday: 6, hour: 12, tokenTotal: 120, recordCount: 1 }],
    byProject:
      recordCount === 0
        ? []
        : [
            {
              key: "project",
              inputTotal: 100,
              outputTotal: 20,
              cacheReadTotal: 0,
              estimatedCostUsd: null,
              recordCount: 1,
              sessionCount: 1,
              unmeasuredRecords: 0,
              unpricedRecords: 1,
              planRecords: 0,
            },
          ],
    byRuntime: [],
    byProvider: [],
    byModel: [],
    sessions: {
      page: 0,
      pageSize: 25,
      total: recordCount === 0 ? 0 : 1,
      items:
        recordCount === 0
          ? []
          : [
              {
                sessionId: "session",
                projectId: "project",
                runtimeId: "built-in",
                providerId: "provider",
                modelId: "model",
                occurredAtMs: Date.UTC(2026, 7, 1),
                inputTotal: 100,
                outputTotal: 20,
                cacheReadTotal: 0,
                cacheWriteTotal: 0,
                estimatedCostUsd: null,
                priceVersion: null,
                recordCount: 1,
                unmeasuredRecords: 0,
                unpricedRecords: 1,
                planRecords: 0,
                scope: "session",
                status: "completed",
                measurement: "provider_reported",
                billingMode: "api",
              },
            ],
    },
  };
}

function project(id: string, name: string): ProjectInfo {
  return {
    id,
    name,
    main_doc: "main.tex",
    kind: "",
    created_at: 0,
    updated_at: 0,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
  };
}

function renderDialog(query: (filter: UsageReportFilter) => Promise<UsageReportData>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UsageReportDialog trigger={<button type="button">Open usage</button>} query={query} />
    </QueryClientProvider>,
  );
}

function sectionByHeading(name: string): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  expect(section).not.toBeNull();
  return section as HTMLElement;
}

async function pickOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("UsageReport", () => {
  it("shows unknown cache and cost states without turning them into zero", () => {
    render(<UsageReport report={report()} />);
    expect(screen.getByText("Cache reads").parentElement).toHaveTextContent("Unknown");
    expect(screen.getByText("Cost estimate").parentElement).toHaveTextContent("No estimate");
    expect(screen.getByText("Cost estimate").parentElement).toHaveTextContent("1 record unpriced");
    expect(screen.getByText("Sessions", { selector: "dt" }).parentElement).toHaveTextContent(
      "0 child runs, 1 usage record",
    );
    expect(screen.getByText("Aug 1 to Aug 31, 2026 (UTC)")).toBeVisible();
    expect(screen.getByRole("img", { name: /daily input and output token trend/iu })).toBeVisible();
    expect(screen.getByRole("img", { name: /token activity by UTC weekday and hour/iu })).toBeVisible();
  });

  it("zero-fills the daily trend across the whole range with a date axis", () => {
    render(<UsageReport report={report()} />);
    const trend = sectionByHeading("Daily tokens");
    const rows = within(trend).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(31);
    expect(rows[14]).toHaveTextContent("2026-08-15");
    expect(rows[14]).toHaveTextContent("0");
    expect(within(trend).getByText("Aug 8")).toBeInTheDocument();
    expect(within(trend).getByText("Aug 29")).toBeInTheDocument();
  });

  it("keeps missing chart and table counters visibly unknown", () => {
    const unknown = report();
    unknown.daily[0].inputTotal = null;
    unknown.daily[0].outputTotal = null;
    unknown.heatmap[0].tokenTotal = null;
    unknown.byProject[0].inputTotal = null;
    unknown.byProject[0].outputTotal = null;
    unknown.sessions.items[0].inputTotal = null;
    unknown.sessions.items[0].outputTotal = null;

    render(<UsageReport report={unknown} />);

    expect(screen.getByTitle("Sat 12:00 UTC: Token count unavailable")).toBeInTheDocument();
    const projectRow = within(sectionByHeading("Projects")).getByText("project").closest("tr");
    expect(projectRow).not.toBeNull();
    expect(within(projectRow as HTMLTableRowElement).getByText("Unknown")).toBeVisible();
    const sessionRow = within(sectionByHeading("Sessions")).getByText("session").closest("tr");
    expect(sessionRow).not.toBeNull();
    expect(within(sessionRow as HTMLTableRowElement).getAllByText("Unknown")).toHaveLength(2);
    expect(within(sessionRow as HTMLTableRowElement).getByText("No estimate")).toBeVisible();
  });

  it("labels plan billing and partial costs instead of inventing dollar amounts", () => {
    const mixed = report();
    const planSession = {
      ...mixed.sessions.items[0],
      sessionId: "plan-session",
      billingMode: "subscription",
      planRecords: 1,
      unpricedRecords: 0,
    };
    const partialSession = {
      ...mixed.sessions.items[0],
      sessionId: "partial-session",
      estimatedCostUsd: 0.3,
      priceVersion: "model-metadata:test",
      recordCount: 3,
      unpricedRecords: 1,
      scope: "task",
    };
    mixed.sessions.items = [planSession, partialSession];
    mixed.sessions.total = 2;
    mixed.totals.estimatedCostUsd = 0.3;
    mixed.totals.costKnownRecords = 2;
    mixed.totals.unpricedRecords = 1;
    mixed.totals.planRecords = 1;
    mixed.totals.recordCount = 4;

    render(<UsageReport report={mixed} />);

    expect(screen.getByText("Cost estimate").parentElement).toHaveTextContent("$0.30");
    expect(screen.getByText("Cost estimate").parentElement).toHaveTextContent(
      "1 record unpriced, 1 record on a plan or local",
    );
    const sessions = sectionByHeading("Sessions");
    const planRow = within(sessions).getByText("plan-session").closest("tr") as HTMLTableRowElement;
    expect(within(planRow).getAllByText("Plan")).toHaveLength(2);
    const partialRow = within(sessions)
      .getByText("partial-session")
      .closest("tr") as HTMLTableRowElement;
    expect(partialRow).toHaveTextContent("$0.30*");
    expect(within(partialRow).getByText("Task")).toBeVisible();
    expect(within(partialRow).getByText("API")).toBeVisible();
  });

  it("exports the selected report and confirms where it was saved", async () => {
    const selected = report();
    const onExport = vi.fn(async (_report: UsageReportData) => "/tmp/usage.csv");
    render(<UsageReport report={selected} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(onExport).toHaveBeenCalledWith(selected);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Saved /tmp/usage.csv"));
  });
});

describe("UsageReportDialog", () => {
  it("offers recorded choices in app selects and applies them", async () => {
    const result = report();
    result.byRuntime = [{ ...result.byProject[0], key: "built-in" }];
    result.byProvider = [{ ...result.byProject[0], key: "openai" }];
    result.byModel = [{ ...result.byProject[0], key: "model" }];
    const query = vi.fn(async (_filter: UsageReportFilter) => result);
    renderDialog(query);
    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("button", { name: "From" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Through" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("All projects");
    await screen.findByRole("button", { name: "project" });
    act(() => useFilesStore.setState({ projects: [project("project", "Research notes")] }));
    await screen.findByRole("button", { name: "Research notes" });

    const user = userEvent.setup();
    await pickOption(user, "Project", "Research notes");
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("Research notes");
    expect(query).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(query.mock.calls.at(-1)?.[0]).toMatchObject({ projectIds: ["project"], page: 0 }),
    );

    await user.click(screen.getByRole("combobox", { name: "Agent" }));
    expect(await screen.findByRole("option", { name: "Oleafly assistant" })).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("combobox", { name: "Provider" }));
    expect(await screen.findByRole("option", { name: "OpenAI" })).toBeVisible();
    await user.keyboard("{Escape}");

    const agents = sectionByHeading("Agents");
    await user.click(within(agents).getByRole("button", { name: "Oleafly assistant" }));
    await waitFor(() =>
      expect(query.mock.calls.at(-1)?.[0]).toMatchObject({
        projectIds: ["project"],
        runtimeIds: ["built-in"],
        page: 0,
      }),
    );
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveTextContent("Oleafly assistant");
  });

  it("applies quick ranges immediately and marks the active one", async () => {
    const query = vi.fn(async (_filter: UsageReportFilter) => report());
    renderDialog(query);
    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    const expected = usageQuickRange("7d");
    await waitFor(() => expect(query.mock.calls.at(-1)?.[0]).toMatchObject(expected));
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "false");
  });

  it("pages sessions with buttons and a page-size select", async () => {
    const result = report();
    result.sessions.total = 30;
    const query = vi.fn(async (_filter: UsageReportFilter) => result);
    renderDialog(query);
    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    expect(await screen.findByText("Page 1 of 2")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(query.mock.calls.at(-1)?.[0]).toMatchObject({ page: 1 }));

    await pickOption(user, "Rows per page", "50");
    await waitFor(() =>
      expect(query.mock.calls.at(-1)?.[0]).toMatchObject({ page: 0, pageSize: 50 }),
    );
  });

  it("shows an empty result", async () => {
    const query = vi.fn(async () => report(0));
    renderDialog(query);
    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    expect(await screen.findByText("No usage was recorded for these filters.")).toBeVisible();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("keeps query failures recoverable", async () => {
    const query = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    renderDialog(query);
    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("database unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  });
});
