import { bytesToBase64 } from "./figure";
import { FIGURE_GRID_MARKER } from "./figure-grid-marker";

export type FigureGridWidth = "column" | "page";
export type FigureGridZoomPlacement = "right" | "below";

export interface FigureGridImage {
  path: string;
  aspect: number;
}

export interface FigureGridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FigureGridZoom {
  rect: FigureGridRect;
  placement: FigureGridZoomPlacement;
  color: string;
}

export interface FigureGridSpec {
  images: FigureGridImage[][];
  columnLabels: string[];
  rowLabels: string[];
  zoom?: FigureGridZoom;
  width: FigureGridWidth;
  caption: string;
  label: string;
}

export interface FigureGridSource {
  source: string;
  packages: string[];
}

export interface FigureGridMatch {
  from: number;
  to: number;
  spec: FigureGridSpec;
}


const MIN_ZOOM = 0.05;

const ROW_WIDTH = 0.99;
const GAP = 0.01;
const LABEL_WIDTH = 0.04;
const COLOR = /^[A-Za-z]+(?:!\d+(?:\.\d+)?(?:![A-Za-z]+)?)*$/u;
const MARKER = new RegExp(String.raw`%[ \t]*${FIGURE_GRID_MARKER}:[ \t]*([A-Za-z0-9_-]+)`, "u");
const GRID_BEGIN = new RegExp(
  String.raw`\\begin\{(figure\*?)\}(?:\[[^\]\n]*\])?[ \t]*\r?\n[ \t]*%[ \t]*${FIGURE_GRID_MARKER}:`,
  "gu",
);

interface GridLayout {
  unit: string;
  cell: number;
  columns: number;
  rowLabels: boolean;
  graphicsPath: (projectPath: string) => string;
}

interface ZoomGeometry {
  imageWidth: number;
  insetWidth: number;
  insetHeight: number;
  originX: number;
  originY: number;
  bottom: number;
  top: number;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function floor4(value: number): number {
  return Math.floor(value * 10000) / 10000;
}

function decimal(value: number): string {
  return String(round4(value) + 0);
}

function filled(labels: readonly string[]): boolean {
  return labels.some((label) => label.trim() !== "");
}

export function figureGridColumns(spec: Pick<FigureGridSpec, "images">): number {
  return Math.max(1, ...spec.images.map((row) => row.length));
}

function cellWidth(spec: FigureGridSpec): number {
  const columns = figureGridColumns(spec);
  const labels = filled(spec.rowLabels) ? LABEL_WIDTH + GAP : 0;
  return floor4((ROW_WIDTH - labels - (columns - 1) * GAP) / columns);
}

export function figureGridRect(
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): FigureGridRect {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const span = (a: number, b: number): [number, number] => {
    const from = clamp(Math.min(a, b));
    const size = round4(Math.max(MIN_ZOOM, clamp(Math.max(a, b)) - from));
    return [round4(Math.min(from, round4(1 - size))), size];
  };
  const [x, w] = span(start.x, end.x);
  const [y, h] = span(start.y, end.y);
  return { x, y, w, h };
}

function zoomGeometry(cell: number, aspect: number, zoom: FigureGridZoom): ZoomGeometry {
  const { w, h } = zoom.rect;
  const ratio = Math.min(1, w / h);
  if (zoom.placement === "right") {
    const imageWidth = floor4((cell - GAP) / (1 + ratio));
    const insetWidth = cell - GAP - imageWidth;
    const insetHeight = (h * insetWidth) / (w * aspect);
    return {
      imageWidth,
      insetWidth,
      insetHeight,
      originX: imageWidth + GAP,
      originY: Math.max(0, imageWidth / aspect - insetHeight),
      bottom: 0,
      top: imageWidth / aspect,
    };
  }
  const insetWidth = cell * ratio;
  const insetHeight = (h * insetWidth) / (w * aspect);
  return {
    imageWidth: cell,
    insetWidth,
    insetHeight,
    originX: (cell - insetWidth) / 2,
    originY: -(GAP + insetHeight),
    bottom: -(GAP + insetHeight),
    top: cell / aspect,
  };
}

function cellHeight(cell: number, image: FigureGridImage, zoom: FigureGridZoom | undefined): number {
  if (!zoom) return cell / image.aspect;
  const geometry = zoomGeometry(cell, image.aspect, zoom);
  return geometry.top - geometry.bottom;
}

function zoomCell(path: string, image: FigureGridImage, cell: number, zoom: FigureGridZoom, unit: string): string[] {
  const g = zoomGeometry(cell, image.aspect, zoom);
  const { x, y, w, h } = zoom.rect;
  const length = (value: number) => (decimal(value) === "0" ? "0" : `${decimal(value)}${unit}`);
  const point = (px: number, py: number) => `(${length(px)},${length(py)})`;
  const fullWidth = g.insetWidth / w;
  const fullHeight = fullWidth / image.aspect;
  const draw = String.raw`\draw[${zoom.color},thick]`;
  const inset = `${point(g.originX, g.originY)} rectangle ++${point(g.insetWidth, g.insetHeight)}`;
  const copyAt = point(g.originX - x * fullWidth, g.originY - (1 - y - h) * fullHeight);
  return [
    String.raw`\begin{tikzpicture}`,
    String.raw`  \useasboundingbox ${point(0, g.bottom)} rectangle ${point(cell, g.top)};`,
    String.raw`  \node[anchor=south west,inner sep=0] (img) at (0,0) {\includegraphics[width=${length(g.imageWidth)}]{${path}}};`,
    String.raw`  \begin{scope}[x={(img.south east)},y={(img.north west)}]`,
    `    ${draw} (${decimal(x)},${decimal(1 - y - h)}) rectangle (${decimal(x + w)},${decimal(1 - y)});`,
    String.raw`  \end{scope}`,
    String.raw`  \begin{scope}`,
    String.raw`    \clip ${inset};`,
    String.raw`    \node[anchor=south west,inner sep=0] at ${copyAt} {\includegraphics[width=${length(fullWidth)}]{${path}}};`,
    String.raw`  \end{scope}`,
    `  ${draw} ${inset};`,
    String.raw`\end{tikzpicture}`,
  ];
}

function joinCells(cells: readonly string[][], unit: string): string[] {
  const lines: string[] = [];
  cells.forEach((cell, index) => {
    const tail = index < cells.length - 1 ? String.raw`\hspace{${decimal(GAP)}${unit}}%` : "";
    lines.push(...cell.slice(0, -1), `${cell.at(-1) ?? ""}${tail}`);
  });
  return lines;
}

function rowLines(spec: FigureGridSpec, row: readonly FigureGridImage[], index: number, layout: GridLayout): string[] {
  const { unit, cell, columns, rowLabels } = layout;
  const cells: string[][] = [];
  if (rowLabels) {
    const height = Math.max(0, ...row.map((image) => cellHeight(cell, image, spec.zoom)));
    const text = spec.rowLabels[index]?.trim() ?? "";
    cells.push([
      String.raw`\makebox[${decimal(LABEL_WIDTH)}${unit}]{\rotatebox{90}{\makebox[${decimal(height)}${unit}]{\footnotesize ${text}}}}`,
    ]);
  }
  for (const image of row) {
    const path = layout.graphicsPath(image.path);
    cells.push(
      spec.zoom
        ? zoomCell(path, image, cell, spec.zoom, unit)
        : [String.raw`\includegraphics[width=${decimal(cell)}${unit}]{${path}}`],
    );
  }
  for (let missing = row.length; missing < columns; missing += 1) {
    cells.push([String.raw`\makebox[${decimal(cell)}${unit}]{}`]);
  }
  return joinCells(cells, unit);
}

function headerLines(spec: FigureGridSpec, layout: GridLayout): string[] {
  const { unit, cell, columns } = layout;
  const cells: string[][] = [];
  if (layout.rowLabels) cells.push([String.raw`\makebox[${decimal(LABEL_WIDTH)}${unit}]{}`]);
  for (let column = 0; column < columns; column += 1) {
    const text = spec.columnLabels[column]?.trim() ?? "";
    const label = text === "" ? "" : String.raw`\footnotesize ${text}`;
    cells.push([String.raw`\makebox[${decimal(cell)}${unit}]{${label}}`]);
  }
  return joinCells(cells, unit);
}

function encodeMarker(spec: FigureGridSpec): string {
  const base64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(spec)));
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeMarker(payload: string): unknown {
  try {
    const binary = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFraction(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function parseImage(value: unknown): FigureGridImage | null {
  if (!isRecord(value) || typeof value.path !== "string" || value.path === "") return null;
  const { aspect } = value;
  if (typeof aspect !== "number" || !Number.isFinite(aspect) || aspect <= 0) return null;
  return { path: value.path, aspect };
}

function parseRect(value: unknown): FigureGridRect | null {
  if (!isRecord(value)) return null;
  const { x, y, w, h } = value;
  if (!isFraction(x) || !isFraction(y) || !isFraction(w) || !isFraction(h)) return null;
  if (w < MIN_ZOOM || h < MIN_ZOOM || x + w > 1.000001 || y + h > 1.000001) return null;
  return { x, y, w, h };
}

function parseZoom(value: unknown): FigureGridZoom | null {
  if (!isRecord(value)) return null;
  const rect = parseRect(value.rect);
  const { placement, color } = value;
  if (!rect || (placement !== "right" && placement !== "below")) return null;
  if (typeof color !== "string" || !COLOR.test(color)) return null;
  return { rect, placement, color };
}

function parseFigureGridSpec(value: unknown): FigureGridSpec | null {
  if (!isRecord(value) || !Array.isArray(value.images)) return null;
  const images: FigureGridImage[][] = [];
  for (const row of value.images) {
    if (!Array.isArray(row)) return null;
    const parsed = row.map(parseImage);
    if (parsed.includes(null)) return null;
    images.push(parsed as FigureGridImage[]);
  }
  const { columnLabels, rowLabels, width, caption, label } = value;
  if (!isStrings(columnLabels) || !isStrings(rowLabels)) return null;
  if (width !== "column" && width !== "page") return null;
  if (typeof caption !== "string" || typeof label !== "string") return null;
  const spec: FigureGridSpec = { images, columnLabels, rowLabels, width, caption, label };
  if (value.zoom === undefined) return spec;
  const zoom = parseZoom(value.zoom);
  return zoom ? { ...spec, zoom } : null;
}

export function readFigureGridMarker(source: string): FigureGridSpec | null {
  const payload = MARKER.exec(source)?.[1];
  return payload ? parseFigureGridSpec(decodeMarker(payload)) : null;
}

export function figureGridAt(source: string, pos: number): FigureGridMatch | null {
  for (const match of source.matchAll(GRID_BEGIN)) {
    if (match.index > pos) return null;
    const close = String.raw`\end{${match[1]}}`;
    const end = source.indexOf(close, match.index + match[0].length);
    if (end < 0) return null;
    const to = end + close.length;
    if (pos > to) continue;
    const spec = readFigureGridMarker(source.slice(match.index, to));
    return spec ? { from: match.index, to, spec } : null;
  }
  return null;
}

export function figureGridSource(
  spec: FigureGridSpec,
  graphicsPath: (projectPath: string) => string,
): FigureGridSource {
  const environment = spec.width === "page" ? "figure*" : "figure";
  const layout: GridLayout = {
    unit: spec.width === "page" ? String.raw`\textwidth` : String.raw`\linewidth`,
    cell: cellWidth(spec),
    columns: figureGridColumns(spec),
    rowLabels: filled(spec.rowLabels),
    graphicsPath,
  };
  const body: string[] = [`% ${FIGURE_GRID_MARKER}: ${encodeMarker(spec)}`, String.raw`\centering`];
  if (filled(spec.columnLabels)) {
    const header = headerLines(spec, layout);
    body.push(...header.slice(0, -1), String.raw`${header.at(-1)}\\`);
  }
  spec.images.forEach((row, index) => {
    const lines = rowLines(spec, row, index, layout);
    const last = index === spec.images.length - 1;
    const end = lines.at(-1) ?? "";
    body.push(...lines.slice(0, -1), last ? end : String.raw`${end}\\[${decimal(GAP)}${layout.unit}]`);
  });
  if (spec.caption.trim() !== "") body.push(String.raw`\caption{${spec.caption.trim()}}`);
  if (spec.label.trim() !== "") body.push(String.raw`\label{${spec.label.trim()}}`);
  const source = [
    String.raw`\begin{${environment}}[t]`,
    ...body.map((line) => `  ${line}`),
    String.raw`\end{${environment}}`,
  ].join("\n");
  return { source, packages: spec.zoom ? ["graphicx", "tikz"] : ["graphicx"] };
}
