import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  UsageReport as UsageReportData,
  UsageReportFilter,
} from "@/lib/usage-report";
import { projectsKey } from "@/lib/queries/projects";

let UsageReport: typeof import("./UsageReport").UsageReport;
let UsageReportDialog: typeof import("./UsageReport").UsageReportDialog;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let within: typeof import("@testing-library/react").within;
let userEvent: typeof import("@testing-library/user-event").default;

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://oleafly.test",
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("HTMLInputElement", dom.window.HTMLInputElement);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("NodeFilter", dom.window.NodeFilter);
  vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
  vi.stubGlobal("MutationObserver", dom.window.MutationObserver);
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(dom.window.HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
  });
  ({ cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ default: userEvent } = await import("@testing-library/user-event"));
  ({ UsageReport, UsageReportDialog } = await import("./UsageReport"));
});

afterEach(() => cleanup());

function page() {
  return within(document.body);
}

function report(recordCount = 1): UsageReportData {
  return {
    startMs: Date.UTC(2026, 7, 1),
    endMs: Date.UTC(2026, 8, 1),
    timezone: "UTC",
    generatedAtMs: Date.UTC(2026, 8, 1),
    totals: {
      recordCount,
      sessionCount: recordCount === 0 ? 0 : 1,
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
              estimatedCostUsd: 0,
              recordCount: 1,
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
              estimatedCostUsd: 0,
              recordCount: 1,
              sessionCount: 1,
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
                estimatedCostUsd: 0,
                priceVersion: "model-metadata:test",
                recordCount: 1,
                status: "completed",
                measurement: "provider_reported",
                billingMode: "api",
              },
            ],
    },
  };
}

function renderDialog(
  query: (filter: UsageReportFilter) => Promise<UsageReportData>,
  projects: Array<{ id: string; name: string }> = [],
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(projectsKey, projects);
  return render(
    <QueryClientProvider client={client}>
      <UsageReportDialog trigger={<button type="button">Open usage</button>} query={query} />
    </QueryClientProvider>,
  );
}

describe("UsageReport", () => {
  it("shows unknown cache and cost states without turning them into zero", () => {
    render(<UsageReport report={report()} />);
    expect(page().getByText("Cache rate").parentElement).toHaveTextContent("Unknown");
    expect(page().getByText("Recorded cost estimate").parentElement).toHaveTextContent("Unknown");
    expect(page().getByRole("img", { name: /daily input and output token trend/iu })).toBeVisible();
    expect(page().getByRole("img", { name: /token activity by UTC weekday and hour/iu })).toBeVisible();
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

    expect(page().getByTitle("Sat 12:00 UTC: Token count unavailable")).toBeVisible();
    const projects = page().getByRole("heading", { name: "Projects" }).closest("section");
    expect(projects).not.toBeNull();
    const projectRow = within(projects as HTMLElement).getByText("project").closest("tr");
    expect(projectRow).not.toBeNull();
    expect(within(projectRow as HTMLTableRowElement).getByText("Unknown")).toBeVisible();
    const sessions = page().getByRole("heading", { name: "Sessions" }).closest("section");
    expect(sessions).not.toBeNull();
    const sessionRow = within(sessions as HTMLElement).getByText("session").closest("tr");
    expect(sessionRow).not.toBeNull();
    expect(within(sessionRow as HTMLTableRowElement).getAllByText("Unknown")).toHaveLength(2);
  });

  it("exports the selected report", () => {
    const onExport = vi.fn();
    const selected = report();
    render(<UsageReport report={selected} onExport={onExport} />);
    fireEvent.click(page().getByRole("button", { name: "Export CSV" }));
    expect(onExport).toHaveBeenCalledWith(selected);
  });
});

describe("UsageReportDialog", () => {
  it("offers friendly recorded choices while keeping exact identifiers", async () => {
    const result = report();
    result.byRuntime = [{ ...result.byProject[0], key: "built-in" }];
    result.byProvider = [{ ...result.byProject[0], key: "openai" }];
    result.byModel = [{ ...result.byProject[0], key: "model" }];
    const query = vi.fn(async (_filter: UsageReportFilter) => result);
    renderDialog(query, [{ id: "project", name: "Research notes" }]);
    fireEvent.click(page().getByRole("button", { name: "Open usage" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));

    expect(page().getByLabelText("From (UTC)")).toBeVisible();
    expect(page().getByLabelText("Through (UTC)")).toBeVisible();
    await page().findByRole("button", { name: "Research notes" });
    expect(page().getByRole("option", { name: "Oleafly assistant" })).toBeVisible();
    expect(page().getByRole("option", { name: "OpenAI" })).toBeVisible();
    expect(page().getByRole("option", { name: "model" })).toBeVisible();
    expect(page().getByRole("option", { name: "session" })).toBeVisible();
    const user = userEvent.setup();
    await user.selectOptions(page().getByLabelText("Choose a recorded project"), "project");
    await waitFor(() =>
      expect(query.mock.calls.at(-1)?.[0]).toMatchObject({
        projectIds: ["project"],
        page: 0,
      }),
    );
    expect(page().getByLabelText("Project")).toHaveValue("project");

    const projectChoice = page().getByRole("button", { name: "Research notes" });
    expect(projectChoice.closest("td")).toHaveAttribute("title", "project");
    await user.click(page().getByRole("button", { name: "Oleafly assistant" }));
    await waitFor(() =>
      expect(query.mock.calls.at(-1)?.[0]).toMatchObject({
        runtimeIds: ["built-in"],
        page: 0,
      }),
    );
  });

  it("applies agent filters and requests the next bounded page", async () => {
    const result = report();
    result.sessions.total = 30;
    const query = vi.fn(async (_filter: UsageReportFilter) => result);
    renderDialog(query);
    fireEvent.click(page().getByRole("button", { name: "Open usage" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    const agentFilter = page().getByLabelText("Agent");
    await user.type(agentFilter, "built-in, acp");
    expect(agentFilter).toHaveValue("built-in, acp");
    await user.click(page().getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(query.mock.calls.at(-1)?.[0]).toMatchObject({
        runtimeIds: ["built-in", "acp"],
        page: 0,
      }),
    );

    await user.click(page().getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(query.mock.calls.at(-1)?.[0]).toMatchObject({
        runtimeIds: ["built-in", "acp"],
        page: 1,
      }),
    );
  });

  it("shows an empty result", async () => {
    const query = vi.fn(async () => report(0));
    renderDialog(query);
    fireEvent.click(page().getByRole("button", { name: "Open usage" }));
    expect(await page().findByText("No usage was recorded for these filters.")).toBeVisible();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("keeps query failures recoverable", async () => {
    const query = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    renderDialog(query);
    fireEvent.click(page().getByRole("button", { name: "Open usage" }));
    expect(await page().findByRole("alert")).toHaveTextContent("database unavailable");
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  });
});
