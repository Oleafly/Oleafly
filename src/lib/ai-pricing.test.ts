import { describe, expect, it } from "vitest";
import { estimateUsd, formatUsd, lookupPrice } from "./ai-pricing";

describe("lookupPrice", () => {
  it("knows gpt-4o-mini", () => {
    const p = lookupPrice("gpt-4o-mini");
    expect(p.inputPerMTok).toBe(0.15);
  });

  it("treats ollama models as free", () => {
    expect(lookupPrice("llama3.2").inputPerMTok).toBe(0);
  });

  it("returns a fallback for unknowns", () => {
    expect(lookupPrice("totally-unknown-model-xyz").note).toBe("estimate");
  });

  it("does not misprice a paid model as the free local family", () => {
    // "mistral-large-2411" only shares the "mistral" substring with the free
    // local key; it must fall to the paid default, not $0.
    const p = lookupPrice("mistral-large-2411");
    expect(p.inputPerMTok).toBeGreaterThan(0);
    expect(p.note).toBe("estimate");
  });

  it("does not let a short unknown id borrow a longer id's price", () => {
    // "gpt-4" is not a table key; it must not resolve to gpt-4o pricing.
    expect(lookupPrice("gpt-4").note).toBe("estimate");
  });

  it("still fuzzy-matches a paid id by a specific substring", () => {
    // A versioned OpenAI id should still find its base paid price.
    expect(lookupPrice("gpt-4o-2024-08-06").inputPerMTok).toBeGreaterThan(0);
  });

  it("prices the current Claude models on their own rows", () => {
    // "claude-opus-5-5" contains "claude-opus-5"; it must not borrow Opus 5's $5 / $25.
    expect(lookupPrice("claude-opus-5-5")).toMatchObject({ inputPerMTok: 4, outputPerMTok: 20 });
    expect(lookupPrice("claude-sonnet-5-5")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(lookupPrice("claude-haiku-5-5")).toMatchObject({ inputPerMTok: 0.1, outputPerMTok: 0.5 });
    expect(lookupPrice("claude-fable-5-1")).toMatchObject({ inputPerMTok: 10, outputPerMTok: 50 });
  });

  it("keeps pricing the older Claude ids people may have saved", () => {
    expect(lookupPrice("claude-opus-5")).toMatchObject({ inputPerMTok: 5, outputPerMTok: 25 });
    expect(lookupPrice("claude-haiku-4-5")).toMatchObject({ inputPerMTok: 1, outputPerMTok: 5 });
  });
});

describe("estimateUsd", () => {
  it("scales with tokens", () => {
    // 1M in + 1M out at gpt-4o-mini → 0.15 + 0.6
    const { usd } = estimateUsd("gpt-4o-mini", 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(0.75, 5);
  });

  it("switches Claude Haiku 5.5 to its long-prompt rates above 100K input tokens", () => {
    expect(estimateUsd("claude-haiku-5-5", 100_000, 1_000_000).usd).toBeCloseTo(0.01 + 0.5, 5);
    expect(estimateUsd("claude-haiku-5-5", 200_000, 1_000_000).usd).toBeCloseTo(0.1 + 2.5, 5);
  });

  it("formats tiny amounts", () => {
    expect(formatUsd(0.00012)).toMatch(/^~/);
  });
});
