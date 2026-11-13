import { arc, bin, type PieArcDatum, pie, range, type ScaleContinuousNumeric, scaleLinear, scaleLog, thresholdSturges, tickStep } from "d3";
import { ChartColumn } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { i18n } from "@/i18n";
import { formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { newChartSource } from "./block-templates";
import { blockMessage, element, type NoteBlockKind, type PaintContext, svgNode, svgText } from "./note-blocks";

export type ChartType = "bar" | "line" | "area" | "scatter" | "pie" | "donut" | "histogram";

export interface ChartSeries {
  name: string;
  values?: number[];
  errors?: number[];
  points?: number[][];
}

export interface ChartData {
  type?: ChartType;
  title?: string;
  description?: string;
  note?: string;
  unit?: string;
  xLabel?: string;
  yLabel?: string;
  yScale?: "linear" | "log";
  stacked?: boolean;
  bins?: number;
  categories?: string[];
  series: ChartSeries[];
}

export type ChartProblem =
  | "invalid"
  | "type"
  | "length"
  | "tooManySeries"
  | "errors"
  | "errorsType"
  | "points"
  | "tooManyPoints"
  | "pie"
  | "samples"
  | "bins"
  | "log"
  | "logType";

export type ChartCheck = { ok: true; chart: ChartData } | { ok: false; problem: ChartProblem };

const TYPES: ReadonlySet<string> = new Set(["bar", "line", "area", "scatter", "pie", "donut", "histogram"]);
export const PALETTE_SIZE = 8;
const MAX_SERIES = PALETTE_SIZE;
const MAX_POINTS = 5000;
const MAX_SAMPLES = 100_000;
const MAX_BINS = 100;
const DEFAULT_BIN_CAP = 50;
const WIDTH = 640;
const BASE_HEIGHT = 280;
const PLOT_TOP = 12;
const PLOT_BOTTOM = 248;
const RIGHT = WIDTH - 8;
export const TITLE_ROOM = 18;
const CHAR_WIDTH = 6.2;

let serial = 0;
const openTables = new WeakSet<HTMLElement>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function errorsProblem(errors: unknown, length: number): boolean {
  return !finiteNumbers(errors) || errors.length !== length || errors.some((error) => error < 0);
}

function scatterProblem(series: Record<string, unknown>[], log: boolean): ChartProblem | null {
  let total = 0;
  for (const item of series) {
    const points = item.points;
    if (!Array.isArray(points) || points.length === 0) return "points";
    const valid = points.every(
      (point) =>
        finiteNumbers(point) && (point.length === 2 || point.length === 3) && (point.length === 2 || point[2] >= 0),
    );
    if (!valid) return "points";
    if (item.errors !== undefined && errorsProblem(item.errors, points.length)) return "errors";
    if (log && (points as number[][]).some((point) => point[1] <= 0)) return "log";
    total += points.length;
  }
  return total > MAX_POINTS ? "tooManyPoints" : null;
}

function histogramProblem(series: Record<string, unknown>[]): ChartProblem | null {
  let total = 0;
  for (const item of series) {
    if (item.errors !== undefined) return "errorsType";
    if (!finiteNumbers(item.values)) return "invalid";
    if (item.values.length === 0) return "samples";
    total += item.values.length;
  }
  return total > MAX_SAMPLES ? "tooManyPoints" : null;
}

function categorySeriesProblem(item: Record<string, unknown>, count: number, round: boolean, log: boolean): ChartProblem | null {
  if (!finiteNumbers(item.values)) return "invalid";
  if (item.values.length !== count) return "length";
  if (item.errors !== undefined) {
    if (round) return "errorsType";
    if (errorsProblem(item.errors, item.values.length)) return "errors";
  }
  if (log && item.values.some((value) => value <= 0)) return "log";
  return null;
}

function pieTotalProblem(values: readonly number[]): boolean {
  return values.some((value) => value < 0) || values.reduce((sum, value) => sum + value, 0) <= 0;
}

function categoryProblem(
  type: string,
  categories: unknown,
  series: Record<string, unknown>[],
  log: boolean,
): ChartProblem | null {
  if (!Array.isArray(categories) || categories.length === 0) return "invalid";
  if (!categories.every((category) => typeof category === "string")) return "invalid";
  const round = type === "pie" || type === "donut";
  for (const item of series) {
    const problem = categorySeriesProblem(item, categories.length, round, log);
    if (problem) return problem;
  }
  if (categories.length * series.length > MAX_POINTS) return "tooManyPoints";
  if (round && pieTotalProblem(series[0].values as number[])) return "pie";
  return null;
}

function settingsInvalid(data: Record<string, unknown>): boolean {
  const texts = [data.title, data.description, data.note, data.unit, data.xLabel, data.yLabel];
  if (!texts.every(optionalText)) return true;
  if (data.yScale !== undefined && data.yScale !== "linear" && data.yScale !== "log") return true;
  return data.stacked !== undefined && typeof data.stacked !== "boolean";
}

function binsInvalid(bins: unknown): boolean {
  return bins !== undefined && !(Number.isInteger(bins) && (bins as number) >= 1 && (bins as number) <= MAX_BINS);
}

function chartProblem(data: unknown): ChartProblem | null {
  if (!isRecord(data) || settingsInvalid(data)) return "invalid";
  const type = data.type ?? "bar";
  if (typeof type !== "string" || !TYPES.has(type)) return "type";
  if (binsInvalid(data.bins)) return "bins";
  const series = data.series;
  if (!Array.isArray(series) || series.length === 0) return "invalid";
  if (!series.every((item) => isRecord(item) && typeof item.name === "string")) return "invalid";
  if (series.length > MAX_SERIES) return "tooManySeries";
  const log = data.yScale === "log";
  if (log && (type === "pie" || type === "donut" || type === "histogram")) return "logType";
  if (type === "scatter") return scatterProblem(series, log);
  if (type === "histogram") return histogramProblem(series);
  return categoryProblem(type, data.categories, series, log);
}

export function checkChart(source: string): ChartCheck {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  const problem = chartProblem(data);
  return problem ? { ok: false, problem } : { ok: true, chart: data as ChartData };
}

export function chartType(data: ChartData): ChartType {
  return data.type ?? "bar";
}

export function seriesColor(index: number): string {
  return `var(--chart-${(index % PALETTE_SIZE) + 1})`;
}

function colorFor(data: ChartData, index: number): string {
  return data.series.length === 1 ? "var(--primary)" : seriesColor(index);
}

function clean(value: number): number {
  return Number(value.toPrecision(12)) || 0;
}

const WHOLE_NUMBER: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const SHARE: Intl.NumberFormatOptions = { style: "percent", maximumFractionDigits: 1 };

export function formatTick(value: number, step: number): string {
  if (value === 0) return "0";
  const size = Math.abs(value);
  if (size >= 1e6 || size < 1e-4) {
    const [mantissa, exponent] = value.toExponential(2).split("e");
    return `${Number(mantissa)}e${Number(exponent)}`;
  }
  const digits = Math.min(10, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)) + 1);
  return formatNumber(value, { maximumFractionDigits: digits });
}

export function formatCount(value: number): string {
  return formatNumber(value, WHOLE_NUMBER);
}

function formatShare(share: number): string {
  return formatNumber(share, SHARE);
}

export interface LegendItem {
  label: string;
  color: string;
}

function swatch(color: string): HTMLElement {
  const node = element("span", "note-chart-swatch size-2 shrink-0 rounded-xs");
  node.setAttribute("style", `background: ${color}`);
  return node;
}

export const CHART_LEGEND_CLASS = "note-chart-legend";

export function chartLegend(items: readonly LegendItem[]): HTMLElement {
  const list = element(
    "ul",
    `${CHART_LEGEND_CLASS} mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground`,
  );
  for (const item of items) {
    const entry = element("li", "flex min-w-0 items-center gap-1.5");
    entry.append(swatch(item.color), element("span", "truncate", item.label));
    list.append(entry);
  }
  return list;
}

export interface AxisTicks {
  ticks: number[];
  labels: string[];
}

export function linearTicks(scale: ScaleContinuousNumeric<number, number>, count: number, unit = ""): AxisTicks {
  const [low, high] = scale.domain();
  const step = tickStep(low, high, count);
  const ticks = scale.ticks(count);
  return { ticks, labels: ticks.map((tick) => `${formatTick(tick, step)}${unit}`) };
}

interface ValueAxis extends AxisTicks {
  scale: (value: number) => number;
  zero: number;
}

interface Extent {
  low: number;
  high: number;
}

function grow(extent: Extent, value: number): void {
  if (value < extent.low) extent.low = value;
  if (value > extent.high) extent.high = value;
}

function pad(extent: Extent): Extent {
  const room = (extent.high - extent.low) * 0.05;
  const low = extent.low - room;
  const high = extent.high + room;
  return {
    low: extent.low >= 0 && low < 0 ? 0 : low,
    high: extent.high <= 0 && high > 0 ? 0 : high,
  };
}

function linearAxis(extent: Extent, unit: string): ValueAxis {
  let { low, high } = extent;
  if (low === high) {
    const room = low === 0 ? 1 : Math.abs(low) * 0.1;
    low = low === 0 ? 0 : low - room;
    high += room;
  }
  const scale = scaleLinear().domain([low, high]).nice(4).range([PLOT_BOTTOM, PLOT_TOP]);
  const [bottom, top] = scale.domain();
  return { scale, ...linearTicks(scale, 4, unit), zero: scale(Math.min(top, Math.max(bottom, 0))) };
}

function logAxis(extent: Extent, unit: string): ValueAxis {
  const first = Math.floor(Math.log10(extent.low) + 1e-9);
  const last = Math.max(first + 1, Math.ceil(Math.log10(extent.high) - 1e-9));
  const scale = scaleLog()
    .domain([10 ** first, 10 ** last])
    .range([PLOT_BOTTOM, PLOT_TOP])
    .clamp(true);
  const ticks = scale.ticks(Math.min(6, last - first)).map(clean);
  return { scale, ticks, labels: ticks.map((tick) => `${formatTick(tick, tick)}${unit}`), zero: PLOT_BOTTOM };
}

interface Bars {
  categories: string[];
  series: { name: string; values: number[]; errors?: number[] }[];
}

function stackedTotals(bars: Bars, extent: Extent, log: boolean): void {
  bars.categories.forEach((_category, index) => {
    let up = 0;
    let down = 0;
    for (const series of bars.series) {
      const value = series.values[index];
      const error = series.errors?.[index] ?? 0;
      if (value >= 0) up += value;
      else down += value;
      const end = value >= 0 ? up : down;
      grow(extent, log && end - error <= 0 ? end : end - error);
      grow(extent, end + error);
    }
  });
}

function valueExtent(data: ChartData, bars: Bars | null, log: boolean): Extent {
  const type = chartType(data);
  const extent: Extent = log ? { low: Number.POSITIVE_INFINITY, high: 0 } : { low: Number.POSITIVE_INFINITY, high: Number.NEGATIVE_INFINITY };
  if (!log && type !== "line" && type !== "scatter") grow(extent, 0);
  const stacked = data.stacked === true && (type === "bar" || type === "area");
  if (bars && stacked) {
    stackedTotals(bars, extent, log);
  } else if (bars) {
    for (const series of bars.series) {
      series.values.forEach((value, index) => {
        const error = series.errors?.[index] ?? 0;
        grow(extent, value + error);
        grow(extent, log && value - error <= 0 ? value : value - error);
      });
    }
  } else {
    for (const series of data.series) {
      (series.points as number[][]).forEach((point, index) => {
        const error = point[2] ?? series.errors?.[index] ?? 0;
        grow(extent, point[1] + error);
        grow(extent, log && point[1] - error <= 0 ? point[1] : point[1] - error);
      });
    }
  }
  return log || (type !== "line" && type !== "scatter") ? extent : pad(extent);
}

function axisFor(data: ChartData, bars: Bars | null): ValueAxis {
  const log = data.yScale === "log";
  const extent = valueExtent(data, bars, log);
  const unit = chartType(data) === "histogram" ? "" : (data.unit ?? "");
  return log ? logAxis(extent, unit) : linearAxis(extent, unit);
}

export function labelRoom(labels: readonly string[], title: string | undefined): number {
  const longest = Math.max(1, ...labels.map((label) => label.length));
  return Math.max(28, Math.ceil(10 + CHAR_WIDTH * longest)) + (title ? TITLE_ROOM : 0);
}

function steppedBins(low: number, high: number, target: number) {
  let wanted = target;
  let step = tickStep(low, high, wanted);
  while (wanted > 1 && step < (high - low) / target) {
    wanted -= 1;
    step = tickStep(low, high, wanted);
  }
  const start = clean(Math.floor(low / step + 1e-9) * step);
  const end = clean(Math.ceil(high / step - 1e-9) * step);
  return bin()
    .domain([start, end])
    .thresholds(range(start + step, end - step / 2, step).map(clean));
}

export function histogramBins(samples: readonly (readonly number[])[], bins?: number): { edges: number[]; counts: number[][] } {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let largest: readonly number[] = [];
  for (const values of samples) {
    if (values.length > largest.length) largest = values;
    for (const value of values) {
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  if (low === high) return { edges: [low, high], counts: samples.map((values) => [values.length]) };
  const binner = bins
    ? bin()
        .domain([low, high])
        .thresholds(Array.from({ length: bins - 1 }, (_value, index) => clean(low + ((high - low) * (index + 1)) / bins)))
    : steppedBins(low, high, Math.min(DEFAULT_BIN_CAP, thresholdSturges(largest)));
  const grouped = samples.map((values) => binner(values as number[]));
  const edges = [...grouped[0].map((group) => group.x0 as number), grouped[0].at(-1)?.x1 as number];
  return { edges, counts: grouped.map((groups) => groups.map((group) => group.length)) };
}

function histogramBars(data: ChartData): Bars {
  const { edges, counts } = histogramBins(
    data.series.map((series) => series.values as number[]),
    data.bins,
  );
  const step = edges[1] - edges[0];
  const categories = edges.slice(0, -1).map((edge, index) => {
    const end = edges[index + 1];
    return edge === end ? formatTick(edge, step || 1) : `${formatTick(edge, step)} – ${formatTick(end, step)}`;
  });
  return {
    categories,
    series: data.series.map((series, index) => ({ name: series.name, values: counts[index] })),
  };
}

function categoryBars(data: ChartData): Bars {
  return {
    categories: data.categories as string[],
    series: data.series.map((series) => ({
      name: series.name,
      values: series.values as number[],
      errors: series.errors,
    })),
  };
}

function tooltipBox(title: string): HTMLElement {
  const box = element(
    "div",
    "note-chart-tooltip pointer-events-none absolute top-0 z-10 min-w-32 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-[0.6875rem] text-popover-foreground shadow-md",
  );
  box.append(element("p", "note-chart-tooltip-title font-medium", title));
  return box;
}

function tooltipRow(box: HTMLElement, color: string, name: string, value: string): void {
  const row = element("p", "note-chart-tooltip-row flex items-center gap-1.5 text-muted-foreground");
  row.append(swatch(color), element("span", "", name), element("span", "note-chart-value ms-auto text-foreground tabular-nums", value));
  box.append(row);
}

function withError(value: number, error: number | undefined, unit: string): string {
  return error === undefined ? `${value}${unit}` : `${value}${unit} ± ${error}${unit}`;
}

function hover(target: SVGElement, plot: HTMLElement, tip: HTMLElement, x: number): void {
  tip.style.left = `${(x / WIDTH) * 100}%`;
  target.addEventListener("pointerenter", () => plot.append(tip));
  target.addEventListener("pointerleave", () => tip.remove());
}

function errorBar(svg: SVGElement, x: number, from: number, to: number): void {
  svg.append(
    svgNode("path", {
      d: `M${x} ${from}V${to}M${x - 4} ${from}H${x + 4}M${x - 4} ${to}H${x + 4}`,
      class: "note-chart-error",
    }),
  );
}

function valueGrid(svg: SVGElement, axis: ValueAxis, left: number): void {
  axis.ticks.forEach((tick, index) => {
    const y = axis.scale(tick);
    svg.append(svgNode("line", { x1: left, x2: RIGHT, y1: y, y2: y, class: "note-chart-grid" }));
    svg.append(
      svgText(axis.labels[index], { x: left - 6, y: y + 3.5, "text-anchor": "end", class: "note-chart-label" }),
    );
  });
  svg.append(svgNode("line", { x1: left, x2: RIGHT, y1: axis.zero, y2: axis.zero, class: "note-chart-base" }));
}

export interface PlotFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
}

export function axisTitles(svg: SVGElement, titles: { x?: string; y?: string }, frame: PlotFrame): void {
  if (titles.x) {
    svg.append(
      svgText(titles.x, { x: (frame.left + frame.right) / 2, y: frame.height - 6, "text-anchor": "middle", class: "note-chart-axis-title" }),
    );
  }
  if (titles.y) {
    const middle = (frame.top + frame.bottom) / 2;
    svg.append(
      svgText(titles.y, {
        x: 12,
        y: middle,
        "text-anchor": "middle",
        transform: `rotate(-90 12 ${middle})`,
        class: "note-chart-axis-title",
      }),
    );
  }
}

function shortLabel(label: string, room: number): string {
  const fits = Math.max(3, Math.floor(room / CHAR_WIDTH) - 1);
  return label.length > fits ? `${label.slice(0, fits - 1)}…` : label;
}

interface CategoryFrame {
  left: number;
  band: number;
  center: (index: number) => number;
}

function categoryFrame(left: number, count: number): CategoryFrame {
  const band = (RIGHT - left) / count;
  return { left, band, center: (index) => left + band * (index + 0.5) };
}

function categoryGroups(
  svg: SVGElement,
  plot: HTMLElement,
  data: ChartData,
  bars: Bars,
  frame: CategoryFrame,
): SVGElement[] {
  const every = Math.ceil(bars.categories.length / Math.max(1, Math.floor((RIGHT - frame.left) / 48)));
  const unit = chartType(data) === "histogram" ? "" : (data.unit ?? "");
  return bars.categories.map((category, index) => {
    const group = svgNode("g", { class: "note-chart-group" });
    group.append(
      svgNode("rect", {
        x: frame.left + frame.band * index,
        y: 0,
        width: frame.band,
        height: PLOT_BOTTOM + 32,
        class: "note-chart-hit",
      }),
    );
    if (index % every === 0) {
      group.append(
        svgText(shortLabel(category, frame.band * every), {
          x: frame.center(index),
          y: PLOT_BOTTOM + 22,
          "text-anchor": "middle",
          class: "note-chart-label",
        }),
      );
    }
    const tip = tooltipBox(category);
    bars.series.forEach((series, seriesIndex) => {
      tooltipRow(tip, colorFor(data, seriesIndex), series.name, withError(series.values[index], series.errors?.[index], unit));
    });
    hover(group, plot, tip, frame.center(index));
    svg.append(group);
    return group;
  });
}

function fixedGroupWidth(band: number, singleHistogram: boolean, stacked: boolean): number {
  if (singleHistogram) return Math.max(1, band - 1);
  return stacked ? Math.min(56, band * 0.6) : 0;
}

function drawBars(svg: SVGElement, plot: HTMLElement, data: ChartData, bars: Bars, axis: ValueAxis, left: number): void {
  const frame = categoryFrame(left, bars.categories.length);
  const groups = categoryGroups(svg, plot, data, bars, frame);
  const count = bars.series.length;
  const histogram = chartType(data) === "histogram";
  const stacked = data.stacked === true && !histogram;
  const groupWidth = fixedGroupWidth(frame.band, histogram && count === 1, stacked);
  const barWidth = groupWidth || Math.min(44, (frame.band * 0.7) / count);
  const gap = Math.min(4, (frame.band * 0.3) / count);
  bars.categories.forEach((_category, index) => {
    const center = frame.center(index);
    let up = 0;
    let down = 0;
    bars.series.forEach((series, seriesIndex) => {
      const value = series.values[index];
      let start = 0;
      let x = center - barWidth / 2;
      if (stacked) {
        start = value >= 0 ? up : down;
        if (value >= 0) up += value;
        else down += value;
      } else if (count > 1) {
        x = center + (seriesIndex - count / 2) * (barWidth + gap) + gap / 2;
      }
      const from = stacked ? axis.scale(start) : axis.zero;
      const to = axis.scale(start + value);
      groups[index].append(
        svgNode("rect", {
          x,
          y: Math.min(from, to),
          width: barWidth,
          height: Math.abs(from - to),
          rx: histogram ? 0 : 2,
          class: stacked ? "note-chart-bar note-chart-segment" : "note-chart-bar",
          style: `fill: ${colorFor(data, seriesIndex)}`,
        }),
      );
      const error = series.errors?.[index];
      if (error !== undefined) {
        errorBar(groups[index], x + barWidth / 2, axis.scale(start + value - error), axis.scale(start + value + error));
      }
    });
  });
}

function drawLines(svg: SVGElement, plot: HTMLElement, data: ChartData, bars: Bars, axis: ValueAxis, left: number): void {
  const frame = categoryFrame(left, bars.categories.length);
  categoryGroups(svg, plot, data, bars, frame);
  const area = chartType(data) === "area";
  const stacked = area && data.stacked === true;
  const lower = bars.categories.map(() => 0);
  const layer = svgNode("g", { class: "note-chart-lines" });
  bars.series.forEach((series, seriesIndex) => {
    const color = colorFor(data, seriesIndex);
    const bases = [...lower];
    const tops = series.values.map((value, index) => (stacked ? bases[index] + value : value));
    if (stacked) lower.splice(0, lower.length, ...tops);
    const line = tops.map((top, index) => `${index === 0 ? "M" : "L"}${frame.center(index)} ${axis.scale(top)}`);
    if (area) {
      const back = bases
        .map((base, index) => `L${frame.center(index)} ${stacked ? axis.scale(base) : axis.zero}`)
        .reverse();
      layer.append(
        svgNode("path", { d: `${line.join("")}${back.join("")}Z`, class: "note-chart-area", style: `fill: ${color}` }),
      );
    }
    layer.append(svgNode("path", { d: line.join(""), class: "note-chart-line", style: `stroke: ${color}` }));
    tops.forEach((top, index) => {
      const error = series.errors?.[index];
      if (error !== undefined) errorBar(layer, frame.center(index), axis.scale(top - error), axis.scale(top + error));
      layer.append(
        svgNode("circle", {
          cx: frame.center(index),
          cy: axis.scale(top),
          r: 3.5,
          class: "note-chart-marker",
          style: `fill: ${color}`,
        }),
      );
    });
  });
  svg.append(layer);
}

function drawScatter(svg: SVGElement, plot: HTMLElement, data: ChartData, axis: ValueAxis, left: number): void {
  const found: Extent = { low: Number.POSITIVE_INFINITY, high: Number.NEGATIVE_INFINITY };
  for (const series of data.series) for (const point of series.points as number[][]) grow(found, point[0]);
  const extent = found.low === found.high ? { low: found.low - 1, high: found.high + 1 } : pad(found);
  const x = scaleLinear().domain([extent.low, extent.high]).nice(6).range([left, RIGHT]);
  const { ticks, labels } = linearTicks(x, 6);
  ticks.forEach((tick, index) => {
    svg.append(svgNode("line", { x1: x(tick), x2: x(tick), y1: PLOT_TOP, y2: PLOT_BOTTOM, class: "note-chart-grid" }));
    svg.append(svgText(labels[index], { x: x(tick), y: PLOT_BOTTOM + 22, "text-anchor": "middle", class: "note-chart-label" }));
  });
  const unit = data.unit ?? "";
  data.series.forEach((series, seriesIndex) => {
    const color = colorFor(data, seriesIndex);
    (series.points as number[][]).forEach((point, index) => {
      const [px, py] = point;
      const error = point[2] ?? series.errors?.[index];
      const group = svgNode("g", { class: "note-chart-point" });
      const cx = x(px);
      const cy = axis.scale(py);
      group.append(svgNode("circle", { cx, cy, r: 9, class: "note-chart-hit" }));
      if (error !== undefined) errorBar(group, cx, axis.scale(py - error), axis.scale(py + error));
      group.append(svgNode("circle", { cx, cy, r: 4, class: "note-chart-marker", style: `fill: ${color}` }));
      const tip = tooltipBox(series.name);
      tooltipRow(tip, color, `${data.xLabel || "x"} ${px}`, withError(py, error, unit));
      hover(group, plot, tip, cx);
      svg.append(group);
    });
  });
}

interface Slice {
  name: string;
  value: number;
  color: string;
}

function slicesOf(data: ChartData): Slice[] {
  const categories = data.categories as string[];
  const values = data.series[0].values as number[];
  const items = categories.map((name, index) => ({ name, value: values[index], index }));
  if (items.length <= PALETTE_SIZE) {
    return items.map((item) => ({ name: item.name, value: item.value, color: seriesColor(item.index) }));
  }
  const kept = new Set(
    [...items]
      .sort((first, second) => second.value - first.value)
      .slice(0, PALETTE_SIZE - 1)
      .map((item) => item.index),
  );
  const slices = items
    .filter((item) => kept.has(item.index))
    .map((item, order) => ({ name: item.name, value: item.value, color: seriesColor(order) }));
  const rest = items.filter((item) => !kept.has(item.index)).reduce((sum, item) => sum + item.value, 0);
  slices.push({ name: i18n.t(($) => $.notes.blocks.charts.other), value: rest, color: seriesColor(PALETTE_SIZE - 1) });
  return slices;
}

function drawPie(svg: SVGElement, plot: HTMLElement, data: ChartData, slices: Slice[]): void {
  const cx = WIDTH / 2;
  const wedge = arc<PieArcDatum<Slice>>()
    .outerRadius(116)
    .innerRadius(chartType(data) === "donut" ? 70 : 0);
  const arcs = pie<Slice>()
    .sort(null)
    .value((slice) => slice.value)(slices);
  const unit = data.unit ?? "";
  for (const part of arcs) {
    if (part.value === 0) continue;
    const { data: slice } = part;
    const share = (part.endAngle - part.startAngle) / (2 * Math.PI);
    const group = svgNode("g", { class: "note-chart-slice", transform: `translate(${cx} ${BASE_HEIGHT / 2})` });
    group.append(
      svgNode("path", {
        d: wedge(part) ?? "",
        class: share < 1 ? "note-chart-wedge note-chart-segment" : "note-chart-wedge",
        style: `fill: ${slice.color}`,
      }),
    );
    const tip = tooltipBox(slice.name);
    tooltipRow(tip, slice.color, data.series[0].name, `${slice.value}${unit} (${formatShare(share)})`);
    hover(group, plot, tip, cx);
    svg.append(group);
  }
}

function dataRows(data: ChartData, bars: Bars | null): { head: string[]; rows: string[][] } {
  const unit = data.unit ?? "";
  const type = chartType(data);
  if (type === "scatter") {
    const errors = data.series.some(
      (series) => series.errors !== undefined || (series.points as number[][]).some((point) => point.length === 3),
    );
    const head = [i18n.t(($) => $.notes.blocks.charts.series), data.xLabel || "x", data.yLabel || "y"];
    if (errors) head.push(i18n.t(($) => $.notes.blocks.charts.error, { name: data.yLabel || "y" }));
    const rows = data.series.flatMap((series) =>
      (series.points as number[][]).map((point, index) => {
        const row = [series.name, `${point[0]}`, `${point[1]}${unit}`];
        const error = point[2] ?? series.errors?.[index];
        if (errors) row.push(error === undefined ? "" : `${error}${unit}`);
        return row;
      }),
    );
    return { head, rows };
  }
  const table = bars as Bars;
  const first =
    type === "histogram"
      ? i18n.t(($) => $.notes.blocks.charts.bin)
      : data.xLabel || i18n.t(($) => $.notes.blocks.charts.category);
  const head = [first];
  for (const series of table.series) {
    head.push(series.name);
    if (series.errors) head.push(i18n.t(($) => $.notes.blocks.charts.error, { name: series.name }));
  }
  const rows = table.categories.map((category, index) => {
    const row = [category];
    for (const series of table.series) {
      row.push(`${series.values[index]}${type === "histogram" ? "" : unit}`);
      if (series.errors) row.push(`${series.errors[index]}${unit}`);
    }
    return row;
  });
  return { head, rows };
}

function dataTable(data: ChartData, bars: Bars | null): HTMLElement {
  const table = element("table", "note-chart-table mt-2 w-full border-collapse text-[0.6875rem]");
  table.append(
    element(
      "caption",
      "mb-1 text-left font-medium text-muted-foreground",
      data.title || i18n.t(($) => $.notes.blocks.charts.caption),
    ),
  );
  const { head, rows } = dataRows(data, bars);
  const header = element("tr", "border-b border-(--note-table-line)");
  for (const [index, name] of head.entries()) {
    const cell = element("th", cn("bg-(--note-table-head) px-2 py-1 font-medium", index === 0 ? "text-left" : "text-right"), name);
    cell.setAttribute("scope", "col");
    header.append(cell);
  }
  const thead = element("thead", "");
  thead.append(header);
  const tbody = element("tbody", "");
  for (const row of rows) {
    const line = element("tr", "border-b border-(--note-table-line)");
    row.forEach((value, index) => {
      if (index === 0) {
        const cell = element("th", "px-2 py-1 text-left font-normal", value);
        cell.setAttribute("scope", "row");
        line.append(cell);
      } else {
        line.append(element("td", "note-chart-cell px-2 py-1 text-right tabular-nums", value));
      }
    });
    tbody.append(line);
  }
  table.append(thead, tbody);
  return table;
}

function dataToggle(preview: HTMLElement, chart: HTMLElement, data: ChartData, bars: Bars | null): void {
  serial += 1;
  const id = `note-chart-data-${serial}`;
  const panel = element("div", "note-chart-data overflow-x-auto");
  panel.id = id;
  panel.hidden = true;
  const button = element(
    "button",
    cn(buttonVariants({ variant: "ghost", size: "xs" }), "note-chart-data-toggle text-muted-foreground"),
    i18n.t(($) => $.notes.blocks.charts.showData),
  );
  button.type = "button";
  button.setAttribute("aria-controls", id);
  const show = (open: boolean) => {
    if (open && !panel.firstChild) panel.append(dataTable(data, bars));
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open
      ? i18n.t(($) => $.notes.blocks.charts.hideData)
      : i18n.t(($) => $.notes.blocks.charts.showData);
    if (open) openTables.add(preview);
    else openTables.delete(preview);
  };
  show(openTables.has(preview));
  button.addEventListener("click", () => show(panel.hidden !== false));
  const row = element("div", "mt-1 flex justify-end");
  row.append(button);
  chart.append(row, panel);
}

function chartMessage(problem: ChartProblem): string {
  if (problem === "invalid") return i18n.t(($) => $.notes.blocks.chartError);
  return i18n.t(($) => $.notes.blocks.charts[problem]);
}

function legendFor(data: ChartData, slices: Slice[] | null): HTMLElement | null {
  if (slices) {
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    return chartLegend(
      slices.map((slice) => ({ label: `${slice.name} ${formatShare(slice.value / total)}`, color: slice.color })),
    );
  }
  if (data.series.length < 2) return null;
  return chartLegend(data.series.map((series, index) => ({ label: series.name, color: seriesColor(index) })));
}

function barsFor(data: ChartData, type: ChartType): Bars | null {
  if (type === "scatter") return null;
  return type === "histogram" ? histogramBars(data) : categoryBars(data);
}

function drawAxisChart(svg: SVGElement, plot: HTMLElement, data: ChartData, type: ChartType, height: number): Bars | null {
  const bars = barsFor(data, type);
  const axis = axisFor(data, bars);
  const left = labelRoom(axis.labels, data.yLabel);
  valueGrid(svg, axis, left);
  axisTitles(svg, { x: data.xLabel, y: data.yLabel }, { left, right: RIGHT, top: PLOT_TOP, bottom: PLOT_BOTTOM, height });
  if (bars === null) drawScatter(svg, plot, data, axis, left);
  else if (type === "line" || type === "area") drawLines(svg, plot, data, bars, axis, left);
  else drawBars(svg, plot, data, bars, axis, left);
  return bars;
}

export function paintChart(preview: HTMLElement, source: string, context?: Partial<PaintContext>): void {
  const result = checkChart(source);
  if (!result.ok) {
    blockMessage(preview, chartMessage(result.problem));
    return;
  }
  const data = result.chart;
  const type = chartType(data);
  const round = type === "pie" || type === "donut";
  const chart = element("div", "note-chart w-full");
  if (data.title) chart.append(element("p", "note-chart-title text-sm font-semibold", data.title));
  if (data.description) chart.append(element("p", "note-chart-text text-xs text-muted-foreground", data.description));
  const plot = element("div", "note-chart-plot relative my-3");
  const height = BASE_HEIGHT + (data.xLabel && !round ? TITLE_ROOM : 0);
  const svg = svgNode("svg", { viewBox: `0 0 ${WIDTH} ${height}`, role: "img" });
  svg.setAttribute("aria-label", data.title ?? i18n.t(($) => $.notes.blocks.chart));
  let bars: Bars | null = null;
  let slices: Slice[] | null = null;
  if (round) {
    slices = slicesOf(data);
    drawPie(svg, plot, data, slices);
  } else {
    bars = drawAxisChart(svg, plot, data, type, height);
  }
  plot.append(svg);
  chart.append(plot);
  const legend = legendFor(data, slices);
  if (legend) chart.append(legend);
  if (data.note) chart.append(element("p", "note-chart-text text-xs text-muted-foreground", data.note));
  if (!context?.still) dataToggle(preview, chart, data, bars ?? (round ? categoryBars(data) : null));
  preview.replaceChildren(chart);
}

export const chartBlock: NoteBlockKind = {
  name: "chart",
  label: () => i18n.t(($) => $.notes.blocks.chart),
  icon: ChartColumn,
  interactive: true,
  paint: (preview, source, context) => {
    paintChart(preview, source, context);
    return undefined;
  },
  template: () => ({ info: "chart", source: newChartSource() }),
};
