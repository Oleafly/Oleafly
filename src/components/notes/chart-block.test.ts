// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { loadNamespace } from "@/i18n";
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
});
