import { describe, expect, it } from "vitest";
import type { ModelMetadata } from "@/lib/tauri";
import {
  estimateScan,
  imageTokens,
  OUTPUT_TOKENS_PER_PAGE,
  pagePixels,
  PROMPT_TOKENS_PER_PAGE,
  ScanConfirmationNeeded,
  selectedPages,
  type PageSize,
} from "./scan-estimate";
import type { ToolsChoiceSummary } from "./tools-choice";

const LETTER: PageSize = { width: 612, height: 792 };

function sizes(count: number): PageSize[] {
  return Array.from({ length: count }, () => ({ ...LETTER }));
}

function hosted(metadata?: Partial<ModelMetadata>, modelId = "vision-x-unpriced"): ToolsChoiceSummary {
  return {
    engine: "llm",
    providerId: "anthropic",
    modelId,
    label: "Vision X",
    destination: { kind: "provider", providerId: "anthropic", name: "Anthropic" },
    ...(metadata ? { metadata: metadata as ModelMetadata } : {}),
  };
}

const mathpix: ToolsChoiceSummary = {
  engine: "mathpix",
  providerId: "mathpix",
  modelId: "mathpix",
  label: "Mathpix OCR",
  destination: { kind: "provider", providerId: "mathpix", name: "Mathpix" },
};

describe("scan estimates", () => {
  it("measures a Letter page at the render scale", () =>
    expect(pagePixels({ width: 612, height: 792 })).toEqual({ width: 979, height: 1267 }));

  it("counts 28-pixel patches after the 2,000 px cap", () => {
    expect(imageTokens(979, 1267)).toBe(35 * 46);
    // An A0 poster shrinks to 1415×2000.
    expect(imageTokens(3814, 5392)).toBe(51 * 72);
  });

  it("prices hosted pages from the model's metadata", () => {
    const estimate = estimateScan(sizes(10), hosted({ cost: { input: 4, output: 20 } }));
    expect(estimate).toMatchObject({ kind: "cost", pages: 10 });
    expect((estimate as { usd: number }).usd).toBeCloseTo(
      (((35 * 46 + PROMPT_TOKENS_PER_PAGE) * 10) / 1e6) * 4 + ((OUTPUT_TOKENS_PER_PAGE * 10) / 1e6) * 20,
      6,
    );
  });

  it("prices Mathpix per page", () =>
    expect(estimateScan(sizes(10), mathpix)).toEqual({ kind: "cost", pages: 10, usd: 0.05 }));

  it("says Ollama for local runs and unknown when no price is known", () => {
    const local: ToolsChoiceSummary = {
      engine: "llm",
      providerId: "ollama",
      modelId: "",
      label: "Automatic (best local model)",
      destination: { kind: "host", host: "192.168.1.9:11434" },
    };
    expect(estimateScan(sizes(7), local)).toEqual({ kind: "ollama", pages: 7 });
    expect(estimateScan(sizes(5), hosted())).toEqual({ kind: "unknown", pages: 5, provider: "Anthropic" });
    expect(estimateScan(sizes(5), hosted({ cost: { input: 4 } }))).toMatchObject({ kind: "unknown" });
  });

  it("falls back to the price list for a known model", () => {
    const estimate = estimateScan(sizes(2), hosted(undefined, "gpt-6-luna"));
    expect(estimate.kind).toBe("cost");
  });

  it("selects 1-based pages from a range and clamps it", () => {
    expect(selectedPages(5)).toEqual([1, 2, 3, 4, 5]);
    expect(selectedPages(5, [2, 3])).toEqual([2, 3]);
    expect(selectedPages(5, [4, 9])).toEqual([4, 5]);
    expect(selectedPages(5, [7, 9])).toEqual([]);
    expect(selectedPages(5, [0, 2])).toEqual([1, 2]);
    expect(selectedPages(0)).toEqual([]);
  });

  it("carries the page sizes a confirmation needs", () => {
    const needed = new ScanConfirmationNeeded(sizes(6));
    expect(needed).toBeInstanceOf(Error);
    expect(needed.name).toBe("ScanConfirmationNeeded");
    expect(needed.sizes).toHaveLength(6);
  });
});
