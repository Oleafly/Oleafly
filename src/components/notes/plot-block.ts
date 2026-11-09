import { ChartSpline } from "lucide-react";
import { i18n } from "@/i18n";
import { CHAR_WIDTH, chartLegend, formatTick, niceStep, seriesColor, svgNode, ticksBetween } from "./chart-block";
import type { NoteBlockKind } from "./note-blocks";
import { compileExpression, type Evaluate, type ExpressionError } from "./plot-expr";

export type PlotProblemReason =
  | ExpressionError
  | "line"
  | "parametric"
  | "values"
  | "point"
  | "order"
  | "number"
  | "tooManyCurves"
  | "tooManyPoints"
  | "undefined";

export interface PlotProblem {
  line: number;
  reason: PlotProblemReason;
  detail?: string;
}

export type PlotCurve =
  | { kind: "function"; line: number; label: string; y: Evaluate }
  | { kind: "parametric"; line: number; label: string; x: Evaluate; y: Evaluate };

export interface PlotPoint {
  line: number;
  x: number;
  y: number;
  label?: string;
}

export interface PlotSpec {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  domain?: [number, number];
  range?: [number, number];
  t: [number, number];
  curves: PlotCurve[];
  points: PlotPoint[];
  problems: PlotProblem[];
}

export const MAX_CURVES = 8;
export const MAX_POINTS = 50;
export const SAMPLES = 600;
const DEFAULT_DOMAIN: [number, number] = [-10, 10];
const LIMIT = 1e300;
const WIDTH = 640;
const BASE_HEIGHT = 400;
const TOP = 12;
const BOTTOM = BASE_HEIGHT - 28;
const RIGHT = WIDTH - 12;
const TITLE_ROOM = 18;
const SCREEN_MIN = -4000;
const SCREEN_MAX = 4400;

const OPTION = /^(domain|range|t|labels|point|title)\s*:(.*)$/iu;
const FUNCTION_LINE = /^(y|[a-z][a-z0-9_]*\s*\(\s*x\s*\))\s*=(.*)$/iu;
const PARAMETRIC_LINE = /^x\s*=(.*)$/iu;
const Y_PART = /^\s*y\s*=(.*)$/isu;

export const PLOT_TEMPLATE = "domain: -2*pi, 2*pi\ny = sin(x)\ny = x^2/10";

interface Failure {
  ok: false;
  reason: PlotProblemReason;
  detail?: string;
}

type Outcome<T> = { ok: true; value: T } | Failure;

let serial = 0;

export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function usable(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= LIMIT;
}

function expression(text: string, variables: readonly string[]): Outcome<Evaluate> {
  const compiled = compileExpression(text.trim(), variables);
  if (compiled.ok) return { ok: true, value: compiled.evaluate };
  return compiled.detail === undefined
    ? { ok: false, reason: compiled.error }
    : { ok: false, reason: compiled.error, detail: compiled.detail };
}

function constantValue(text: string): Outcome<number> {
  const compiled = expression(text, []);
  if (!compiled.ok) return compiled;
  const value = compiled.value({});
  return usable(value) ? { ok: true, value } : { ok: false, reason: "number" };
}

function interval(text: string): Outcome<[number, number]> {
  const parts = splitTopLevel(text);
  if (parts.length !== 2) return { ok: false, reason: "values" };
  const first = constantValue(parts[0]);
  if (!first.ok) return first;
  const second = constantValue(parts[1]);
  if (!second.ok) return second;
  if (first.value === second.value) return { ok: false, reason: "order" };
  return {
    ok: true,
    value: first.value < second.value ? [first.value, second.value] : [second.value, first.value],
  };
}

function readPoint(spec: PlotSpec, value: string, line: number): Failure | null {
  if (spec.points.length >= MAX_POINTS) return { ok: false, reason: "tooManyPoints" };
  const parts = splitTopLevel(value);
  if (parts.length < 2) return { ok: false, reason: "point" };
  const x = constantValue(parts[0]);
  if (!x.ok) return x;
  const y = constantValue(parts[1]);
  if (!y.ok) return y;
  const label = parts.slice(2).join(",").trim();
  spec.points.push(label ? { line, x: x.value, y: y.value, label } : { line, x: x.value, y: y.value });
  return null;
}

function readOption(spec: PlotSpec, key: string, value: string, line: number): Failure | null {
  if (key === "title") {
    spec.title = value || undefined;
    return null;
  }
  if (key === "labels") {
    const [x, ...y] = splitTopLevel(value);
    spec.xLabel = x.trim() || undefined;
    spec.yLabel = y.join(",").trim() || undefined;
    return null;
  }
  if (key === "point") return readPoint(spec, value, line);
  const range = interval(value);
  if (!range.ok) return range;
  if (key === "domain") spec.domain = range.value;
  else if (key === "range") spec.range = range.value;
  else spec.t = range.value;
  return null;
}

function readParametric(spec: PlotSpec, rest: string, text: string, line: number): Failure | null {
  const parts = splitTopLevel(rest);
  const index = parts.findIndex((part, position) => position > 0 && Y_PART.test(part));
  if (index < 0) return { ok: false, reason: "parametric" };
  if (spec.curves.length >= MAX_CURVES) return { ok: false, reason: "tooManyCurves" };
  const x = expression(parts.slice(0, index).join(","), ["t"]);
  if (!x.ok) return x;
  const yText = [(Y_PART.exec(parts[index]) as RegExpExecArray)[1], ...parts.slice(index + 1)].join(",");
  const y = expression(yText, ["t"]);
  if (!y.ok) return y;
  spec.curves.push({ kind: "parametric", line, label: text, x: x.value, y: y.value });
  return null;
}

function readLine(spec: PlotSpec, text: string, line: number): Failure | null {
  const option = OPTION.exec(text);
  if (option) return readOption(spec, option[1].toLowerCase(), option[2].trim(), line);
  const graph = FUNCTION_LINE.exec(text);
  if (graph) {
    if (spec.curves.length >= MAX_CURVES) return { ok: false, reason: "tooManyCurves" };
    const y = expression(graph[2], ["x"]);
    if (!y.ok) return y;
    spec.curves.push({ kind: "function", line, label: text, y: y.value });
    return null;
  }
  const parametric = PARAMETRIC_LINE.exec(text);
  if (parametric) return readParametric(spec, parametric[1], text, line);
  return { ok: false, reason: "line" };
}

export function parsePlot(source: string): PlotSpec {
  const spec: PlotSpec = { t: [0, 2 * Math.PI], curves: [], points: [], problems: [] };
  source.split(/\r?\n/u).forEach((raw, index) => {
    const text = raw.trim();
    if (!text || text.startsWith("#")) return;
    const failure = readLine(spec, text, index + 1);
    if (!failure) return;
    spec.problems.push(
      failure.detail === undefined
        ? { line: index + 1, reason: failure.reason }
        : { line: index + 1, reason: failure.reason, detail: failure.detail },
    );
  });
  return spec;
}

export interface Sample {
  xs: Float64Array;
  ys: Float64Array;
}

export function sampleCurve(curve: PlotCurve, domain: readonly [number, number], t: readonly [number, number]): Sample {
  const xs = new Float64Array(SAMPLES + 1);
  const ys = new Float64Array(SAMPLES + 1);
  if (curve.kind === "function") {
    const scope = { x: 0 };
    for (let index = 0; index <= SAMPLES; index += 1) {
      scope.x = domain[0] + ((domain[1] - domain[0]) * index) / SAMPLES;
      xs[index] = scope.x;
      ys[index] = curve.y(scope);
    }
  } else {
    const scope = { t: 0 };
    for (let index = 0; index <= SAMPLES; index += 1) {
      scope.t = t[0] + ((t[1] - t[0]) * index) / SAMPLES;
      xs[index] = curve.x(scope);
      ys[index] = curve.y(scope);
    }
  }
  return { xs, ys };
}

function quantile(sorted: Float64Array, share: number): number {
  return sorted[Math.round((sorted.length - 1) * share)];
}

function edgeExtreme(values: Float64Array, outside: (value: number) => boolean, pick: (a: number, b: number) => number): number | null {
  let extreme: number | null = null;
  for (let index = 0; index < values.length && usable(values[index]) && outside(values[index]); index += 1) {
    extreme = extreme === null ? values[index] : pick(extreme, values[index]);
  }
  for (let index = values.length - 1; index >= 0 && usable(values[index]) && outside(values[index]); index -= 1) {
    extreme = extreme === null ? values[index] : pick(extreme, values[index]);
  }
  return extreme;
}

export function robustRange(series: readonly Float64Array[], extras: readonly number[]): [number, number] | null {
  const values: number[] = [];
  for (const items of series) for (const value of items) if (usable(value)) values.push(value);
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  if (values.length > 0) {
    const sorted = Float64Array.from(values).sort();
    const lower = quantile(sorted, 0.05);
    const upper = quantile(sorted, 0.95);
    const spread = upper - lower;
    const clipLow = lower - spread;
    const clipHigh = upper + spread;
    low = Math.max(sorted[0], clipLow);
    high = Math.min(sorted[sorted.length - 1], clipHigh);
    const room = spread * 1000;
    for (const items of series) {
      const top = edgeExtreme(items, (value) => value > clipHigh, Math.max);
      if (top !== null && top - upper <= room) high = Math.max(high, top);
      const bottom = edgeExtreme(items, (value) => value < clipLow, Math.min);
      if (bottom !== null && lower - bottom <= room) low = Math.min(low, bottom);
    }
  }
  for (const value of extras) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return low <= high ? [low, high] : null;
}

function padded(range: [number, number] | null): [number, number] {
  if (!range) return [-1, 1];
  const [low, high] = range;
  if (low === high) {
    const pad = Math.max(1, Math.abs(low) * 0.1);
    return [low - pad, high + pad];
  }
  const pad = (high - low) * 0.05;
  return [low - pad, high + pad];
}

function jump(values: Float64Array, index: number, span: number): boolean {
  const step = values[index + 1] - values[index];
  if (Math.abs(step) <= span / 2) return false;
  const before = index > 0 ? values[index] - values[index - 1] : Number.NaN;
  const after = index + 2 < values.length ? values[index + 2] - values[index + 1] : Number.NaN;
  const known = [before, after].filter(Number.isFinite);
  return known.every((change) => Math.sign(change) !== Math.sign(step));
}

function screen(value: number): number {
  return Math.round(Math.min(SCREEN_MAX, Math.max(SCREEN_MIN, value)) * 100) / 100;
}

export interface View {
  x: [number, number];
  y: [number, number];
}

export function curvePath(sample: Sample, view: View, toX: (x: number) => number, toY: (y: number) => number): string {
  const { xs, ys } = sample;
  const width = view.x[1] - view.x[0];
  const height = view.y[1] - view.y[0];
  const parts: string[] = [];
  let drawing = false;
  for (let index = 0; index < xs.length; index += 1) {
    if (!usable(xs[index]) || !usable(ys[index])) {
      drawing = false;
      continue;
    }
    if (drawing && (jump(ys, index - 1, height) || jump(xs, index - 1, width))) drawing = false;
    parts.push(`${drawing ? "L" : "M"}${screen(toX(xs[index]))} ${screen(toY(ys[index]))}`);
    drawing = true;
  }
  return parts.join("");
}

interface Drawn {
  curve: PlotCurve;
  sample: Sample;
  color: string;
}

function hasValues(sample: Sample): boolean {
  for (let index = 0; index < sample.xs.length; index += 1) {
    if (usable(sample.xs[index]) && usable(sample.ys[index])) return true;
  }
  return false;
}

export function plotView(spec: PlotSpec): { view: View; samples: Map<PlotCurve, Sample> } {
  const samples = new Map<PlotCurve, Sample>();
  const parametric = spec.curves.filter((curve) => curve.kind === "parametric");
  for (const curve of parametric) samples.set(curve, sampleCurve(curve, DEFAULT_DOMAIN, spec.t));
  const pointXs = spec.points.map((point) => point.x);
  const functions = spec.curves.some((curve) => curve.kind === "function");
  let x = spec.domain;
  if (!x) {
    const found = robustRange(
      parametric.map((curve) => (samples.get(curve) as Sample).xs),
      pointXs,
    );
    if (!functions) x = padded(found);
    else if (!found || (found[0] >= DEFAULT_DOMAIN[0] && found[1] <= DEFAULT_DOMAIN[1])) x = DEFAULT_DOMAIN;
    else x = padded([Math.min(found[0], DEFAULT_DOMAIN[0]), Math.max(found[1], DEFAULT_DOMAIN[1])]);
  }
  for (const curve of spec.curves) {
    if (curve.kind === "function") samples.set(curve, sampleCurve(curve, x, spec.t));
  }
  const y =
    spec.range ??
    padded(
      robustRange(
        [...samples.values()].map((sample) => sample.ys),
        spec.points.map((point) => point.y),
      ),
    );
  return { view: { x, y }, samples };
}

function problemText(problem: PlotProblem): string {
  const reason = i18n.t(($) => $.notes.blocks.plot.errors[problem.reason], { name: problem.detail ?? "" });
  return i18n.t(($) => $.notes.blocks.plot.problem, { line: problem.line, reason });
}

function problemList(problems: readonly PlotProblem[]): HTMLElement {
  const list = document.createElement("ul");
  list.className = "note-plot-problems mt-2 space-y-0.5 text-xs text-muted-foreground";
  for (const problem of problems) {
    const item = document.createElement("li");
    item.textContent = problemText(problem);
    list.append(item);
  }
  return list;
}

function svgText(text: string, attributes: Record<string, string | number>): SVGElement {
  const node = svgNode("text", attributes);
  node.textContent = text;
  return node;
}

function drawAxes(svg: SVGElement, view: View, left: number, bottom: number, toX: (x: number) => number, toY: (y: number) => number): void {
  const xStep = niceStep(view.x[1] - view.x[0], 8);
  const yStep = niceStep(view.y[1] - view.y[0], 6);
  for (const tick of ticksBetween(view.x[0], view.x[1], xStep)) {
    const x = toX(tick);
    svg.append(svgNode("line", { x1: x, x2: x, y1: TOP, y2: bottom, class: "note-plot-grid" }));
    svg.append(svgText(formatTick(tick, xStep), { x, y: bottom + 16, "text-anchor": "middle", class: "note-chart-label" }));
  }
  for (const tick of ticksBetween(view.y[0], view.y[1], yStep)) {
    const y = toY(tick);
    svg.append(svgNode("line", { x1: left, x2: RIGHT, y1: y, y2: y, class: "note-plot-grid" }));
    svg.append(svgText(formatTick(tick, yStep), { x: left - 6, y: y + 3.5, "text-anchor": "end", class: "note-chart-label" }));
  }
  svg.append(svgNode("rect", { x: left, y: TOP, width: RIGHT - left, height: bottom - TOP, class: "note-plot-frame" }));
  if (view.y[0] <= 0 && view.y[1] >= 0) {
    svg.append(svgNode("line", { x1: left, x2: RIGHT, y1: toY(0), y2: toY(0), class: "note-plot-axis" }));
  }
  if (view.x[0] <= 0 && view.x[1] >= 0) {
    svg.append(svgNode("line", { x1: toX(0), x2: toX(0), y1: TOP, y2: bottom, class: "note-plot-axis" }));
  }
}

function yTickWidth(view: View): number {
  const step = niceStep(view.y[1] - view.y[0], 6);
  const longest = Math.max(1, ...ticksBetween(view.y[0], view.y[1], step).map((tick) => formatTick(tick, step).length));
  return Math.max(28, Math.ceil(10 + CHAR_WIDTH * longest));
}

function drawPlot(spec: PlotSpec, drawn: Drawn[], view: View): SVGElement {
  const height = BASE_HEIGHT + (spec.xLabel ? TITLE_ROOM : 0);
  const left = yTickWidth(view) + (spec.yLabel ? TITLE_ROOM : 0);
  const toX = (x: number) => left + ((x - view.x[0]) / (view.x[1] - view.x[0])) * (RIGHT - left);
  const toY = (y: number) => BOTTOM - ((y - view.y[0]) / (view.y[1] - view.y[0])) * (BOTTOM - TOP);
  const svg = svgNode("svg", { viewBox: `0 0 ${WIDTH} ${height}`, role: "img", class: "note-plot-svg block w-full" });
  const labels = drawn.map((item) => item.curve.label);
  svg.setAttribute(
    "aria-label",
    spec.title ??
      (labels.length ? i18n.t(($) => $.notes.blocks.plot.aria, { curves: labels.join("; ") }) : i18n.t(($) => $.notes.blocks.plot.label)),
  );
  drawAxes(svg, view, left, BOTTOM, toX, toY);
  serial += 1;
  const clipId = `note-plot-clip-${serial}`;
  const defs = svgNode("defs", {});
  const clip = svgNode("clipPath", { id: clipId });
  clip.append(svgNode("rect", { x: left, y: TOP, width: RIGHT - left, height: BOTTOM - TOP }));
  defs.append(clip);
  svg.prepend(defs);
  const layer = svgNode("g", { "clip-path": `url(#${clipId})` });
  for (const item of drawn) {
    layer.append(
      svgNode("path", {
        d: curvePath(item.sample, view, toX, toY),
        class: "note-plot-curve",
        style: `stroke: ${item.color}`,
      }),
    );
  }
  for (const point of spec.points) {
    const cx = toX(point.x);
    const cy = toY(point.y);
    layer.append(svgNode("circle", { cx, cy, r: 4, class: "note-plot-point" }));
    if (point.label) {
      layer.append(svgText(point.label, { x: cx + 7, y: cy - 7, class: "note-plot-point-label" }));
    }
  }
  svg.append(layer);
  if (spec.xLabel) {
    svg.append(svgText(spec.xLabel, { x: (left + RIGHT) / 2, y: height - 6, "text-anchor": "middle", class: "note-chart-axis-title" }));
  }
  if (spec.yLabel) {
    const middle = (TOP + BOTTOM) / 2;
    svg.append(
      svgText(spec.yLabel, {
        x: 12,
        y: middle,
        "text-anchor": "middle",
        transform: `rotate(-90 12 ${middle})`,
        class: "note-chart-axis-title",
      }),
    );
  }
  return svg;
}

export function paintPlot(preview: HTMLElement, source: string): undefined {
  const spec = parsePlot(source);
  const root = document.createElement("div");
  root.className = "note-plot w-full min-w-0";
  const { view, samples } = plotView(spec);
  const problems = [...spec.problems];
  const drawn: Drawn[] = [];
  for (const curve of spec.curves) {
    const sample = samples.get(curve) as Sample;
    if (hasValues(sample)) drawn.push({ curve, sample, color: seriesColor(drawn.length) });
    else problems.push({ line: curve.line, reason: "undefined" });
  }
  problems.sort((first, second) => first.line - second.line);
  if (drawn.length === 0 && spec.points.length === 0) {
    const message = document.createElement("p");
    message.className = "note-drawn-empty";
    message.textContent = i18n.t(($) => $.notes.blocks.plot.empty);
    root.append(message);
  } else {
    if (spec.title) {
      const title = document.createElement("p");
      title.className = "note-plot-title text-sm font-semibold";
      title.textContent = spec.title;
      root.append(title);
    }
    root.append(drawPlot(spec, drawn, view));
    if (drawn.length > 1) {
      root.append(chartLegend(drawn.map((item) => ({ label: item.curve.label, color: item.color }))));
    }
  }
  if (problems.length) root.append(problemList(problems));
  preview.replaceChildren(root);
  return undefined;
}

export const plotBlock: NoteBlockKind = {
  name: "plot",
  label: () => i18n.t(($) => $.notes.blocks.plot.label),
  icon: ChartSpline,
  paint: paintPlot,
  template: () => ({ info: "plot", source: PLOT_TEMPLATE }),
};
