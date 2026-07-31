import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("ai", () => ({ streamText }));
vi.mock("@/lib/tauri", () => ({
  getConfig: vi.fn(async () => ({
    ai_provider: "openai",
    ai_model: "gpt-4o-mini",
    ai_keys: { openai: "sk" },
  })),
}));
vi.mock("@/lib/ai-providers", () => ({
  resolveActiveModel: vi.fn(() => ({
    model: { id: "gpt-4o-mini" },
    label: "GPT-4o mini",
  })),
}));

import { getConfig } from "@/lib/tauri";
import { resolveActiveModel } from "@/lib/ai-providers";
import { systemPromptForReview, userPromptForReview } from "./review-prompts";
import { runPaperReview } from "./review-paper";

beforeEach(() => {
  streamText.mockReset();
  vi.mocked(getConfig).mockClear();
  vi.mocked(resolveActiveModel).mockClear();
});

function fakeStream(chunks: string[]) {
  return {
    textStream: (async function* () {
      for (const c of chunks) yield c;
    })(),
  };
}

describe("review prompts", () => {
  it("friendly prompt is constructive", () => {
    expect(systemPromptForReview("friendly").toLowerCase()).toMatch(
      /constructive|mentor|strength/,
    );
  });

  it("fire prompt is reviewer #2", () => {
    expect(systemPromptForReview("fire").toLowerCase()).toMatch(
      /reviewer|harsh|major issues/,
    );
  });

  it("truncates long papers", () => {
    const long = "a".repeat(20_000);
    expect(userPromptForReview(long).length).toBeLessThan(13_000);
  });

  it("includes paper body for short inputs", () => {
    const text = "Abstract: We propose a method.";
    const prompt = userPromptForReview(text);
    expect(prompt).toContain(text);
    expect(prompt).toContain("BEGIN PAPER");
  });

  it("friendly and fire use distinct section structures", () => {
    const friendly = systemPromptForReview("friendly");
    const fire = systemPromptForReview("fire");
    expect(friendly).toMatch(/Strengths/);
    expect(friendly).toMatch(/Overall assessment/);
    expect(fire).toMatch(/Major issues/);
    expect(fire).toMatch(/Questions for authors/);
    expect(fire).toMatch(/Verdict/);
  });
});

describe("runPaperReview", () => {
  it("streams chunks and returns concatenated text", async () => {
    streamText.mockReturnValue(fakeStream(["## Summary\n", "Looks solid."]));
    const seen: string[] = [];
    const out = await runPaperReview({
      mode: "friendly",
      paperText: "A short paper.",
      onChunk: (full) => seen.push(full),
    });
    expect(out).toBe("## Summary\nLooks solid.");
    expect(seen.at(-1)).toBe(out);
    expect(getConfig).toHaveBeenCalledOnce();
    expect(resolveActiveModel).toHaveBeenCalledOnce();
  });

  it("uses lower temperature for friendly and higher for fire", async () => {
    streamText.mockReturnValue(fakeStream(["ok"]));

    await runPaperReview({ mode: "friendly", paperText: "p" });
    expect(streamText.mock.calls[0][0].temperature).toBe(0.4);
    expect(streamText.mock.calls[0][0].system).toMatch(/mentor|constructive/i);

    streamText.mockReturnValue(fakeStream(["ok"]));
    await runPaperReview({ mode: "fire", paperText: "p" });
    expect(streamText.mock.calls[1][0].temperature).toBe(0.7);
    expect(streamText.mock.calls[1][0].system).toMatch(/Reviewer #2|harsh/i);
  });

  it("forwards abortSignal and truncated user prompt", async () => {
    streamText.mockReturnValue(fakeStream(["x"]));
    const signal = AbortSignal.abort();
    const long = "z".repeat(20_000);

    await runPaperReview({ mode: "fire", paperText: long, signal });

    const arg = streamText.mock.calls[0][0];
    expect(arg.abortSignal).toBe(signal);
    expect(arg.prompt.length).toBeLessThan(13_000);
    expect(arg.prompt).toMatch(/truncated/i);
  });
});
