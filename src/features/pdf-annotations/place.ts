import type { PdfTextRun, SynctexRect } from "@oleafly/preview";
import type { PdfAnnotation, PdfAnnotationBox, PdfAnnotationQuote, PdfAnnotationUpdate } from "@/lib/tauri";
import { followSource } from "./model";

export interface PlaceDeps {
  textOf: (path: string) => string | null;
  linesOf: (path: string, startLine: number, endLine: number) => Promise<SynctexRect[] | null>;
  runsOf: (page: number) => Promise<PdfTextRun[] | null>;
  findQuote: (page: number, runs: readonly PdfTextRun[], quote: PdfAnnotationQuote, near?: { y: number }) => SynctexRect[] | null;
}

function box(rect: SynctexRect): PdfAnnotationBox {
  return { page: rect.page, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function bounds(rects: readonly SynctexRect[]): PdfAnnotationBox {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { page: rects[0]?.page ?? 1, x: left, y: top, width: right - left, height: bottom - top };
}

function lost(annotation: PdfAnnotation, build: string): PdfAnnotationUpdate {
  return { id: annotation.id, build, boxes: [], status: "needsPlacing" };
}

function placed(
  annotation: PdfAnnotation,
  build: string,
  boxes: PdfAnnotationBox[],
  source: PdfAnnotation["source"],
): PdfAnnotationUpdate {
  const status = annotation.status === "needsPlacing" ? "draft" : annotation.status;
  return { id: annotation.id, build, boxes, page: boxes[0]?.page ?? annotation.page, source, status };
}

export async function placeAnnotation(
  annotation: PdfAnnotation,
  build: string,
  deps: PlaceDeps,
  pageRuns: Map<number, Promise<PdfTextRun[] | null>> = new Map(),
): Promise<PdfAnnotationUpdate> {
  const stored = annotation.source;
  if (!stored) return lost(annotation, build);
  const text = deps.textOf(stored.path);
  const source = text === null ? stored : followSource(stored, text);
  if (!source) return lost(annotation, build);
  const lines = await deps.linesOf(source.path, source.startLine, source.endLine);
  if (!lines?.length) return lost(annotation, build);
  const first = lines[0];
  const onLines = () =>
    placed(annotation, build, first ? [bounds(lines.filter((line) => line.page === first.page))] : [], source);
  if (annotation.kind === "region" || !annotation.quote.text.trim()) return onLines();
  const pages = [...new Set(lines.map((line) => line.page))];
  for (const page of pages) {
    let runs = pageRuns.get(page);
    if (!runs) {
      runs = deps.runsOf(page);
      pageRuns.set(page, runs);
    }
    const loaded = await runs;
    if (!loaded) continue;
    const near = lines.find((line) => line.page === page);
    const found = deps.findQuote(page, loaded, annotation.quote, near ? { y: near.y } : undefined);
    if (found?.length) return placed(annotation, build, found.map(box), source);
  }
  return onLines();
}

export async function placeAnnotations(
  annotations: readonly PdfAnnotation[],
  build: string,
  deps: PlaceDeps,
): Promise<PdfAnnotationUpdate[]> {
  const pageRuns = new Map<number, Promise<PdfTextRun[] | null>>();
  const stale = annotations.filter(
    (annotation) => annotation.build !== build || annotation.status === "needsPlacing",
  );
  return Promise.all(stale.map((annotation) => placeAnnotation(annotation, build, deps, pageRuns)));
}
