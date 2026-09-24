// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeViewStore } from "@/store/home-view";

const mocks = vi.hoisted(() => ({
  statsPValue: vi.fn(),
  statsSampleSize: vi.fn(),
  statsConfidenceInterval: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  statsPValue: mocks.statsPValue,
  statsSampleSize: mocks.statsSampleSize,
  statsConfidenceInterval: mocks.statsConfidenceInterval,
}));

vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => <div /> }));

import { StatsToolView } from "./StatsToolView";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  useHomeViewStore.setState({ page: "stats" });
});

describe("StatsToolView", () => {
  it("discards a result after its inputs change", async () => {
    const pending = deferred<{ p: number; label: string }>();
    mocks.statsPValue.mockReturnValue(pending.promise);
    render(<StatsToolView />);

    fireEvent.click(screen.getByTestId("stats-p-run"));
    fireEvent.change(screen.getByLabelText("Statistic"), { target: { value: "3" } });
    await act(async () => {
      pending.resolve({ p: 0.02, label: "Two-tailed z-test" });
      await pending.promise;
    });

    expect(screen.getByTestId("stats-p-result")).toHaveTextContent("Enter a test statistic, then compute its p-value.");
  });

  it("re-enables Compute after invalidating a pending calculation", async () => {
    const first = deferred<{ p: number; label: string }>();
    const second = deferred<{ p: number; label: string }>();
    mocks.statsPValue.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<StatsToolView />);

    const compute = screen.getByTestId("stats-p-run");
    fireEvent.click(compute);
    expect(compute).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Statistic"), { target: { value: "3" } });
    expect(compute).toBeEnabled();
    fireEvent.click(compute);

    await act(async () => {
      first.resolve({ p: 0.2, label: "Old result" });
      second.resolve({ p: 0.01, label: "New result" });
      await Promise.all([first.promise, second.promise]);
    });
    expect(screen.getByTestId("stats-p-result")).toHaveTextContent("New result");
    expect(compute).toBeEnabled();
  });

  it("keeps invalid backend input out of the result panel and explains the error there, not in a toast", async () => {
    const invalid = new Error("the test statistic must be a number");
    mocks.statsPValue.mockRejectedValue(invalid);
    render(<StatsToolView />);

    fireEvent.change(screen.getByLabelText("Statistic"), { target: { value: "not a number" } });
    fireEvent.click(screen.getByTestId("stats-p-run"));

    await waitFor(() => expect(screen.getByTestId("stats-p-result")).toHaveTextContent("Couldn't calculate this result"));
    expect(screen.getByTestId("stats-p-result")).toHaveTextContent("the test statistic must be a number");
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith("p-value", invalid);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("stats-p-run")).toBeEnabled();
  });

  it("shows the reason of a rejected backend string in the result panel", async () => {
    mocks.statsPValue.mockRejectedValue("enter degrees of freedom greater than zero");
    render(<StatsToolView />);

    fireEvent.click(screen.getByTestId("stats-p-run"));

    await waitFor(() =>
      expect(screen.getByTestId("stats-p-result")).toHaveTextContent("enter degrees of freedom greater than zero"),
    );
    expect(screen.getByTestId("stats-p-result")).not.toHaveTextContent("Check the values and try again.");
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("falls back to the catalog hint when the failure carries no reason", async () => {
    mocks.statsPValue.mockRejectedValue({ code: 7 });
    render(<StatsToolView />);

    fireEvent.click(screen.getByTestId("stats-p-run"));

    await waitFor(() =>
      expect(screen.getByTestId("stats-p-result")).toHaveTextContent("Check the values and try again."),
    );
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith("p-value", { code: 7 });
  });

  it("labels the Wilson interval half-width without relabeling it as a symmetric error", async () => {
    mocks.statsConfidenceInterval.mockResolvedValue({
      pointEstimate: 0,
      lower: 0,
      upper: 0.2775,
      standardError: 0,
      marginOfError: 0.1388,
      criticalValue: 1.96,
      criticalLabel: "z",
      intervalMethod: "Wilson score interval for a proportion",
    });
    render(<StatsToolView />);

    fireEvent.click(screen.getByTestId("stats-tab-confidence-interval"));
    fireEvent.click(screen.getByTestId("stats-ci-mode-proportion"));
    fireEvent.change(screen.getByLabelText("Successes"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Sample size"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("stats-ci-run"));

    await vi.waitFor(() => expect(screen.getByTestId("stats-ci-result")).toHaveTextContent("Wilson half-width"));
    expect(screen.getByTestId("stats-ci-result")).toHaveTextContent("Wilson score interval for a proportion");
  });

  it("copies a labeled p-value report", async () => {
    mocks.statsPValue.mockResolvedValue({ p: 0.02664, label: "Two-tailed t-test (28 df)" });
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<StatsToolView />);

    fireEvent.click(screen.getByTestId("stats-p-run"));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Copy result" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Copy result" }));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Test: Two-tailed t-test (28 df)")));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Statistic: 2.34"));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Copied result");
  });

  it("reports a clipboard error in the catalog text and logs the raw error", async () => {
    mocks.statsPValue.mockResolvedValue({ p: 0.02664, label: "Two-tailed t-test (28 df)" });
    const denied = new Error("clipboard denied");
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(denied);
    render(<StatsToolView />);

    fireEvent.click(screen.getByTestId("stats-p-run"));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Copy result" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Copy result" }));

    await vi.waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledExactlyOnceWith("stats copy result", denied, "Couldn't copy result"),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
