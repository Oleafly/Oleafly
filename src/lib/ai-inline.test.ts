import { describe, it, expect, vi, beforeEach } from "vitest";

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("@/lib/agent-backend", () => ({ streamText }));

import { runInlineCompletion, PRESETS } from "./ai-inline";
import { LATEX_ENGINE } from "./document-engine";

type StreamArgs = {
  user: string;
  system: string;
  signal?: AbortSignal;
  onToken?: (full: string) => void;
};

beforeEach(() => {
  streamText.mockReset();
});

describe("runInlineCompletion", () => {
  it("streams tokens and resolves to the concatenated text", async () => {
    streamText.mockImplementation(async (args: StreamArgs) => {
      args.onToken?.("Better ");
      args.onToken?.("Better sentence.");
      return "Better sentence.";
    });

    const seen: string[] = [];
    const out = await runInlineCompletion({
      instruction: "improve",
      selection: "bad sentence",
      onToken: (full) => seen.push(full),
    });

    expect(out).toBe("Better sentence.");
    expect(seen).toEqual(["Better ", "Better sentence."]);
  });

  it("strips a wrapping code fence if the model adds one", async () => {
    streamText.mockResolvedValue("```\n\\textbf{hi}\n```");
    const out = await runInlineCompletion({ instruction: "x", selection: "hi" });
    expect(out).toBe("\\textbf{hi}");
  });

  it("passes the instruction, selection and context into the prompt", async () => {
    streamText.mockResolvedValue("");
    await runInlineCompletion({
      instruction: "Make it concise",
      selection: "the selected text",
      context: { before: "before ctx", after: "after ctx" },
      engine: LATEX_ENGINE,
    });

    const { user, system } = streamText.mock.calls[0][0] as StreamArgs;
    expect(user).toContain("Make it concise");
    expect(user).toContain("the selected text");
    expect(user).toContain("before ctx");
    expect(user).toContain("after ctx");
    expect(system).toMatch(/LaTeX/);
  });

  it("forwards the abort signal so an inline edit can be cancelled", async () => {
    streamText.mockResolvedValue("");
    const controller = new AbortController();
    await runInlineCompletion({
      instruction: "x",
      selection: "y",
      signal: controller.signal,
    });
    expect((streamText.mock.calls[0][0] as StreamArgs).signal).toBe(controller.signal);
  });

  it("offers presets that cover the common edits", () => {
    expect(PRESETS.map((p) => p.id)).toContain("improve");
    expect(PRESETS.map((p) => p.id)).toContain("grammar");
  });
});
