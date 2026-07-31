import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", () => ({ generateText }));
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
import { completeChatWithActiveModel } from "./llm-complete";

beforeEach(() => {
  generateText.mockReset();
  vi.mocked(getConfig).mockClear();
  vi.mocked(resolveActiveModel).mockClear();
});

describe("completeChatWithActiveModel", () => {
  it("routes through generateText with active model and returns text", async () => {
    generateText.mockResolvedValue({ text: "NEEDS: ...\n1.\nFOR: a\nAGAINST: b\nSCORE: 80" });

    const out = await completeChatWithActiveModel({
      system: "sys",
      user: "user prompt",
      temperature: 0.2,
    });

    expect(out).toBe("NEEDS: ...\n1.\nFOR: a\nAGAINST: b\nSCORE: 80");
    expect(getConfig).toHaveBeenCalledOnce();
    expect(resolveActiveModel).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledWith({
      model: { id: "gpt-4o-mini" },
      system: "sys",
      prompt: "user prompt",
      temperature: 0.2,
      abortSignal: undefined,
    });
  });

  it("forwards abortSignal to generateText", async () => {
    generateText.mockResolvedValue({ text: "ok" });
    const signal = AbortSignal.abort();

    await completeChatWithActiveModel({
      system: "s",
      user: "u",
      temperature: 0,
      signal,
    });

    expect(generateText.mock.calls[0][0].abortSignal).toBe(signal);
  });

  it("returns empty string when result.text is missing", async () => {
    generateText.mockResolvedValue({});
    const out = await completeChatWithActiveModel({
      system: "s",
      user: "u",
      temperature: 0.1,
    });
    expect(out).toBe("");
  });
});
