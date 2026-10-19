// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { RunRecord, TaskProgress } from "@/lib/research-tasks";
import { researchTaskFixture } from "../tests/task-fixtures";

const api = vi.hoisted(() => ({
  progressResearchTask: vi.fn(),
  cancelResearchTaskRun: vi.fn(),
  researchTaskRunLog: vi.fn(),
}));

vi.mock("@/lib/research-tasks", () => api);

import { Sparkline } from "./Sparkline";
import { TaskProgressTab } from "./TaskProgressTab";

const copy = enResearchTools.tasks.progress;
const POLL_MS = 3_000;

function run(runId: string, patch: Partial<RunRecord> = {}): RunRecord {
  return {
    taskId: "task-1",
    runId,
    executionGeneration: 1,
    name: `run ${runId}`,
    executor: "local",
    command: "python train.py",
    cwdRel: "",
    state: "succeeded",
    exitCode: 0,
    startedAt: Date.now() - 5 * 60_000,
    finishedAt: null,
    runDir: `/tasks/runs/task-1/${runId}`,
    metrics: {},
    reported: true,
    ...patch,
  };
}

function ledgerRow(id: string, verdict: string, metrics: Record<string, number>) {
  return {
    id,
    time: "2026-10-19T08:00:00Z",
    hypothesis: `Hypothesis ${id}`,
    change: `Change ${id}`,
    command: "python train.py",
    metrics,
    verdict,
    notes: "",
  };
}

function progress(patch: Partial<TaskProgress> = {}): TaskProgress {
  const inFlight = run("r003", { name: "wider model", state: "running", exitCode: null });
  return {
    phase: "waiting_runs",
    plan: [
      { text: "Measure the baseline", done: true },
      { text: "Try dropout 0.1", done: false },
    ],
    todos: [
      { id: "t1", content: "Compare seeds", status: "in_progress" },
      { id: "t2", content: "Write the report", status: "pending" },
      { id: "t3", content: "Plot the curves", status: "completed" },
      { id: "t4", content: "Drop the old idea", status: "cancelled" },
    ],
    ledger: [
      ledgerRow("r001", "keep", { val_loss: 0.5, acc: 0.913 }),
      ledgerRow("r002", "Discard ", { val_loss: 0.61 }),
      ledgerRow("r004", "crash", {}),
      ledgerRow("n001", "later", { steps: 1234.5678 }),
    ],
    best: { name: "val_loss", value: 0.5, runId: "r001", series: [0.7, 0.61, 0.5] },
    runsInFlight: [inFlight],
    recentRuns: [
      run("r001", { metrics: { val_loss: 0.5, steps: 1200 } }),
      run("r002", { state: "failed", exitCode: 1 }),
      inFlight,
    ],
    budget: { activeMinutes: 45.4, limitMinutes: 120, spentUsd: 1.5, usdCap: 5, runsStarted: 3, maxRuns: 10 },
    evidence: null,
    recordDir: "research/ablation-1a2b",
    ...patch,
  };
}

const running = () => researchTaskFixture({ id: "task-1", status: "running", executionGeneration: 1 });

async function shown() {
  return screen.findByTestId("research-task-progress");
}

/** Captures the progress poll instead of waiting three seconds for it. */
function capturePolls() {
  const polls: Array<() => void> = [];
  const realSet = window.setInterval.bind(window);
  const realClear = window.clearInterval.bind(window);
  const cleared: number[] = [];
  vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler, timeout?: number, ...rest: unknown[]) => {
    if (timeout === POLL_MS && typeof handler === "function") {
      polls.push(handler as () => void);
      return 90_000 + polls.length;
    }
    return realSet(handler, timeout, ...rest);
  }) as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation(((handle?: number) => {
    if (handle !== undefined && handle > 90_000) cleared.push(handle);
    else realClear(handle);
  }) as typeof window.clearInterval);
  return { polls, cleared };
}

describe("TaskProgressTab", () => {
  beforeEach(() => {
    api.progressResearchTask.mockReset().mockResolvedValue(progress());
    api.cancelResearchTaskRun.mockReset().mockResolvedValue(undefined);
    api.researchTaskRunLog.mockReset().mockResolvedValue("step 10 loss=0.4\nstep 20 loss=0.3");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("the progress tab shows ledger rows, runs in flight, budget and a sparkline", async () => {
    render(<TaskProgressTab task={running()} />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.loading);
    const tab = await shown();
    expect(api.progressResearchTask).toHaveBeenCalledWith("task-1");

    expect(within(tab).getByRole("heading", { name: "Best val_loss" })).toBeInTheDocument();
    expect(within(tab).getByText("0.5 in run r001")).toBeInTheDocument();
    const sparkline = within(tab).getByRole("img", { name: "Best val_loss" });
    expect(sparkline).toHaveAttribute("data-testid", "research-sparkline");

    expect(within(tab).getByText("45 minutes of 2 hours")).toBeInTheDocument();
    expect(within(tab).getByText("$1.50 of $5.00")).toBeInTheDocument();
    expect(within(tab).getByText("3 of 10 runs")).toBeInTheDocument();

    const live = within(tab).getByText("wider model").closest("li") as HTMLElement;
    expect(live).toHaveTextContent("r003");
    expect(live).toHaveTextContent(enResearchTools.runs.status.running);
    expect(within(live).getByRole("button", { name: copy.stopRun })).toBeEnabled();

    const recent = within(tab).getByText("run r001").closest("li") as HTMLElement;
    expect(recent).toHaveTextContent(enResearchTools.runs.status.succeeded);
    expect(recent).toHaveTextContent("val_loss=0.5, steps=1200");
    expect(within(tab).getByText("run r002").closest("li")).toHaveTextContent(enResearchTools.runs.status.failed);
    expect(within(tab).getAllByText("wider model")).toHaveLength(1);

    expect(within(tab).getByText("Measure the baseline")).toHaveClass("line-through");
    expect(within(tab).getByText("Try dropout 0.1")).not.toHaveClass("line-through");
    expect(within(tab).getByText("Compare seeds")).toBeInTheDocument();
    expect(within(tab).getByText("Write the report")).toBeInTheDocument();
    expect(within(tab).getByText("Plot the curves")).toBeInTheDocument();
    expect(within(tab).getByText("Drop the old idea")).toHaveClass("line-through");

    const table = within(tab).getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual([
      copy.columns.run,
      copy.columns.time,
      copy.columns.hypothesis,
      copy.columns.change,
      copy.columns.metrics,
      copy.columns.verdict,
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("r001");
    expect(rows[0]).toHaveTextContent("Hypothesis r001");
    expect(rows[0]).toHaveTextContent("Change r001");
    expect(rows[0]).toHaveTextContent("val_loss=0.5, acc=0.913");
    expect(rows[0]).toHaveTextContent(copy.verdict.keep);
    expect(rows[1]).toHaveTextContent(copy.verdict.discard);
    expect(rows[2]).toHaveTextContent(copy.verdict.crash);
    expect(rows[3]).toHaveTextContent("steps=1235");
    expect(rows[3]).toHaveTextContent("later");
  });

  it("shows the quiet states when nothing has happened yet", async () => {
    api.progressResearchTask.mockResolvedValue(
      progress({
        plan: [],
        todos: [],
        ledger: [],
        best: null,
        runsInFlight: [],
        recentRuns: [],
        budget: { activeMinutes: 0, limitMinutes: 90, spentUsd: null, usdCap: null, runsStarted: 0, maxRuns: null },
      }),
    );
    render(<TaskProgressTab task={running()} />);
    const tab = await shown();

    expect(within(tab).queryByRole("img")).toBeNull();
    expect(within(tab).getByText(copy.noRuns)).toBeInTheDocument();
    expect(within(tab).getByText(copy.noPlan)).toBeInTheDocument();
    expect(within(tab).getByText(copy.noLedger)).toBeInTheDocument();
    expect(within(tab).getByText(copy.costUnknown)).toBeInTheDocument();
    expect(within(tab).getByText("0 runs")).toBeInTheDocument();
    expect(within(tab).getByText("0 minutes of 90 minutes")).toBeInTheDocument();
    expect(within(tab).queryByRole("table")).toBeNull();
    expect(within(tab).queryAllByRole("button")).toHaveLength(0);
  });

  it("shows spend without a limit and rounds larger amounts", async () => {
    api.progressResearchTask.mockResolvedValue(
      progress({
        budget: { activeMinutes: 61, limitMinutes: 1440, spentUsd: 12.4, usdCap: null, runsStarted: 1, maxRuns: null },
      }),
    );
    const view = render(<TaskProgressTab task={running()} />);
    const tab = await shown();
    expect(within(tab).getByText("$12 spent")).toBeInTheDocument();
    expect(within(tab).getByText("61 minutes of 24 hours")).toBeInTheDocument();
    expect(within(tab).getByText("1 runs")).toBeInTheDocument();

    api.progressResearchTask.mockResolvedValue(
      progress({
        budget: { activeMinutes: 120, limitMinutes: 120, spentUsd: 25, usdCap: 20, runsStarted: 2, maxRuns: 2 },
      }),
    );
    view.rerender(<TaskProgressTab task={{ ...running(), updatedAt: 2 }} />);
    expect(await within(tab).findByText("$25 of $20")).toBeInTheDocument();
    expect(within(tab).getByText("2 hours of 2 hours")).toBeInTheDocument();
    expect(api.progressResearchTask).toHaveBeenCalledTimes(2);
  });

  it("does not list the in-flight runs again under recent runs", async () => {
    const inFlight = run("r003", { name: "wider model", state: "running" });
    api.progressResearchTask.mockResolvedValue(progress({ runsInFlight: [inFlight], recentRuns: [inFlight] }));
    render(<TaskProgressTab task={running()} />);
    const tab = await shown();

    expect(within(tab).getAllByText("wider model")).toHaveLength(1);
    expect(within(tab).getAllByRole("button", { name: copy.viewLog })).toHaveLength(1);
  });

  it("opens a run's log and says why a log could not be read", async () => {
    render(<TaskProgressTab task={running()} />);
    const tab = await shown();

    const recent = within(tab).getByText("run r001").closest("li") as HTMLElement;
    await userEvent.click(within(recent).getByRole("button", { name: copy.viewLog }));
    const log = await within(tab).findByLabelText("r001");
    expect(log).toHaveTextContent("step 10 loss=0.4");
    expect(api.researchTaskRunLog).toHaveBeenCalledWith("task-1", "r001");

    api.researchTaskRunLog.mockRejectedValueOnce(new Error("The run's log is gone."));
    const live = within(tab).getByText("wider model").closest("li") as HTMLElement;
    await userEvent.click(within(live).getByRole("button", { name: copy.viewLog }));
    expect(await within(tab).findByRole("alert")).toHaveTextContent("The run's log is gone.");
    expect(within(tab).getByLabelText("r001")).toBeInTheDocument();

    api.researchTaskRunLog.mockRejectedValueOnce("The supervisor is not answering.");
    await userEvent.click(within(live).getByRole("button", { name: copy.viewLog }));
    expect(await within(tab).findByText("The supervisor is not answering.")).toBeInTheDocument();
  });

  it("stops a run and reloads the progress", async () => {
    let finish!: () => void;
    api.cancelResearchTaskRun.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<TaskProgressTab task={running()} />);
    const tab = await shown();
    const live = within(tab).getByText("wider model").closest("li") as HTMLElement;

    await userEvent.click(within(live).getByRole("button", { name: copy.stopRun }));
    expect(api.cancelResearchTaskRun).toHaveBeenCalledWith("task-1", "r003");
    expect(within(live).getByRole("button", { name: copy.stopRun })).toBeDisabled();
    await act(async () => finish());

    await waitFor(() => expect(api.progressResearchTask).toHaveBeenCalledTimes(2));
    expect(within(tab).getByRole("button", { name: copy.stopRun })).toBeEnabled();
  });

  it("says why a run could not be stopped", async () => {
    api.cancelResearchTaskRun.mockRejectedValue("The run already finished.");
    render(<TaskProgressTab task={running()} />);
    const tab = await shown();
    const live = within(tab).getByText("wider model").closest("li") as HTMLElement;

    await userEvent.click(within(live).getByRole("button", { name: copy.stopRun }));

    expect(await within(tab).findByRole("alert")).toHaveTextContent("The run already finished.");
    expect(api.progressResearchTask).toHaveBeenCalledOnce();
    expect(within(live).getByRole("button", { name: copy.stopRun })).toBeEnabled();
  });

  it("shows a load failure in place of the board", async () => {
    api.progressResearchTask.mockRejectedValue(new Error("The task store is busy."));
    const view = render(<TaskProgressTab task={running()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The task store is busy.");
    expect(screen.queryByTestId("research-task-progress")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    api.progressResearchTask.mockRejectedValue("offline");
    view.rerender(<TaskProgressTab task={{ ...running(), updatedAt: 3 }} />);
    expect(await screen.findByText("offline")).toBeInTheDocument();
  });

  it("keeps the last board when a refresh fails and clears the error once one works", async () => {
    const view = render(<TaskProgressTab task={running()} />);
    const tab = await shown();

    api.progressResearchTask.mockRejectedValueOnce(new Error("Try again in a moment."));
    view.rerender(<TaskProgressTab task={{ ...running(), updatedAt: 2 }} />);
    expect(await within(tab).findByRole("alert")).toHaveTextContent("Try again in a moment.");
    expect(within(tab).getByText("3 of 10 runs")).toBeInTheDocument();

    view.rerender(<TaskProgressTab task={{ ...running(), updatedAt: 3 }} />);
    await waitFor(() => expect(within(tab).queryByRole("alert")).toBeNull());
  });

  it("polls every three seconds while the task runs and the window is visible", async () => {
    const { polls, cleared } = capturePolls();
    const view = render(<TaskProgressTab task={running()} />);
    await shown();
    expect(polls).toHaveLength(1);

    await act(async () => polls[0]());
    expect(api.progressResearchTask).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => polls[0]());
    expect(api.progressResearchTask).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(cleared).toEqual([90_001]);
  });

  it("does not poll a task that is not running", async () => {
    const { polls } = capturePolls();
    const view = render(<TaskProgressTab task={{ ...running(), status: "awaiting_review" }} />);
    await shown();
    expect(polls).toHaveLength(0);

    view.rerender(<TaskProgressTab task={{ ...running(), status: "running", updatedAt: 2 }} />);
    await waitFor(() => expect(polls).toHaveLength(1));
  });

  it("stops polling once the task leaves the running state", async () => {
    const { polls, cleared } = capturePolls();
    const view = render(<TaskProgressTab task={running()} />);
    await shown();
    expect(polls).toHaveLength(1);

    view.rerender(<TaskProgressTab task={{ ...running(), status: "awaiting_review", updatedAt: 2 }} />);
    await waitFor(() => expect(cleared).toEqual([90_001]));
    expect(polls).toHaveLength(1);
  });
});

describe("Sparkline", () => {
  it("draws the values as a line scaled to its box", () => {
    render(<Sparkline values={[1, 3, 2]} label={"Best acc"} className="text-primary" />);
    const svg = screen.getByRole("img", { name: "Best acc" });
    expect(svg).toHaveAttribute("width", "120");
    expect(svg).toHaveAttribute("height", "28");
    expect(svg).toHaveAttribute("viewBox", "0 0 120 28");
    expect(svg).toHaveClass("text-primary");
    expect(svg.querySelector("polyline")).toHaveAttribute("points", "0.0,26.0 60.0,2.0 120.0,14.0");
    expect(svg.querySelector("polyline")).toHaveAttribute("stroke", "currentColor");
  });

  it("keeps a flat series on one line and skips values that are not numbers", () => {
    render(<Sparkline values={[2, Number.NaN, 2, Number.POSITIVE_INFINITY]} width={40} height={10} label={"Flat"} />);
    const svg = screen.getByRole("img", { name: "Flat" });
    expect(svg.querySelector("polyline")).toHaveAttribute("points", "0.0,8.0 40.0,8.0");
  });

  it("draws nothing for fewer than two values", () => {
    const { container, rerender } = render(<Sparkline values={[0.5]} label={"One"} />);
    expect(container.innerHTML).toBe("");
    rerender(<Sparkline values={[Number.NaN, 1]} label={"One"} />);
    expect(container.innerHTML).toBe("");
  });
});
