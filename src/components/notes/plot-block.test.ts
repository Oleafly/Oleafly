// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  curvePath,
  MAX_CURVES,
  MAX_POINTS,
  PLOT_TEMPLATE,
  paintPlot,
  parsePlot,
  plotBlock,
  plotView,
  robustRange,
  SAMPLES,
  sampleCurve,
  splitTopLevel,
} from "./plot-block";
import "./tests/setup";

function paint(source: string): HTMLElement {
  const preview = document.createElement("div");
  paintPlot(preview, source);
  return preview;
}

function sample(values: number[], xs: number[] = values.map((_value, index) => index)) {
  return { xs: Float64Array.from(xs), ys: Float64Array.from(values) };
}

function moves(path: string): number {
  return (path.match(/M/g) ?? []).length;
}

const identity = (value: number) => value;

describe("plot source", () => {
  it("reads functions, parametric curves and every option", () => {
    const spec = parsePlot(
      [
        "# a comment",
        "",
        "title: Waves",
        "domain: -2*pi, 2pi",
        "range: 3, -3",
        "t: 2*pi, 0",
        "labels: Time (s), Height, in m",
        "y = sin(x)",
        "f(x) = x^2/10",
        "x = cos(t), y = sin(t)",
        "point: pi/2, 1, Peak, top",
        "point: 0, 0",
      ].join("\n"),
    );
    expect(spec.problems).toEqual([]);
    expect(spec.title).toBe("Waves");
    expect(spec.domain).toEqual([-2 * Math.PI, 2 * Math.PI]);
    expect(spec.range).toEqual([-3, 3]);
    expect(spec.t).toEqual([0, 2 * Math.PI]);
    expect(spec.xLabel).toBe("Time (s)");
    expect(spec.yLabel).toBe("Height, in m");
    expect(spec.curves.map((curve) => [curve.kind, curve.line, curve.label])).toEqual([
      ["function", 8, "y = sin(x)"],
      ["function", 9, "f(x) = x^2/10"],
      ["parametric", 10, "x = cos(t), y = sin(t)"],
    ]);
    const parametric = spec.curves[2];
    expect(parametric.kind === "parametric" && parametric.x({ t: 0 })).toBe(1);
    expect(spec.curves[1].y({ x: 10 })).toBe(10);
    expect(spec.points).toEqual([
      { line: 11, x: Math.PI / 2, y: 1, label: "Peak, top" },
      { line: 12, x: 0, y: 0 },
    ]);
  });

  it("keeps commas inside function calls in parametric curves and options", () => {
    const spec = parsePlot("x = max(t, 1), y = min(t, 2, 3)\ndomain: min(0, 1), max(2, 3)");
    expect(spec.problems).toEqual([]);
    const [curve] = spec.curves;
    expect(curve.kind === "parametric" && curve.x({ t: 0 })).toBe(1);
    expect(curve.y({ t: 5 })).toBe(2);
    expect(spec.domain).toEqual([0, 3]);
  });

  it("clears an empty title and labels", () => {
    const spec = parsePlot("title: Old\ntitle:\nlabels: a, b\nlabels:");
    expect(spec.title).toBeUndefined();
    expect(spec.xLabel).toBeUndefined();
    expect(spec.yLabel).toBeUndefined();
    expect(parsePlot("labels: only x").yLabel).toBeUndefined();
  });

  it.each([
    ["z = 1", "line", undefined],
    ["y = sin(t)", "name", "t"],
    ["y = (x", "parenthesis", undefined],
    ["x = cos(t)", "parametric", undefined],
    ["x = foo(t), y = t", "name", "foo"],
    ["x = t, y = sin(", "end", undefined],
    ["domain: 1", "values", undefined],
    ["domain: 1, 2, 3", "values", undefined],
    ["domain: 1, 1", "order", undefined],
    ["range: 1/0, 2", "number", undefined],
    ["t: 0, 10^400", "number", undefined],
    ["domain: x, 1", "name", "x"],
    ["domain: 0, q", "name", "q"],
    ["point: 1", "point", undefined],
    ["point: a, 1", "name", "a"],
    ["point: 1, sqrt(-1)", "number", undefined],
  ])("reports %j", (source, reason, detail) => {
    const spec = parsePlot(`\n${source}`);
    expect(spec.problems).toEqual([detail === undefined ? { line: 2, reason } : { line: 2, reason, detail }]);
    expect(spec.curves).toEqual([]);
  });

  it("stops adding curves and points at their limits", () => {
    const lines = [
      ...Array.from({ length: MAX_CURVES }, (_value, index) => `y = x + ${index}`),
      "y = x",
      "x = t, y = t",
      ...Array.from({ length: MAX_POINTS + 1 }, (_value, index) => `point: ${index}, 0`),
    ];
    const spec = parsePlot(lines.join("\n"));
    expect(spec.curves).toHaveLength(MAX_CURVES);
    expect(spec.points).toHaveLength(MAX_POINTS);
    expect(spec.problems).toEqual([
      { line: MAX_CURVES + 1, reason: "tooManyCurves" },
      { line: MAX_CURVES + 2, reason: "tooManyCurves" },
      { line: lines.length, reason: "tooManyPoints" },
    ]);
  });

  it("splits on top-level commas only", () => {
    expect(splitTopLevel("a, f(b, c), d")).toEqual(["a", " f(b, c)", " d"]);
    expect(splitTopLevel(") , x")).toEqual([") ", " x"]);
    expect(splitTopLevel("")).toEqual([""]);
  });
});

describe("plot sampling and ranges", () => {
  it("samples functions across the domain and parametric curves across t", () => {
    const [graph, circle] = parsePlot("y = 2x\nx = cos(t), y = sin(t)").curves;
    const line = sampleCurve(graph, [0, 6], [0, 1]);
    expect(line.xs).toHaveLength(SAMPLES + 1);
    expect(line.xs[SAMPLES]).toBe(6);
    expect(line.ys[SAMPLES]).toBe(12);
    const round = sampleCurve(circle, [0, 1], [0, Math.PI]);
    expect(round.xs[0]).toBe(1);
    expect(round.xs[SAMPLES]).toBeCloseTo(-1, 12);
  });

  it("clips asymptotes but keeps growth that reaches the edge", () => {
    const [tangent] = parsePlot("y = tan(x)").curves;
    const tan = sampleCurve(tangent, [-2 * Math.PI, 2 * Math.PI], [0, 1]);
    const tanRange = robustRange([tan.ys], []) as [number, number];
    expect(tanRange[1]).toBeLessThan(40);
    expect(tanRange[0]).toBeGreaterThan(-40);
    const [growth] = parsePlot("y = exp(x)").curves;
    const exp = sampleCurve(growth, [-10, 10], [0, 1]);
    expect((robustRange([exp.ys], []) as [number, number])[1]).toBeCloseTo(Math.exp(10), 6);
    const [left] = parsePlot("y = exp(-x)").curves;
    const mirrored = sampleCurve(left, [-10, 10], [0, 1]);
    expect((robustRange([mirrored.ys], []) as [number, number])[1]).toBeCloseTo(Math.exp(10), 6);
    const [decay] = parsePlot("y = -exp(x)").curves;
    const negative = sampleCurve(decay, [-10, 10], [0, 1]);
    expect((robustRange([negative.ys], []) as [number, number])[0]).toBeCloseTo(-Math.exp(10), 6);
  });

  it("clips an edge value that is far beyond the rest", () => {
    const values = Array.from({ length: 100 }, (_value, index) => index / 100);
    values[99] = 1e12;
    values[0] = -1e12;
    const [low, high] = robustRange([Float64Array.from(values)], []) as [number, number];
    expect(high).toBeLessThan(3);
    expect(low).toBeGreaterThan(-3);
  });

  it("includes extra values, ignores unusable ones and gives null with nothing", () => {
    expect(robustRange([Float64Array.from([1, 2, Number.NaN, Number.POSITIVE_INFINITY, 1e301])], [10, -5])).toEqual([
      -5, 10,
    ]);
    expect(robustRange([Float64Array.from([Number.NaN])], [])).toBeNull();
    expect(robustRange([], [])).toBeNull();
    expect(robustRange([Float64Array.from([4, 4, 4])], [])).toEqual([4, 4]);
  });

  it("chooses the view from the domain, the curves and the points", () => {
    expect(plotView(parsePlot("y = x")).view).toEqual({ x: [-10, 10], y: [-11, 11] });
    expect(plotView(parsePlot("y = x\npoint: 1, 1")).view.x).toEqual([-10, 10]);
    expect(plotView(parsePlot("y = 1\npoint: 30, 1")).view.x).toEqual([-12, 32]);
    expect(plotView(parsePlot("y = 2\nrange: 0, 4")).view.y).toEqual([0, 4]);
    expect(plotView(parsePlot("y = 2")).view.y).toEqual([1, 3]);
    expect(plotView(parsePlot("y = 0")).view.y).toEqual([-1, 1]);
    const circle = plotView(parsePlot("x = cos(t), y = sin(t)")).view;
    expect(circle.x[0]).toBeCloseTo(-1.1, 6);
    expect(circle.y[1]).toBeCloseTo(1.1, 6);
    expect(plotView(parsePlot("point: 2, 3")).view).toEqual({ x: [1, 3], y: [2, 4] });
    expect(plotView(parsePlot("")).view).toEqual({ x: [-1, 1], y: [-1, 1] });
    expect(plotView(parsePlot("y = sqrt(-1)")).view.y).toEqual([-1, 1]);
  });
});

describe("plot paths", () => {
  const view = { x: [0, 10] as [number, number], y: [-10, 10] as [number, number] };

  it("breaks the path on values that are not finite", () => {
    const path = curvePath(sample([1, 2, Number.NaN, 3, 4]), view, identity, identity);
    expect(path).toBe("M0 1L1 2M3 3L4 4");
  });

  it("breaks the path where a curve jumps against its trend", () => {
    const tan = curvePath(sample([1, 8, -8, -1]), view, identity, identity);
    expect(moves(tan)).toBe(2);
    const steep = curvePath(sample([30, 15, -15, -30]), view, identity, identity);
    expect(moves(steep)).toBe(1);
    const edge = curvePath(sample([20, -20]), view, identity, identity);
    expect(moves(edge)).toBe(2);
    const first = curvePath(sample([20, -20, -10]), view, identity, identity);
    expect(moves(first)).toBe(2);
    const small = curvePath(sample([1, -1, 1]), view, identity, identity);
    expect(moves(small)).toBe(1);
    const sideways = curvePath(sample([0, 0, 0, 0, 0], [0, 1, 8, -8, -7]), { x: [0, 10], y: [-1, 1] }, identity, identity);
    expect(moves(sideways)).toBe(2);
  });

  it("keeps far coordinates in a drawable range", () => {
    const path = curvePath(sample([1e9, -1e9], [0, 0.5]), { x: [0, 1], y: [-1e12, 1e12] }, identity, identity);
    expect(path).toBe("M0 4400L0.5 -4000");
  });
});

describe("plot drawing", () => {
  it("draws a labelled plot with a legend, axes, a grid and a gap at each asymptote", () => {
    const preview = paint(PLOT_TEMPLATE);
    const svg = preview.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Plot of y = sin(x); y = x^2/10");
    expect(preview.querySelectorAll(".note-plot-curve")).toHaveLength(2);
    expect(
      [...preview.querySelectorAll(".note-plot-curve")].map((path) => path.getAttribute("style")),
    ).toEqual(["stroke: var(--chart-1)", "stroke: var(--chart-2)"]);
    expect(preview.querySelectorAll(".note-plot-axis")).toHaveLength(2);
    expect(preview.querySelectorAll(".note-plot-grid").length).toBeGreaterThan(6);
    expect([...preview.querySelectorAll(".note-chart-legend li")].map((item) => item.textContent)).toEqual([
      "y = sin(x)",
      "y = x^2/10",
    ]);
    const clip = preview.querySelector("clipPath")?.id;
    expect(preview.querySelector("g[clip-path]")?.getAttribute("clip-path")).toBe(`url(#${clip})`);
    expect(preview.querySelector(".note-plot-problems")).toBeNull();
    const tangent = paint("y = tan(x)\ndomain: -2pi, 2pi");
    expect(moves(tangent.querySelector(".note-plot-curve")?.getAttribute("d") ?? "")).toBe(5);
    expect(tangent.querySelector(".note-chart-legend")).toBeNull();
  });

  it("leaves out axes that are off the view and draws titles, labels and points", () => {
    const preview = paint("title: Shifted\nlabels: time, size\ndomain: 1, 5\nrange: 1, 5\ny = x\npoint: 2, 2, A\npoint: 3, 3");
    expect(preview.querySelector(".note-plot-title")?.textContent).toBe("Shifted");
    expect(preview.querySelector("svg")?.getAttribute("aria-label")).toBe("Shifted");
    expect(preview.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 640 418");
    expect(preview.querySelectorAll(".note-plot-axis")).toHaveLength(0);
    expect([...preview.querySelectorAll(".note-chart-axis-title")].map((node) => node.textContent)).toEqual([
      "time",
      "size",
    ]);
    expect(preview.querySelectorAll(".note-plot-point")).toHaveLength(2);
    expect([...preview.querySelectorAll(".note-plot-point-label")].map((node) => node.textContent)).toEqual(["A"]);
  });

  it("draws points without curves and names the plot", () => {
    const preview = paint("point: 1, 2");
    expect(preview.querySelector("svg")?.getAttribute("aria-label")).toBe("Plot");
    expect(preview.querySelectorAll(".note-plot-point")).toHaveLength(1);
  });

  it("lists bad lines under the plot in line order", () => {
    const preview = paint("y = sqrt(-1 - x^2)\ny = x\nwhat\ny = q");
    expect(preview.querySelectorAll(".note-plot-curve")).toHaveLength(1);
    expect([...preview.querySelectorAll(".note-plot-problems li")].map((item) => item.textContent)).toEqual([
      "Line 1: No real values in this range.",
      "Line 3: Not a curve or an option. Try y = x^2 or domain: -5, 5.",
      "Line 4: Unknown name q.",
    ]);
  });

  it("says when nothing can be drawn and still lists the problems", () => {
    const preview = paint("y = (x");
    expect(preview.querySelector("svg")).toBeNull();
    expect(preview.querySelector("p")?.textContent).toBe(
      "Nothing to plot yet. Add a line such as y = sin(x).",
    );
    expect(preview.querySelector(".note-plot-problems")?.textContent).toBe("Line 1: The parentheses don't match.");
    expect(paint("").querySelector(".note-plot-problems")).toBeNull();
  });

  it("replaces the previous drawing and gives each plot its own clip", () => {
    const preview = document.createElement("div");
    expect(paintPlot(preview, "y = x")).toBeUndefined();
    const first = preview.querySelector("clipPath")?.id;
    paintPlot(preview, "y = 2x");
    expect(preview.querySelectorAll("svg")).toHaveLength(1);
    expect(preview.querySelector("clipPath")?.id).not.toBe(first);
  });

  it("describes itself as a note block", () => {
    expect(plotBlock.name).toBe("plot");
    expect(plotBlock.label()).toBe("Plot");
    expect(plotBlock.template?.()).toEqual({ info: "plot", source: PLOT_TEMPLATE });
    expect(plotBlock.interactive).toBeUndefined();
    const preview = document.createElement("div");
    plotBlock.paint(preview, "y = x", { still: true });
    expect(preview.querySelector("svg")).not.toBeNull();
  });
});
