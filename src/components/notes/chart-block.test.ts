// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { newChartSource } from "./block-templates";
import {
  chartBlock,
  chartLegend,
  checkChart,
  formatCount,
  formatTick,
  histogramBins,
  paintChart,
  seriesColor,
} from "./chart-block";
import "./tests/setup";

const VALID = {
  title: "Validation",
  unit: "%",
  categories: ["Run 1", "Run 2"],
  series: [
    { name: "A", values: [61.2, 64.1] },
    { name: "B", values: [58, 60] },
  ],
};

function paint(data: unknown, still = false): HTMLElement {
  const preview = document.createElement("div");
  paintChart(preview, JSON.stringify(data), { still });
  return preview;
}

function texts(root: ParentNode, selector: string): (string | null)[] {
  return [...root.querySelectorAll(selector)].map((node) => node.textContent);
}

function openData(preview: HTMLElement): HTMLTableElement {
  (preview.querySelector(".note-chart-data-toggle") as HTMLButtonElement).click();
  return preview.querySelector("table") as HTMLTableElement;
}

function tableRows(table: HTMLTableElement): string[][] {
  return [...table.querySelectorAll("tr")].map((row) => [...row.children].map((cell) => cell.textContent ?? ""));
}

const BAR = { categories: ["a"], series: [{ name: "A", values: [1] }] };

describe("chart data", () => {
  it("reads valid chart data", () => {
    expect(checkChart(JSON.stringify(VALID))).toEqual({ ok: true, chart: VALID });
  });

  it.each([
    ["not JSON", "{"],
    ["no categories", JSON.stringify({ ...VALID, categories: [] })],
    ["no series", JSON.stringify({ ...VALID, series: [] })],
    ["a value that is not a number", JSON.stringify({ ...VALID, series: [{ name: "A", values: ["1", 2] }] })],
    ["a value that is not finite", '{"categories":["a"],"series":[{"name":"A","values":[1e999]}]}'],
    ["fewer values than categories", JSON.stringify({ ...VALID, series: [{ name: "A", values: [1] }] })],
    ["a title that is not text", JSON.stringify({ ...VALID, title: 3 })],
    ["an array", "[]"],
    ["null", "null"],
    ["a number", "3"],
    ["a category that is not text", JSON.stringify({ ...VALID, categories: ["Run 1", 2] })],
    ["a series that is not an object", JSON.stringify({ ...VALID, series: ["A"] })],
    ["a series without a name", JSON.stringify({ ...VALID, series: [{ values: [1, 2] }] })],
    ["a unit that is not text", JSON.stringify({ ...VALID, unit: 1 })],
  ])("rejects %s", (_name, source) => {
    expect(checkChart(source).ok).toBe(false);
  });

  const scatter = (points: unknown, extra: object = {}) => ({
    type: "scatter",
    series: [{ name: "A", points, ...extra }],
  });
  const histogram = (values: unknown, extra: object = {}) => ({
    type: "histogram",
    series: [{ name: "A", values, ...extra }],
  });

  it.each([
    ["an unknown type", { ...BAR, type: "radar" }, "type"],
    ["a type that is not text", { ...BAR, type: 3 }, "type"],
    ["an unknown scale", { ...BAR, yScale: "ln" }, "invalid"],
    ["stacked that is not true or false", { ...BAR, stacked: "yes" }, "invalid"],
    ["an axis title that is not text", { ...BAR, xLabel: 1 }, "invalid"],
    ["a histogram without bins", histogram([1], {}), null],
    ["bins below one", { ...histogram([1]), bins: 0 }, "bins"],
    ["too many bins", { ...histogram([1]), bins: 101 }, "bins"],
    ["fractional bins", { ...histogram([1]), bins: 2.5 }, "bins"],
    ["a series that is null", { categories: ["a"], series: [null] }, "invalid"],
    [
      "nine series",
      { categories: ["a"], series: Array.from({ length: 9 }, (_value, index) => ({ name: `${index}`, values: [1] })) },
      "tooManySeries",
    ],
    ["a log pie", { type: "pie", yScale: "log", ...BAR }, "logType"],
    ["a log histogram", { ...histogram([1]), yScale: "log" }, "logType"],
    ["a log bar with zero", { ...BAR, yScale: "log", series: [{ name: "A", values: [0] }] }, "log"],
    ["errors of the wrong length", { ...BAR, series: [{ name: "A", values: [1], errors: [1, 2] }] }, "errors"],
    ["a negative error", { ...BAR, series: [{ name: "A", values: [1], errors: [-1] }] }, "errors"],
    ["an error that is not a number", { ...BAR, series: [{ name: "A", values: [1], errors: ["1"] }] }, "errors"],
    ["errors on a pie", { type: "pie", categories: ["a"], series: [{ name: "A", values: [1], errors: [1] }] }, "errorsType"],
    ["a negative slice", { type: "donut", categories: ["a", "b"], series: [{ name: "A", values: [2, -1] }] }, "pie"],
    ["an empty pie", { type: "pie", categories: ["a"], series: [{ name: "A", values: [0] }] }, "pie"],
    [
      "too many bars",
      { categories: Array.from({ length: 5001 }, (_value, index) => `${index}`), series: [{ name: "A", values: Array(5001).fill(1) }] },
      "tooManyPoints",
    ],
    ["a scatter series without points", { type: "scatter", series: [{ name: "A", values: [1] }] }, "points"],
    ["a scatter series with no points", scatter([]), "points"],
    ["a point with one number", scatter([[1]]), "points"],
    ["a point with four numbers", scatter([[1, 2, 3, 4]]), "points"],
    ["a point with text", scatter([[1, "2"]]), "points"],
    ["a point with a negative error", scatter([[1, 2, -1]]), "points"],
    ["scatter errors of the wrong length", scatter([[1, 2]], { errors: [1, 2] }), "errors"],
    ["a log scatter at zero", { ...scatter([[1, 0]]), yScale: "log" }, "log"],
    ["too many points", scatter(Array.from({ length: 5001 }, (_value, index) => [index, 1])), "tooManyPoints"],
    ["histogram errors", histogram([1], { errors: [1] }), "errorsType"],
    ["histogram text", histogram(["1"]), "invalid"],
    ["an empty histogram", histogram([]), "samples"],
    ["too many samples", histogram(Array(100_001).fill(1)), "tooManyPoints"],
  ])("checks %s", (_name, data, problem) => {
    const result = checkChart(JSON.stringify(data));
    expect(result.ok ? null : result.problem).toBe(problem);
  });

  it.each([
    ["a line with log scale", { ...VALID, type: "line", yScale: "log" }],
    ["a stacked area", { ...VALID, type: "area", stacked: true, yScale: "linear" }],
    ["a scatter that ignores categories", { type: "scatter", categories: [1], series: [{ name: "A", points: [[1, 2, 0.5]], errors: [1] }] }],
    ["a histogram with bins", { type: "histogram", bins: 10, series: [{ name: "A", values: [1, 2, 3] }] }],
    ["a donut", { type: "donut", categories: ["a", "b"], series: [{ name: "A", values: [0, 1] }, { name: "B", values: [-1, 1] }] }],
  ])("accepts %s", (_name, data) => {
    expect(checkChart(JSON.stringify(data)).ok).toBe(true);
  });

  it("accepts the new chart template", () => {
    expect(checkChart(newChartSource()).ok).toBe(true);
  });
});

describe("chart scales and numbers", () => {
  it.each([
    ["bars below zero", { categories: ["a", "b"], series: [{ name: "A", values: [-2, 6] }] }, "-2", "6"],
    ["all-zero bars", { categories: ["a"], series: [{ name: "A", values: [0] }] }, "0", "1"],
    ["a line that leaves out zero", { type: "line", categories: ["a", "b"], series: [{ name: "A", values: [61, 64] }] }, "60", "65"],
    ["a line that starts at zero", { type: "line", categories: ["a", "b"], series: [{ name: "A", values: [0, 10] }] }, "0", "12"],
    ["a line that ends at zero", { type: "line", categories: ["a", "b"], series: [{ name: "A", values: [-10, 0] }] }, "-12", "0"],
    ["a histogram of counts", { type: "histogram", series: [{ name: "A", values: [1, 2, 2] }] }, "0", "2"],
  ])("labels the value axis of %s from round numbers", (_name, data, first, last) => {
    const labels = texts(paint(data), "svg > text.note-chart-label");
    expect([labels[0], labels.at(-1)]).toEqual([first, last]);
  });

  it("formats ticks and counts", () => {
    expect(formatTick(0, 1)).toBe("0");
    expect(formatTick(2_500_000, 1_000_000)).toBe("2.5e6");
    expect(formatTick(0.00002, 0.00001)).toBe("2e-5");
    expect(formatTick(1234.5, 500)).toBe("1,234.5");
    expect(formatTick(0.25, 0.05)).toBe("0.25");
    expect(formatTick(0.30000000000000004, 0.1)).toBe("0.3");
    expect(formatCount(12345)).toBe("12,345");
  });

  it("bins samples with Sturges' rule, a set count, or one bin for equal values", () => {
    expect(histogramBins([[1, 2, 2, 3, 3, 3, 4, 4, 4, 4]])).toEqual({ edges: [1, 2, 3, 4], counts: [[1, 2, 7]] });
    expect(histogramBins([[1, 2, 2, 3, 3, 3, 4, 4, 4, 4]], 2)).toEqual({ edges: [1, 2.5, 4], counts: [[3, 7]] });
    expect(histogramBins([[5, 5], [5]])).toEqual({ edges: [5, 5], counts: [[2], [1]] });
    expect(histogramBins([[0.3, 9.7], [5]]).counts.map((row) => row.reduce((sum, count) => sum + count, 0))).toEqual([
      2, 1,
    ]);
  });

  it("names palette colours in order and draws a legend", () => {
    expect(seriesColor(0)).toBe("var(--chart-1)");
    expect(seriesColor(9)).toBe("var(--chart-2)");
    const legend = chartLegend([{ label: "One", color: seriesColor(0) }]);
    expect(texts(legend, "li")).toEqual(["One"]);
    expect(legend.querySelector(".note-chart-swatch")?.getAttribute("style")).toBe("background: var(--chart-1)");
  });
});

describe("chart drawing", () => {
  it("draws one bar per value and labels the chart", () => {
    const preview = paint(VALID);
    const svg = preview.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("Validation");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(preview.querySelectorAll("rect.note-chart-bar")).toHaveLength(4);
    expect(preview.querySelector(".note-chart-title")?.textContent).toBe("Validation");
    expect(texts(preview, ".note-chart-legend li")).toEqual(["A", "B"]);
    expect(texts(preview, "svg > text.note-chart-label")).toEqual(["0%", "20%", "40%", "60%", "80%"]);
  });

  it("says when the data is broken instead of drawing", () => {
    const preview = document.createElement("div");
    paintChart(preview, "{");
    expect(preview.querySelector("svg")).toBeNull();
    expect(preview.textContent).toBe("This chart's data isn't valid. Open the source to fix it.");
    expect(paint({ ...BAR, type: "radar" }).textContent).toBe(enNotes.blocks.charts.type);
    expect(paint({ ...BAR, yScale: "log", series: [{ name: "A", values: [-1] }] }).textContent).toBe(
      "A log scale needs every value above zero.",
    );
  });

  it("names an untitled chart, adds its description and note, and colours each series", () => {
    const series = ["A", "B", "C", "D", "E", "F"].map((name, index) => ({ name, values: [index, -index] }));
    const preview = paint({ description: "What was measured.", note: "Higher is better.", categories: ["x", "y"], series });
    expect(preview.querySelector("svg")?.getAttribute("aria-label")).toBe(enNotes.blocks.chart);
    expect(preview.querySelector(".note-chart-title")).toBeNull();
    expect(texts(preview, ".note-chart-text")).toEqual(["What was measured.", "Higher is better."]);
    const first = [...preview.querySelectorAll(".note-chart-group")][0].querySelectorAll("rect.note-chart-bar");
    expect([...first].map((bar) => bar.getAttribute("style"))).toEqual(
      [1, 2, 3, 4, 5, 6].map((slot) => `fill: var(--chart-${slot})`),
    );
    const negative = [...preview.querySelectorAll(".note-chart-group")][1].querySelectorAll("rect.note-chart-bar")[5];
    const base = preview.querySelector(".note-chart-base");
    expect(negative.getAttribute("y")).toBe(base?.getAttribute("y1"));
  });

  it("draws one series in the primary colour without a legend", () => {
    const preview = paint(BAR);
    expect(preview.querySelector("rect.note-chart-bar")?.getAttribute("style")).toBe("fill: var(--primary)");
    expect(preview.querySelector(".note-chart-legend")).toBeNull();
  });

  it("shows a tooltip for a category while the pointer is over it", () => {
    const preview = paint(VALID);
    const plot = preview.querySelector(".note-chart-plot") as HTMLElement;
    const [first, second] = [...preview.querySelectorAll(".note-chart-group")];
    expect(plot.querySelector(".note-chart-tooltip")).toBeNull();

    first.dispatchEvent(new Event("pointerenter"));
    const tip = plot.querySelector(".note-chart-tooltip") as HTMLElement;
    expect(tip.querySelector(".note-chart-tooltip-title")?.textContent).toBe("Run 1");
    expect(texts(tip, ".note-chart-value")).toEqual(["61.2%", "58%"]);
    expect([...tip.querySelectorAll(".note-chart-swatch")].map((node) => node.getAttribute("style"))).toEqual([
      "background: var(--chart-1)",
      "background: var(--chart-2)",
    ]);
    const left = Number.parseFloat(tip.style.left);
    expect(left).toBeGreaterThan(25);
    expect(left).toBeLessThan(30);

    first.dispatchEvent(new Event("pointerleave"));
    expect(plot.querySelector(".note-chart-tooltip")).toBeNull();

    second.dispatchEvent(new Event("pointerenter"));
    expect(plot.querySelector(".note-chart-tooltip-title")?.textContent).toBe("Run 2");
  });

  it("shows values without a unit when the chart has none", () => {
    const preview = paint({ categories: ["Run 1"], series: [{ name: "A", values: [3] }] });
    preview.querySelector(".note-chart-group")?.dispatchEvent(new Event("pointerenter"));
    expect(preview.querySelector(".note-chart-value")?.textContent).toBe("3");
  });

  it("draws error bars and shows the error in the tooltip", () => {
    const preview = paint({
      unit: "%",
      categories: ["a", "b"],
      series: [
        { name: "A", values: [5, 6], errors: [0.5, 1] },
        { name: "B", values: [4, 3] },
      ],
    });
    expect(preview.querySelectorAll(".note-chart-error")).toHaveLength(2);
    preview.querySelector(".note-chart-group")?.dispatchEvent(new Event("pointerenter"));
    expect(texts(preview, ".note-chart-value")).toEqual(["5% ± 0.5%", "4%"]);
  });

  it("stacks bars upward and downward from zero", () => {
    const preview = paint({
      stacked: true,
      categories: ["a"],
      series: [
        { name: "Up", values: [3], errors: [1] },
        { name: "Down", values: [-2] },
        { name: "More", values: [2] },
      ],
    });
    const bars = [...preview.querySelectorAll("rect.note-chart-segment")];
    expect(bars).toHaveLength(3);
    const zero = Number(preview.querySelector(".note-chart-base")?.getAttribute("y1"));
    const [up, down, more] = bars.map((bar) => ({
      top: Number(bar.getAttribute("y")),
      bottom: Number(bar.getAttribute("y")) + Number(bar.getAttribute("height")),
    }));
    expect(up.bottom).toBeCloseTo(zero, 6);
    expect(down.top).toBeCloseTo(zero, 6);
    expect(more.bottom).toBeCloseTo(up.top, 6);
    expect(preview.querySelectorAll(".note-chart-error")).toHaveLength(1);
  });

  it("draws stacked bars on a log scale from the bottom", () => {
    const preview = paint({
      yScale: "log",
      stacked: true,
      categories: ["a"],
      series: [{ name: "A", values: [10], errors: [20] }, { name: "B", values: [90] }],
    });
    const [first] = [...preview.querySelectorAll("rect.note-chart-segment")];
    expect(Number(first.getAttribute("y")) + Number(first.getAttribute("height"))).toBeCloseTo(248, 6);
  });

  it("titles both axes and makes room for the x title", () => {
    const preview = paint({ ...BAR, xLabel: "Run", yLabel: "Score" });
    expect(preview.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 640 298");
    expect(texts(preview, ".note-chart-axis-title")).toEqual(["Run", "Score"]);
  });

  it("thins and shortens category labels that would collide", () => {
    const categories = Array.from({ length: 40 }, (_value, index) => `Category number ${index}`);
    const preview = paint({ categories, series: [{ name: "A", values: categories.map((_value, index) => index) }] });
    const labels = texts(preview, ".note-chart-group text") as string[];
    expect(labels.length).toBeLessThan(40);
    expect(labels.length).toBeGreaterThan(5);
    expect(labels.every((label) => label.endsWith("…") && label.length <= 9)).toBe(true);
  });

  it("draws log ticks by decade and skips decades when there are many", () => {
    expect(texts(paint({ yScale: "log", categories: ["a", "b", "c"], series: [{ name: "n", values: [3, 300, 30000] }] }), "svg > text.note-chart-label")).toEqual(
      ["1", "10", "100", "1,000", "10,000", "100,000"],
    );
    expect(texts(paint({ yScale: "log", categories: ["a", "b"], series: [{ name: "n", values: [2, 5] }] }), "svg > text.note-chart-label")).toEqual(
      ["1", "10"],
    );
    expect(texts(paint({ yScale: "log", categories: ["a", "b"], series: [{ name: "n", values: [1, 1e12] }] }), "svg > text.note-chart-label")).toEqual(
      ["1", "100", "10,000", "1e6", "1e8", "1e10", "1e12"],
    );
  });

  it("draws line charts with markers and error bars", () => {
    const preview = paint({
      type: "line",
      categories: ["a", "b", "c"],
      series: [
        { name: "A", values: [1, 2, 3], errors: [0.1, 0.2, 0.3] },
        { name: "B", values: [2, 3, 1] },
      ],
    });
    expect(preview.querySelectorAll(".note-chart-line")).toHaveLength(2);
    expect(preview.querySelectorAll(".note-chart-marker")).toHaveLength(6);
    expect(preview.querySelectorAll(".note-chart-error")).toHaveLength(3);
    expect(preview.querySelector(".note-chart-area")).toBeNull();
    expect(preview.querySelector(".note-chart-line")?.getAttribute("style")).toBe("stroke: var(--chart-1)");
  });

  it("fills area charts to zero and stacks them on the series below", () => {
    const flat = paint({ type: "area", categories: ["a", "b"], series: [{ name: "x", values: [1, 2] }] });
    expect(flat.querySelectorAll(".note-chart-area")).toHaveLength(1);
    const stacked = paint({
      type: "area",
      stacked: true,
      categories: ["a", "b"],
      series: [
        { name: "x", values: [1, 2] },
        { name: "y", values: [2, 1] },
      ],
    });
    const areas = [...stacked.querySelectorAll(".note-chart-area")].map((area) => area.getAttribute("d") ?? "");
    expect(areas).toHaveLength(2);
    expect(areas[1].startsWith("M179 12L481 12")).toBe(true);
  });

  it("draws scatter points with error bars and tooltips", () => {
    const preview = paint({
      type: "scatter",
      xLabel: "Dose",
      series: [
        { name: "C", points: [[1, 2], [2, 3.1, 0.4]] },
        { name: "T", points: [[1, 3]], errors: [0.5] },
      ],
    });
    expect(preview.querySelectorAll(".note-chart-marker")).toHaveLength(3);
    expect(preview.querySelectorAll(".note-chart-error")).toHaveLength(2);
    const second = [...preview.querySelectorAll(".note-chart-point")][1];
    second.dispatchEvent(new Event("pointerenter"));
    expect(preview.querySelector(".note-chart-tooltip-title")?.textContent).toBe("C");
    expect(texts(preview, ".note-chart-tooltip-row span")).toEqual(["", "Dose 2", "3.1 ± 0.4"]);
    second.dispatchEvent(new Event("pointerleave"));
    expect(preview.querySelector(".note-chart-tooltip")).toBeNull();
    const single = paint({ type: "scatter", series: [{ name: "A", points: [[2, 1], [2, 3]] }] });
    expect(texts(single, "svg > text.note-chart-label").filter((label) => label?.includes("."))).toContain("1.5");
    single.querySelector(".note-chart-point")?.dispatchEvent(new Event("pointerenter"));
    expect(texts(single, ".note-chart-tooltip-row span")[1]).toBe("x 2");
  });

  it("draws pie slices with a legend of shares and a tooltip", () => {
    const preview = paint({
      type: "pie",
      unit: " g",
      categories: ["A", "B", "C", "D"],
      series: [{ name: "Share", values: [40, 30, 20, 10] }],
    });
    expect(preview.querySelectorAll("path.note-chart-wedge")).toHaveLength(4);
    expect(preview.querySelectorAll("svg > text")).toHaveLength(0);
    expect(texts(preview, ".note-chart-legend li")).toEqual(["A 40%", "B 30%", "C 20%", "D 10%"]);
    const first = preview.querySelector(".note-chart-slice") as SVGElement;
    first.dispatchEvent(new Event("pointerenter"));
    expect(texts(preview, ".note-chart-tooltip-row span")).toEqual(["", "Share", "40 g (40%)"]);
    expect(preview.querySelector("path.note-chart-wedge")?.getAttribute("d")).toMatch(/^M0,-116A116,116,0,0,1,.+L0,0Z$/u);
    const large = paint({ type: "pie", categories: ["A", "B"], series: [{ name: "S", values: [3, 1] }] });
    expect(large.querySelector("path.note-chart-wedge")?.getAttribute("d")).toContain("A116,116,0,1,1");
  });

  it("cuts a hole in donuts and draws a lone slice as a full circle", () => {
    const donut = paint({ type: "donut", categories: ["A", "B"], series: [{ name: "S", values: [1, 2] }] });
    expect(donut.querySelector("path.note-chart-wedge")?.getAttribute("d")).toContain("A70,70,0,0,0");
    const whole = paint({ type: "pie", categories: ["A", "B"], series: [{ name: "S", values: [5, 0] }] });
    expect(whole.querySelectorAll(".note-chart-slice")).toHaveLength(1);
    expect(whole.querySelector(".note-chart-segment")).toBeNull();
    expect(whole.querySelector(".note-chart-wedge")?.getAttribute("d")).toMatch(/^M0,-116A116,116,0,1,1,0,116A116,116,0,1,1,0,-116Z$/u);
    const ring = paint({ type: "donut", categories: ["A"], series: [{ name: "S", values: [5] }] });
    expect(ring.querySelector(".note-chart-wedge")?.getAttribute("d")).toContain("M0,-70A70,70,0,1,0");
    expect(texts(ring, ".note-chart-legend li")).toEqual(["A 100%"]);
  });

  it("folds the smallest slices into Other when there are more than eight", () => {
    const categories = Array.from({ length: 10 }, (_value, index) => `c${index}`);
    const preview = paint({
      type: "pie",
      categories,
      series: [{ name: "S", values: [1, 10, 9, 8, 7, 6, 5, 4, 3, 2] }],
    });
    expect(preview.querySelectorAll("path.note-chart-wedge")).toHaveLength(8);
    const legend = texts(preview, ".note-chart-legend li");
    expect(legend[0]).toBe("c1 18.2%");
    expect(legend.at(-1)).toBe("Other 10.9%");
    expect(legend).not.toContain("c0 1.8%");
  });

  it("draws histograms as touching bars of counts", () => {
    const preview = paint({ type: "histogram", unit: "ms", series: [{ name: "Samples", values: [1, 2, 2, 3, 3, 3, 4, 4, 4, 4] }] });
    const bars = [...preview.querySelectorAll("rect.note-chart-bar")];
    expect(bars).toHaveLength(3);
    expect(bars[0].getAttribute("rx")).toBe("0");
    expect(texts(preview, ".note-chart-group text")).toEqual(["1 – 2", "2 – 3", "3 – 4"]);
    preview.querySelector(".note-chart-group")?.dispatchEvent(new Event("pointerenter"));
    expect(preview.querySelector(".note-chart-value")?.textContent).toBe("1");
    expect(texts(preview, "svg > text.note-chart-label").every((label) => !label?.includes("ms"))).toBe(true);
    const grouped = paint({
      type: "histogram",
      bins: 2,
      series: [
        { name: "A", values: [1, 2, 3] },
        { name: "B", values: [5, 5] },
      ],
    });
    expect(grouped.querySelectorAll("rect.note-chart-bar")).toHaveLength(4);
    expect(texts(grouped, ".note-chart-legend li")).toEqual(["A", "B"]);
    expect(texts(paint({ type: "histogram", series: [{ name: "A", values: [7, 7] }] }), ".note-chart-group text")).toEqual(["7"]);
  });

  it("opens and closes an accessible data table", () => {
    const preview = paint({
      ...VALID,
      series: [
        { name: "A", values: [61.2, 64.1], errors: [1.2, 0.8] },
        { name: "B", values: [58, 60] },
      ],
    });
    const toggle = preview.querySelector(".note-chart-data-toggle") as HTMLButtonElement;
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "") ?? preview.querySelector(".note-chart-data");
    expect(toggle.textContent).toBe("Show data");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect((panel as HTMLElement).hidden).toBe(true);
    const table = openData(preview);
    expect(toggle.textContent).toBe("Hide data");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(preview.querySelector(".note-chart-data")?.id).toBe(toggle.getAttribute("aria-controls"));
    expect(table.querySelector("caption")?.textContent).toBe("Validation");
    expect(tableRows(table)).toEqual([
      ["Category", "A", "A error", "B"],
      ["Run 1", "61.2%", "1.2%", "58%"],
      ["Run 2", "64.1%", "0.8%", "60%"],
    ]);
    expect(table.querySelector("tbody th")?.getAttribute("scope")).toBe("row");
    for (const cell of table.querySelectorAll("thead th")) expect(cell).toHaveClass("bg-(--note-table-head)");
    for (const row of table.querySelectorAll("tr")) expect(row).toHaveClass("border-(--note-table-line)");
    toggle.click();
    expect(toggle.textContent).toBe("Show data");
    expect((preview.querySelector(".note-chart-data") as HTMLElement).hidden).toBe(true);
    toggle.click();
    expect(preview.querySelectorAll("table")).toHaveLength(1);
  });

  it("keeps the data table open across repaints of the same block", () => {
    const preview = document.createElement("div");
    paintChart(preview, JSON.stringify(VALID));
    openData(preview);
    paintChart(preview, JSON.stringify({ ...VALID, title: "Edited" }));
    const toggle = preview.querySelector(".note-chart-data-toggle") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(preview.querySelector("caption")?.textContent).toBe("Edited");
    toggle.click();
    paintChart(preview, JSON.stringify(VALID));
    expect(preview.querySelector(".note-chart-data-toggle")?.getAttribute("aria-expanded")).toBe("false");
    expect(preview.querySelector("table")).toBeNull();
  });

  it("tabulates scatter, histogram and pie data", () => {
    const scatter = openData(
      paint({
        type: "scatter",
        xLabel: "Dose",
        yLabel: "Response",
        unit: "%",
        series: [{ name: "C", points: [[1, 2], [2, 3, 0.5]] }],
      }),
    );
    expect(scatter.querySelector("caption")?.textContent).toBe("Chart data");
    expect(tableRows(scatter)).toEqual([
      ["Series", "Dose", "Response", "Response error"],
      ["C", "1", "2%", ""],
      ["C", "2", "3%", "0.5%"],
    ]);
    const plain = openData(paint({ type: "scatter", series: [{ name: "C", points: [[1, 2]] }] }));
    expect(tableRows(plain)).toEqual([
      ["Series", "x", "y"],
      ["C", "1", "2"],
    ]);
    const listed = openData(paint({ type: "scatter", series: [{ name: "C", points: [[1, 2]], errors: [0.3] }] }));
    expect(tableRows(listed)).toEqual([
      ["Series", "x", "y", "y error"],
      ["C", "1", "2", "0.3"],
    ]);
    const histogram = openData(paint({ type: "histogram", unit: "ms", series: [{ name: "S", values: [1, 2, 2, 3] }] }));
    expect(tableRows(histogram)[0]).toEqual(["Bin", "S"]);
    expect(tableRows(histogram)[1][1]).toBe("1");
    const pie = openData(paint({ type: "pie", xLabel: "Fruit", categories: ["A", "B"], series: [{ name: "S", values: [1, 2] }] }));
    expect(tableRows(pie)).toEqual([
      ["Fruit", "S"],
      ["A", "1"],
      ["B", "2"],
    ]);
  });

  it("draws a still chart without the data toggle", () => {
    const preview = paint(VALID, true);
    expect(preview.querySelector("svg")).not.toBeNull();
    expect(preview.querySelector("button")).toBeNull();
    const bare = document.createElement("div");
    paintChart(bare, JSON.stringify(VALID));
    expect(bare.querySelector("button")).not.toBeNull();
  });

  it("describes itself as an interactive note block", () => {
    expect(chartBlock.name).toBe("chart");
    expect(chartBlock.label()).toBe(enNotes.blocks.chart);
    expect(chartBlock.interactive).toBe(true);
    expect(chartBlock.template?.()).toEqual({ info: "chart", source: newChartSource() });
    const preview = document.createElement("div");
    expect(chartBlock.paint(preview, JSON.stringify(VALID), { still: true })).toBeUndefined();
    expect(preview.querySelector("button")).toBeNull();
    expect(preview.querySelectorAll("rect.note-chart-bar")).toHaveLength(4);
  });
});
