// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { useHomeViewStore } from "@/store/home-view";

const mocks = vi.hoisted(() => ({
  statsPValue: vi.fn(),
  statsSampleSize: vi.fn(),
  statsConfidenceInterval: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  statsPValue: mocks.statsPValue,
  statsSampleSize: mocks.statsSampleSize,
  statsConfidenceInterval: mocks.statsConfidenceInterval,
}));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => <div /> }));

import { StatsToolView } from "./StatsToolView";

const copy = researchTools.stats;
let writeText: ReturnType<typeof vi.fn>;

function copiedLines(): string[] {
  return String(writeText.mock.calls.at(-1)?.[0] ?? "").split("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  useHomeViewStore.setState({ page: "stats" });
});

describe("p-value calculator", () => {
  it.each([
    [0.0004, "p < .001"],
    [0.004, "p < .01"],
    [0.04, "p < .05"],
    [0.07, "p < .10"],
    [0.4, copy.notSignificant],
  ])("describes p = %s as %s", async (p, verdict) => {
    mocks.statsPValue.mockResolvedValue({ p, label: "Two-tailed t-test (28 df)" });
    render(<StatsToolView />);

    fireEvent.click(screen.getByTestId("stats-p-run"));

    await vi.waitFor(() => expect(screen.getByTestId("stats-p-result")).toHaveTextContent(verdict));
  });

  it.each([
    ["t-one", copy.testTOne.replace("{{df}}", "28"), "One-tailed t-test, upper tail (28 df)", true],
    ["z-two", copy.testZTwo, "Two-tailed z-test", false],
    ["z-one", copy.testZOne, "One-tailed z-test (upper tail)", false],
    ["chi", copy.testChi.replace("{{df}}", "28"), "Chi-square, upper tail (28 df)", true],
  ])("labels the %s test and asks for degrees of freedom only when needed", async (test, label, backendLabel, needsDf) => {
    mocks.statsPValue.mockResolvedValue({ p: 0.03, label: backendLabel });
    render(<StatsToolView />);

    fireEvent.change(screen.getByTestId("stats-p-test"), { target: { value: test } });
    expect(Boolean(screen.queryByLabelText(copy.degreesFreedom))).toBe(needsDf);
    fireEvent.click(screen.getByTestId("stats-p-run"));

    await vi.waitFor(() => expect(screen.getByTestId("stats-p-result")).toHaveTextContent(label));
    expect(mocks.statsPValue).toHaveBeenCalledWith(test, 2.34, needsDf ? 28 : undefined);

    fireEvent.click(screen.getByRole("button", { name: copy.copyResult }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(copiedLines().some((line) => line.startsWith("Degrees of freedom"))).toBe(needsDf);
  });

  it("loads the z-test example and shows a backend label that differs from the expected one", async () => {
    mocks.statsPValue.mockResolvedValue({ p: 0.05, label: "Custom test label" });
    render(<StatsToolView />);

    fireEvent.click(screen.getByRole("button", { name: copy.exampleZTest }));
    expect(screen.getByLabelText(copy.statistic)).toHaveValue("1.96");
    expect(screen.queryByLabelText(copy.degreesFreedom)).toBeNull();
    fireEvent.click(screen.getByTestId("stats-p-run"));

    await vi.waitFor(() => expect(screen.getByTestId("stats-p-result")).toHaveTextContent("Custom test label"));

    fireEvent.click(screen.getByRole("button", { name: copy.exampleTTest }));
    expect(screen.getByLabelText(copy.degreesFreedom)).toHaveValue("28");
    expect(screen.getByTestId("stats-p-result")).toHaveTextContent(copy.pValueEmpty);
  });
});

describe("sample size calculator", () => {
  function openSampleSize() {
    render(<StatsToolView />);
    fireEvent.click(screen.getByTestId("stats-tab-sample-size"));
  }

  it("estimates an open-population sample and copies it", async () => {
    mocks.statsSampleSize.mockResolvedValue({ z: 1.959964, infinitePopulation: 385, finitePopulation: null });
    openSampleSize();

    fireEvent.click(screen.getByTestId("stats-n-run"));

    await vi.waitFor(() => expect(screen.getByTestId("stats-n-result")).toHaveTextContent("385"));
    expect(mocks.statsSampleSize).toHaveBeenCalledWith(50, 5, 95, undefined);
    expect(screen.getByTestId("stats-n-result")).toHaveTextContent("1.960");
    expect(screen.getByTestId("stats-n-result")).not.toHaveTextContent(copy.finitePopulation);

    fireEvent.click(screen.getByRole("button", { name: copy.copyResult }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(copiedLines()).toEqual([
      copy.sampleSizeTitle,
      "Expected proportion: 50%",
      "Margin of error: 5%",
      "Confidence: 95%",
      "Critical z: 1.960",
      "Open population sample: 385",
    ]);
  });

  it("corrects for a finite population from the example", async () => {
    mocks.statsSampleSize.mockResolvedValue({ z: 1.96, infinitePopulation: 385, finitePopulation: 278 });
    openSampleSize();

    fireEvent.click(screen.getByRole("button", { name: copy.populationExample }));
    expect(screen.getByLabelText(copy.populationSizeOptional)).toHaveValue("1000");
    fireEvent.change(screen.getByLabelText(copy.expectedProportion), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText(copy.marginOfErrorPercent), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(copy.confidencePercent), { target: { value: "99" } });
    fireEvent.click(screen.getByTestId("stats-n-run"));

    await vi.waitFor(() => expect(screen.getByTestId("stats-n-result")).toHaveTextContent(copy.finitePopulation));
    expect(mocks.statsSampleSize).toHaveBeenCalledWith(40, 4, 99, 1000);
    expect(screen.getByTestId("stats-n-result")).toHaveTextContent("278");

    fireEvent.click(screen.getByRole("button", { name: copy.copyResult }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(copiedLines()).toContain("Population size: 1000");
    expect(copiedLines()).toContain("Finite population sample: 278");

    fireEvent.click(screen.getByRole("button", { name: copy.openPopulation }));
    expect(screen.getByLabelText(copy.populationSizeOptional)).toHaveValue("");
    expect(screen.getByTestId("stats-n-result")).toHaveTextContent(copy.sampleSizeEmpty);
  });
});

describe("confidence interval calculator", () => {
  it("computes and copies a t interval for a mean", async () => {
    mocks.statsConfidenceInterval.mockResolvedValue({
      pointEstimate: 100,
      lower: 88.47,
      upper: 111.53,
      standardError: 5,
      marginOfError: 11.53,
      criticalValue: 2.306,
      criticalLabel: "t",
      intervalMethod: "t interval",
    });
    render(<StatsToolView />);
    fireEvent.click(screen.getByTestId("stats-tab-confidence-interval"));

    fireEvent.change(screen.getByLabelText(copy.sampleMean), { target: { value: "101" } });
    fireEvent.change(screen.getByLabelText(copy.sampleSd), { target: { value: "14" } });
    fireEvent.click(screen.getByTestId("stats-ci-run"));

    await vi.waitFor(() => expect(screen.getByTestId("stats-ci-result")).toHaveTextContent("[88.47, 111.5]"));
    expect(mocks.statsConfidenceInterval).toHaveBeenCalledWith("mean", 95, { mean: 101, sd: 14, n: 9, successes: undefined });
    expect(screen.getByTestId("stats-ci-result")).toHaveTextContent(copy.meanIntervalMethod);
    expect(screen.getByTestId("stats-ci-result")).toHaveTextContent(copy.marginOfError);

    fireEvent.click(screen.getByRole("button", { name: copy.copyResult }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(copiedLines()).toEqual(
      expect.arrayContaining([
        "Method: t interval for a mean",
        "Sample mean: 101",
        "Sample standard deviation: 14",
        "Sample size: 9",
        "Margin of error: 11.53",
        "Critical t: 2.3060",
      ]),
    );
  });

  it("switches between the mean and proportion examples", () => {
    render(<StatsToolView />);
    fireEvent.click(screen.getByTestId("stats-tab-confidence-interval"));

    fireEvent.click(screen.getByRole("button", { name: copy.zeroOfTen }));
    expect(screen.getByLabelText(copy.successes)).toHaveValue("0");
    expect(screen.queryByLabelText(copy.sampleMean)).toBeNull();

    const examples = screen.getAllByRole("button", { name: copy.mean });
    fireEvent.click(examples[examples.length - 1]);
    expect(screen.getByLabelText(copy.sampleMean)).toHaveValue("100");
    fireEvent.change(screen.getByLabelText(copy.sampleSizeTitle), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(copy.confidencePercent), { target: { value: "90" } });
    expect(screen.getByLabelText(copy.sampleSizeTitle)).toHaveValue("30");
  });

  it("copies the successes of a proportion interval", async () => {
    mocks.statsConfidenceInterval.mockResolvedValue({
      pointEstimate: 0.3,
      lower: 0.1,
      upper: 0.6,
      standardError: 0.14,
      marginOfError: 0.25,
      criticalValue: 1.96,
      criticalLabel: "z",
      intervalMethod: "Wilson",
    });
    render(<StatsToolView />);
    fireEvent.click(screen.getByTestId("stats-tab-confidence-interval"));
    fireEvent.click(screen.getByTestId("stats-ci-mode-proportion"));
    fireEvent.change(screen.getByLabelText(copy.successes), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("stats-ci-run"));

    await vi.waitFor(() => expect(screen.getByRole("button", { name: copy.copyResult })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: copy.copyResult }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(copiedLines()).toContain("Successes: 3");
    expect(copiedLines()).toContain("Wilson half-width: 0.2500");
  });
});

describe("stats page visibility", () => {
  it("renders nothing on another home page", () => {
    useHomeViewStore.setState({ page: "library" });

    const { container } = render(<StatsToolView />);

    expect(container).toBeEmptyDOMElement();
  });
});
