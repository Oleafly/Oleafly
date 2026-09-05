import { describe, expect, it } from "vitest";
import { normalizeAgentUsage } from "./usage";

describe("normalizeAgentUsage", () => {
  it("subtracts OpenAI-style cache reads from inclusive input", () => {
    expect(
      normalizeAgentUsage({
        input: 100,
        output: 20,
        cacheRead: 25,
        cacheWrite: 0,
        inputSemantics: "inclusive",
      }),
    ).toMatchObject({
      inputTotal: 100,
      inputFresh: 75,
      cacheRead: 25,
      cacheRate: 0.25,
    });
  });

  it("adds Anthropic-style cache categories to exclusive input", () => {
    expect(
      normalizeAgentUsage({
        input: 70,
        output: 10,
        cacheRead: 20,
        cacheWrite: 10,
        inputSemantics: "exclusive",
      }),
    ).toMatchObject({
      inputRecorded: 70,
      inputTotal: 100,
      inputFresh: 70,
      cacheRate: 0.2,
    });
  });

  it("does not manufacture cache values for legacy usage", () => {
    expect(normalizeAgentUsage({ input: 40, output: 8 })).toEqual({
      inputRecorded: 40,
      inputTotal: 40,
      inputFresh: null,
      outputTotal: 8,
      cacheRead: null,
      cacheWrite: null,
      inputSemantics: "unknown",
      comparableCacheInput: null,
      cacheRate: null,
    });
  });

  it("keeps exclusive input total unknown when cache counters are missing", () => {
    expect(
      normalizeAgentUsage({
        input: 70,
        output: 10,
        cacheRead: null,
        cacheWrite: null,
        inputSemantics: "exclusive",
      }),
    ).toMatchObject({
      inputTotal: null,
      inputFresh: 70,
      comparableCacheInput: null,
      cacheRate: null,
    });
  });

  it("does not report a cache rate for inconsistent inclusive counters", () => {
    expect(
      normalizeAgentUsage({
        input: 10,
        output: 2,
        cacheRead: 12,
        cacheWrite: 0,
        inputSemantics: "inclusive",
      }),
    ).toMatchObject({
      inputTotal: 10,
      inputFresh: null,
      comparableCacheInput: null,
      cacheRate: null,
    });
  });

  it("rejects invalid counters", () => {
    expect(() => normalizeAgentUsage({ input: -1, output: 0 })).toThrow(/input/u);
    expect(() => normalizeAgentUsage({ input: 1, output: Number.NaN })).toThrow(/output/u);
  });

  it("keeps unavailable provider counters unknown", () => {
    expect(
      normalizeAgentUsage({
        input: 0,
        output: 0,
        inputKnown: false,
        outputKnown: false,
        cacheRead: 0,
        cacheWrite: 0,
        inputSemantics: "inclusive",
      }),
    ).toEqual({
      inputRecorded: null,
      inputTotal: null,
      inputFresh: null,
      outputTotal: null,
      cacheRead: 0,
      cacheWrite: 0,
      inputSemantics: "inclusive",
      comparableCacheInput: null,
      cacheRate: null,
    });
  });

  it("treats an unmarked all-zero legacy payload as unavailable", () => {
    expect(normalizeAgentUsage({ input: 0, output: 0 })).toMatchObject({
      inputRecorded: null,
      inputTotal: null,
      outputTotal: null,
    });
  });
});
