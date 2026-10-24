// How big a scanned-PDF run is before it starts: the page count, and for a
// hosted model or Mathpix a rough price. Converters ask for confirmation
// from five pages on; one run takes at most 50 pages.
import { lookupPrice } from "@/lib/ai-pricing";
import { fitWithin } from "./image-downscale-core";
import { destinationName, type ToolsChoiceSummary } from "./tools-choice";

export const LONG_SCAN_PAGES = 5;
export const SCAN_PAGE_LIMIT = 50;
/** pdf.js renders each scanned page at this scale before the model reads it. */
export const SCAN_RENDER_SCALE = 1.6;
export const OUTPUT_TOKENS_PER_PAGE = 1_200;
export const PROMPT_TOKENS_PER_PAGE = 120;
/** Mathpix's list price for one PDF page, in US dollars. */
export const MATHPIX_USD_PER_PDF_PAGE = 0.005;
const HOSTED_MAX_EDGE = 2_000;
/** Vision models bill an image by its 28-pixel patches. */
const PATCH_PIXELS = 28;

/** A page size in PDF points. */
export interface PageSize {
  width: number;
  height: number;
}

export type ScanEstimate =
  | { kind: "ollama"; pages: number }
  | { kind: "cost"; pages: number; usd: number }
  /** A subscription covers it, such as a coding plan or Ollama Cloud. */
  | { kind: "plan"; pages: number; provider: string }
  /** A model server on this computer other than Ollama. */
  | { kind: "local"; pages: number }
  /** The model's listed price is zero. */
  | { kind: "free"; pages: number }
  | { kind: "unknown"; pages: number; provider: string };

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The rendered page in pixels. */
export function pagePixels(size: PageSize): { width: number; height: number } {
  return {
    width: Math.round(finite(size.width) * SCAN_RENDER_SCALE),
    height: Math.round(finite(size.height) * SCAN_RENDER_SCALE),
  };
}

/** Input tokens for one image after it is shrunk to 2,000 px. */
export function imageTokens(width: number, height: number): number {
  const fit = fitWithin(width, height, HOSTED_MAX_EDGE);
  return Math.ceil(fit.width / PATCH_PIXELS) * Math.ceil(fit.height / PATCH_PIXELS);
}

/** USD per million input and output tokens, `"plan"` when a subscription
 * covers the model, or null when the price is not known. */
function ratesFor(summary: ToolsChoiceSummary): { input: number; output: number } | "plan" | null {
  const cost = summary.metadata?.cost;
  if (typeof cost?.input === "number" && typeof cost.output === "number") {
    return { input: cost.input, output: cost.output };
  }
  const price = lookupPrice(summary.modelId);
  if (price.note === "plan") return "plan";
  if (price.note) return null;
  return { input: price.inputPerMTok, output: price.outputPerMTok };
}

export function estimateScan(sizes: readonly PageSize[], summary: ToolsChoiceSummary): ScanEstimate {
  const pages = sizes.length;
  if (summary.engine === "mathpix") {
    return { kind: "cost", pages, usd: Math.round(pages * MATHPIX_USD_PER_PDF_PAGE * 1e6) / 1e6 };
  }
  const provider = destinationName(summary.destination);
  if (summary.providerId === "ollama") {
    // An Ollama Cloud model runs on ollama.com under the user's plan.
    return provider && summary.destination.kind === "provider"
      ? { kind: "plan", pages, provider }
      : { kind: "ollama", pages };
  }
  if (summary.destination.kind === "device") return { kind: "local", pages };
  const rates = ratesFor(summary);
  if (rates === "plan") return { kind: "plan", pages, provider: provider ?? summary.providerId };
  if (!rates) {
    return { kind: "unknown", pages, provider: provider ?? summary.providerId };
  }
  if (rates.input === 0 && rates.output === 0) return { kind: "free", pages };
  const inputTokens = sizes.reduce((total, size) => {
    const pixels = pagePixels(size);
    return total + imageTokens(pixels.width, pixels.height) + PROMPT_TOKENS_PER_PAGE;
  }, 0);
  const outputTokens = pages * OUTPUT_TOKENS_PER_PAGE;
  return {
    kind: "cost",
    pages,
    usd: (inputTokens / 1e6) * rates.input + (outputTokens / 1e6) * rates.output,
  };
}

/** Thrown when a scan of `LONG_SCAN_PAGES` or more pages needs the user's
 * go-ahead; `sizes` feed the estimate the confirmation shows. */
export class ScanConfirmationNeeded extends Error {
  readonly sizes: readonly PageSize[];

  constructor(sizes: readonly PageSize[]) {
    super("This scan needs confirmation before it runs.");
    this.name = "ScanConfirmationNeeded";
    this.sizes = sizes;
  }
}

/** The 1-based pages of a `total`-page PDF that `range` selects, cut to the
 * pages that exist. Matches how the PDF importer reads a range. */
export function selectedPages(total: number, range?: readonly [number, number]): number[] {
  const count = Math.max(0, Math.floor(total));
  const first = range ? Math.max(1, Math.floor(range[0])) : 1;
  const last = range ? Math.min(count, Math.floor(range[1])) : count;
  const pages: number[] = [];
  for (let page = first; page <= last; page += 1) pages.push(page);
  return pages;
}
