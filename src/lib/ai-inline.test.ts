import { describe, it, expect, vi, beforeEach } from "vitest";

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("ai", () => ({ streamText }));
vi.mock("@/lib/tauri", () => ({
  getConfig: vi.fn(async () => ({ ai_provider: "openai", ai_model: "gpt-4o-mini", ai_keys: { openai: "sk" } })),
}));
vi.mock("@/lib/ai-providers", () => ({
  resolveActiveModel: vi.fn(() => ({ model: { id: "gpt-4o-mini" }, label: "GPT-4o mini" })),
}));

import { runInlineCompletion, PRESETS } from "./ai-inline";
import { LATEX_ENGINE } from "./document-engine";

beforeEach(() => streamText.mockReset());

function fakeStream(chunks: string[]) {
  return {
    textStream: (async function* () {
      for (const c of chunks) yield c;
    })(),
  };
}

describe("runInlineCompletion", () => {
  it("streams tokens and resolves to the concatenated text", async () => {
    streamText.mockReturnValue(fakeStream(["Better ", "sentence."]));
    const seen: string[] = [];
    const out = await runInlineCompletion({
      instruction: "improve",
      selection: "bad sentence",
      onToken: (full) => seen.push(full),
    });
    expect(out).toBe("Better sentence.");
    expect(seen.at(-1)).toBe("Better sentence.");
  });

  it("strips a wrapping code fence if the model adds one", async () => {
    streamText.mockReturnValue(fakeStream(["```\n\\textbf{hi}\n```"]));
    const out = await runInlineCompletion({ instruction: "x", selection: "hi" });
    expect(out).toBe("\\textbf{hi}");
  });

  it("passes the instruction and selection into the model prompt", async () => {
    streamText.mockReturnValue(fakeStream(["ok"]));
    await runInlineCompletion({ engine: LATEX_ENGINE, instruction: "make formal", selection: "hey there" });
    const arg = streamText.mock.calls[0][0];
    expect(arg.prompt).toContain("make formal");
    expect(arg.prompt).toContain("hey there");
    expect(arg.system).toMatch(/LaTeX/);
  });

  it("exposes the six presets in order", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "improve",
      "grammar",
      "concise",
      "expand",
      "fix-source",
      "translate",
    ]);
  });
});
