import type { PdfTextRun, SynctexRect } from "@oleafly/preview";
import type {
  PdfAnnotation,
  PdfAnnotationBox,
  PdfAnnotationQuote,
  PdfAnnotationSource,
  PdfAnnotationUpdate,
} from "@/lib/tauri";
import { followSource } from "./model";

export interface CompiledText {
  path: string;
  text: string;
  current: boolean;
}

export interface PlaceDeps {
  compiledText: (path: string) => CompiledText | null;
  linesOf: (compiledPath: string, startLine: number, endLine: number) => Promise<SynctexRect[] | null>;
  runsOf: (page: number) => Promise<PdfTextRun[] | null>;
  findQuote: (page: number, runs: readonly PdfTextRun[], quote: PdfAnnotationQuote, near?: { y: number }) => SynctexRect[] | null;
}

const CONCURRENT_NOTES = 4;

type PageRuns = Map<number, Promise<PdfTextRun[] | null>>;

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
  return { id: annotation.id, expectedUpdatedAt: annotation.updatedAt, build, boxes: [], placement: "needsPlacing" };
}

function placed(
  annotation: PdfAnnotation,
  build: string,
  boxes: PdfAnnotationBox[],
  source?: PdfAnnotationSource,
): PdfAnnotationUpdate {
  return {
    id: annotation.id,
    expectedUpdatedAt: annotation.updatedAt,
    build,
    boxes,
    page: boxes[0]?.page ?? annotation.page,
    placement: "placed",
    ...(source ? { source } : {}),
  };
}

function runsOn(page: number, deps: PlaceDeps, pageRuns: PageRuns): Promise<PdfTextRun[] | null> {
  let runs = pageRuns.get(page);
  if (!runs) {
    runs = deps.runsOf(page).catch(() => null);
    pageRuns.set(page, runs);
  }
  return runs;
}

async function quoteOn(
  pages: readonly number[],
  annotation: PdfAnnotation,
  deps: PlaceDeps,
  pageRuns: PageRuns,
  near?: (page: number) => { y: number } | undefined,
): Promise<PdfAnnotationBox[] | null> {
  if (!annotation.quote.text.trim()) return null;
  for (const page of pages) {
    const runs = await runsOn(page, deps, pageRuns);
    if (!runs) continue;
    const found = deps.findQuote(page, runs, annotation.quote, near?.(page));
    if (found?.length) return found.map(box);
  }
  return null;
}

function nearbyPages(page: number): number[] {
  return [page, page - 1, page + 1].filter((candidate) => candidate >= 1);
}

function sameLines(a: PdfAnnotationSource, b: PdfAnnotationSource): boolean {
  return a.path === b.path && a.startLine === b.startLine && a.endLine === b.endLine && a.excerpt === b.excerpt;
}

export async function placeAnnotation(
  annotation: PdfAnnotation,
  build: string,
  deps: PlaceDeps,
  pageRuns: PageRuns = new Map(),
): Promise<PdfAnnotationUpdate> {
  const stored = annotation.source;
  const compiled = stored ? deps.compiledText(stored.path) : null;
  const followed = stored && compiled ? followSource(stored, compiled.text) : null;
  const lines = followed && compiled ? await deps.linesOf(compiled.path, followed.startLine, followed.endLine) : null;
  const keep = followed && compiled?.current && stored && !sameLines(followed, stored) ? followed : undefined;
  if (lines?.length) {
    const first = lines[0];
    const onFirstPage = lines.filter((line) => line.page === first.page);
    if (annotation.kind === "region") {
      const unchanged = stored && followed && sameLines(followed, stored) && annotation.boxes[0]?.page === first.page;
      return placed(annotation, build, unchanged ? annotation.boxes : [bounds(onFirstPage)], keep);
    }
    const pages = [...new Set(lines.map((line) => line.page))];
    const near = (page: number) => {
      const line = lines.find((candidate) => candidate.page === page);
      return line ? { y: line.y } : undefined;
    };
    const found = await quoteOn(pages, annotation, deps, pageRuns, near);
    return placed(annotation, build, found ?? [bounds(onFirstPage)], keep);
  }
  const found = await quoteOn(nearbyPages(annotation.page), annotation, deps, pageRuns);
  if (!found) return lost(annotation, build);
  if (annotation.kind !== "region") return placed(annotation, build, found, keep);
  const around = bounds(found);
  const drawn = annotation.boxes[0];
  return placed(annotation, build, drawn && holds(drawn, around) ? [drawn] : [around], keep);
}

function holds(outer: PdfAnnotationBox, inner: PdfAnnotationBox): boolean {
  return (
    outer.page === inner.page &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export async function placeAnnotations(
  annotations: readonly PdfAnnotation[],
  build: string,
  deps: PlaceDeps,
): Promise<PdfAnnotationUpdate[]> {
  const pageRuns: PageRuns = new Map();
  const results: PdfAnnotationUpdate[] = new Array(annotations.length);
  let next = 0;
  const worker = async () => {
    while (next < annotations.length) {
      const index = next;
      next += 1;
      results[index] = await placeAnnotation(annotations[index], build, deps, pageRuns);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_NOTES, annotations.length) }, worker));
  return results;
}
