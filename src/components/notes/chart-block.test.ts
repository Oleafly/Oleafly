// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { chartScale, paintChart, parseChart } from "./chart-block";

const VALID = {
  title: "Validation",
  unit: "%",
  categories: ["Run 1", "Run 2"],
  series: [
    { name: "A", values: [61.2, 64.1] },
    { name: "B", values: [58, 60] },
  ],
};

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("chart blocks", () => {
  it("reads valid chart data", () => {
    expect(parseChart(JSON.stringify(VALID))).toEqual(VALID);
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
    expect(parseChart(source)).toBeNull();
  });

  it("puts zero on the baseline when values go below it", () => {
    const scale = chartScale({ categories: ["a", "b"], series: [{ name: "A", values: [-2, 6] }] });
    expect(scale(6)).toBeLessThan(scale(0));
    expect(scale(-2)).toBeGreaterThan(scale(0));
  });

  it("draws one bar per value and labels the chart", () => {
    const preview = document.createElement("div");
    paintChart(preview, JSON.stringify(VALID));
    const svg = preview.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("Validation");
    expect(preview.querySelectorAll("rect.fill-primary")).toHaveLength(4);
    expect(preview.querySelector(".note-chart-title")?.textContent).toBe("Validation");
  });

  it("says when the data is broken instead of drawing", () => {
    const preview = document.createElement("div");
    paintChart(preview, "{");
    expect(preview.querySelector("svg")).toBeNull();
    expect(preview.textContent).toBe("This chart's data isn't valid. Open the source to fix it.");
  });

  it("draws all-zero values on the baseline", () => {
    const scale = chartScale({ categories: ["a"], series: [{ name: "A", values: [0] }] });
    expect(scale(0)).toBe(248);
    expect(Number.isFinite(scale(1))).toBe(true);
  });

  it("names an untitled chart, adds its description and note, and fades later series", () => {
    const preview = document.createElement("div");
    const series = ["A", "B", "C", "D", "E", "F"].map((name, index) => ({ name, values: [index, -index] }));
    paintChart(
      preview,
      JSON.stringify({ description: "What was measured.", note: "Higher is better.", categories: ["x", "y"], series }),
    );
    expect(preview.querySelector("svg")?.getAttribute("aria-label")).toBe(enNotes.blocks.chart);
    expect(preview.querySelector(".note-chart-title")).toBeNull();
    expect([...preview.querySelectorAll(".note-chart-text")].map((node) => node.textContent)).toEqual([
      "What was measured.",
      "Higher is better.",
    ]);
    const opacities = [...preview.querySelectorAll(".note-chart-group")][0]
      .querySelectorAll("rect.fill-primary");
    expect([...opacities].map((bar) => bar.getAttribute("fill-opacity"))).toEqual(["1", "0.65", "0.4", "0.25", "0.15", "1"]);
    const negative = [...preview.querySelectorAll(".note-chart-group")][1].querySelectorAll("rect.fill-primary")[5];
    const base = preview.querySelector(".note-chart-base");
    expect(negative.getAttribute("y")).toBe(base?.getAttribute("y1"));
  });

  it("shows a tooltip for a category while the pointer is over it", () => {
    const preview = document.createElement("div");
    paintChart(preview, JSON.stringify(VALID));
    const plot = preview.querySelector(".note-chart-plot") as HTMLElement;
    const [first, second] = [...preview.querySelectorAll(".note-chart-group")];
    expect(plot.querySelector(".note-chart-tooltip")).toBeNull();

    first.dispatchEvent(new Event("pointerenter"));
    const tip = plot.querySelector(".note-chart-tooltip") as HTMLElement;
    expect(tip.querySelector(".note-chart-tooltip-title")?.textContent).toBe("Run 1");
    expect([...tip.querySelectorAll(".note-chart-value")].map((node) => node.textContent)).toEqual(["61.2%", "58%"]);
    expect([...tip.querySelectorAll<HTMLElement>(".note-chart-swatch")].map((node) => node.style.opacity)).toEqual([
      "1",
      "0.65",
    ]);
    expect(tip.style.left).toBe("25%");

    first.dispatchEvent(new Event("pointerleave"));
    expect(plot.querySelector(".note-chart-tooltip")).toBeNull();

    second.dispatchEvent(new Event("pointerenter"));
    expect(plot.querySelector(".note-chart-tooltip-title")?.textContent).toBe("Run 2");
  });

  it("shows values without a unit when the chart has none", () => {
    const preview = document.createElement("div");
    paintChart(preview, JSON.stringify({ categories: ["Run 1"], series: [{ name: "A", values: [3] }] }));
    preview.querySelector(".note-chart-group")?.dispatchEvent(new Event("pointerenter"));
    expect(preview.querySelector(".note-chart-value")?.textContent).toBe("3");
  });
});
