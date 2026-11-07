import { i18n } from "@/i18n";

interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  title?: string;
  description?: string;
  note?: string;
  unit?: string;
  categories: string[];
  series: ChartSeries[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SERIES_OPACITY = [1, 0.65, 0.4, 0.25, 0.15];
const WIDTH = 640;
const HEIGHT = 280;
const PLOT_BOTTOM = 248;
const PLOT_TOP = 12;

function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

export function parseChart(source: string): ChartData | null {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const chart = data as Partial<ChartData>;
  const categories = chart.categories;
  const series = chart.series;
  if (!Array.isArray(categories) || categories.length === 0) return null;
  if (!categories.every((category) => typeof category === "string")) return null;
  if (!Array.isArray(series) || series.length === 0) return null;
  const seriesValid = series.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof item.name === "string" &&
      Array.isArray(item.values) &&
      item.values.length === categories.length &&
      item.values.every((value) => typeof value === "number" && Number.isFinite(value)),
  );
  if (!seriesValid) return null;
  if (![chart.title, chart.description, chart.note, chart.unit].every(optionalText)) return null;
  return chart as ChartData;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function svgNode(tag: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function seriesOpacity(index: number): number {
  return SERIES_OPACITY[index % SERIES_OPACITY.length];
}

function tooltip(data: ChartData, index: number): HTMLElement {
  const box = element(
    "div",
    "note-chart-tooltip pointer-events-none absolute top-0 z-10 min-w-32 rounded-md border bg-popover px-2 py-1 text-[0.6875rem] text-popover-foreground shadow-md",
  );
  box.append(element("p", "note-chart-tooltip-title", data.categories[index]));
  data.series.forEach((series, seriesIndex) => {
    const row = element("p", "note-chart-tooltip-row");
    const swatch = element("span", "note-chart-swatch bg-primary");
    swatch.style.opacity = String(seriesOpacity(seriesIndex));
    const value = element("span", "note-chart-value", `${series.values[index]}${data.unit ?? ""}`);
    row.append(swatch, element("span", "", series.name), value);
    box.append(row);
  });
  return box;
}

export function chartScale(data: ChartData): (value: number) => number {
  const values = data.series.flatMap((series) => series.values);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high - low || 1;
  return (value) => PLOT_BOTTOM - ((value - low) / span) * (PLOT_BOTTOM - PLOT_TOP);
}

function drawBars(svg: SVGElement, data: ChartData, plot: HTMLElement): void {
  const scale = chartScale(data);
  const zero = scale(0);
  const groupWidth = WIDTH / data.categories.length;
  const barWidth = Math.min(44, (groupWidth * 0.7) / data.series.length);
  for (let line = 0; line <= 4; line++) {
    const y = PLOT_TOP + ((PLOT_BOTTOM - PLOT_TOP) * line) / 4;
    svg.append(svgNode("line", { x1: 0, x2: WIDTH, y1: y, y2: y, class: "note-chart-grid" }));
  }
  svg.append(svgNode("line", { x1: 0, x2: WIDTH, y1: zero, y2: zero, class: "note-chart-base" }));
  data.categories.forEach((category, index) => {
    const group = svgNode("g", { class: "note-chart-group" });
    const center = groupWidth * index + groupWidth / 2;
    group.append(
      svgNode("rect", {
        x: groupWidth * index,
        y: 0,
        width: groupWidth,
        height: HEIGHT,
        class: "note-chart-hit",
      }),
    );
    data.series.forEach((series, seriesIndex) => {
      const top = scale(series.values[index]);
      const offset = (seriesIndex - data.series.length / 2) * (barWidth + 4) + 2;
      group.append(
        svgNode("rect", {
          x: center + offset,
          y: Math.min(top, zero),
          width: barWidth,
          height: Math.abs(zero - top),
          rx: 2,
          class: "fill-primary",
          "fill-opacity": seriesOpacity(seriesIndex),
        }),
      );
    });
    const label = svgNode("text", {
      x: center,
      y: HEIGHT - 10,
      "text-anchor": "middle",
      class: "note-chart-label",
    });
    label.textContent = category;
    group.append(label);
    const tip = tooltip(data, index);
    tip.style.left = `${(center / WIDTH) * 100}%`;
    group.addEventListener("pointerenter", () => plot.append(tip));
    group.addEventListener("pointerleave", () => tip.remove());
    svg.append(group);
  });
}

export function paintChart(preview: HTMLElement, source: string): void {
  const data = parseChart(source);
  if (!data) {
    const message = element("p", "note-drawn-empty", i18n.t(($) => $.notes.blocks.chartError));
    preview.replaceChildren(message);
    return;
  }
  const chart = element("div", "note-chart");
  if (data.title) chart.append(element("p", "note-chart-title", data.title));
  if (data.description) chart.append(element("p", "note-chart-text", data.description));
  const plot = element("div", "note-chart-plot");
  const svg = svgNode("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: "img" });
  svg.setAttribute("aria-label", data.title ?? i18n.t(($) => $.notes.blocks.chart));
  drawBars(svg, data, plot);
  plot.append(svg);
  chart.append(plot);
  if (data.note) chart.append(element("p", "note-chart-text", data.note));
  preview.replaceChildren(chart);
}
