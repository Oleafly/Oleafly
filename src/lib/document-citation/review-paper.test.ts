import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("@/lib/agent-backend", () => ({ streamText }));

import { systemPromptForReview, userPromptForReview } from "./review-prompts";
import { runPaperReview } from "./review-paper";

beforeEach(() => {
  streamText.mockReset();
});

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
  it("streams chunks through the caller's callback and returns the whole text", async () => {
    streamText.mockImplementation(async (args: { onToken?: (full: string) => void }) => {
      args.onToken?.("Strong ");
      args.onToken?.("Strong contribution.");
      return "Strong contribution.";
    });

    const seen: string[] = [];
    const out = await runPaperReview({
      mode: "friendly",
      paperText: "Abstract: ...",
      onChunk: (full) => seen.push(full),
    });

    expect(out).toBe("Strong contribution.");
    expect(seen).toEqual(["Strong ", "Strong contribution."]);
  });

  it("runs fire mode hotter than friendly mode", async () => {
    streamText.mockResolvedValue("");
    await runPaperReview({ mode: "friendly", paperText: "x" });
    await runPaperReview({ mode: "fire", paperText: "x" });

    const [friendly, fire] = streamText.mock.calls.map((c) => c[0].temperature);
    expect(friendly).toBeLessThan(fire);
  });

  it("forwards the abort signal and the truncated prompt", async () => {
    streamText.mockResolvedValue("");
    const controller = new AbortController();
    const long = "a".repeat(20_000);

    await runPaperReview({ mode: "fire", paperText: long, signal: controller.signal });

    const call = streamText.mock.calls[0][0];
    expect(call.signal).toBe(controller.signal);
    expect(call.user).toBe(userPromptForReview(long));
    expect(call.system).toBe(systemPromptForReview("fire"));
  });
});
