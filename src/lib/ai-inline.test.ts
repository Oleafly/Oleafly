import { describe, it, expect, vi, beforeEach } from "vitest";

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("@/lib/agent-backend", () => ({ streamText }));

import { instructionBlock, runInlineCompletion, PRESETS } from "./ai-inline";
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

  it.each([
    ["```\n\\textbf{hi}\n```", "\\textbf{hi}"],
    ["```latex\n\\textbf{hi}\n```", "\\textbf{hi}"],
    ["```tex\nline one\nline two\n```", "line one\nline two"],
    ["  ```typst\n#emph[hi]\n```  ", "#emph[hi]"],
    ["```js const x = 1```", "const x = 1"],
    ["```\n```", ""],
    ["``````", ""],
    ["```", "```"],
    ["`````", "`````"],
    ["Here you go:\n```\nx\n```", "Here you go:\n```\nx\n```"],
    ["no fence at all", "no fence at all"],
  ])("unwraps %j to %j", async (raw, expected) => {
    streamText.mockResolvedValue(raw);
    const out = await runInlineCompletion({ instruction: "x", selection: "hi" });
    expect(out).toBe(expected);
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

  it("tells a LaTeX edit to keep \\cite, \\ref and \\label keys", async () => {
    streamText.mockResolvedValue("");
    await runInlineCompletion({ instruction: "x", selection: "y", engine: LATEX_ENGINE });

    const { system } = streamText.mock.calls[0][0] as StreamArgs;
    expect(system).toContain(String.raw`Keep every \cite, \ref and \label command and its key unchanged.`);
  });

  it("tells a Typst edit to keep @key references, #cite calls and labels", async () => {
    streamText.mockResolvedValue("");
    await runInlineCompletion({
      instruction: "x",
      selection: "y",
      engine: {
        ...LATEX_ENGINE,
        id: "typst",
        label: "Typst",
        capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" },
      },
    });

    const { system } = streamText.mock.calls[0][0] as StreamArgs;
    expect(system).toContain("Preserve valid Typst markup and scripting syntax.");
    expect(system).toContain("Keep every @key reference, #cite call and <label> unchanged.");
    expect(system).not.toContain("LaTeX");
    expect(system).not.toContain(String.raw`\cite`);
  });

  it("tells a Markdown edit to keep Pandoc citations", async () => {
    streamText.mockResolvedValue("");
    await runInlineCompletion({
      instruction: "x",
      selection: "y",
      engine: {
        ...LATEX_ENGINE,
        id: "markdown",
        label: "Markdown",
        capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "markdown" },
      },
    });

    const { system } = streamText.mock.calls[0][0] as StreamArgs;
    expect(system).toContain("Keep every [@key] citation unchanged.");
  });

  it("adds no citation syntax when the engine is unknown", async () => {
    streamText.mockResolvedValue("");
    await runInlineCompletion({ instruction: "x", selection: "y" });

    const { system } = streamText.mock.calls[0][0] as StreamArgs;
    expect(system).not.toContain("@key");
    expect(system).not.toContain(String.raw`\cite`);
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

  it("adds the picked saved instructions after the request", async () => {
    streamText.mockResolvedValue("");
    await runInlineCompletion({
      instruction: "Make it concise",
      saved: ["Keep the formatting.", "  ", "Don't change quoted text.\nNot even punctuation."],
      selection: "y",
    });

    const { user } = streamText.mock.calls[0][0] as StreamArgs;
    expect(user).toContain(
      "Instruction: Make it concise\n\nAlso follow these instructions:\n- Keep the formatting.\n- Don't change quoted text.\n  Not even punctuation.",
    );
  });

  it("runs the saved instructions alone when nothing was typed", () => {
    expect(instructionBlock("  ", ["Only fix grammar."])).toBe("Instructions:\n- Only fix grammar.");
    expect(instructionBlock("Shorten", [])).toBe("Instruction: Shorten");
  });

  it("follows the custom instructions from Settings without letting them change the output rules", async () => {
    streamText.mockResolvedValue("");
    await runInlineCompletion({ instruction: "x", selection: "y", preferences: "  Always write in British English. " });

    const { system, user } = streamText.mock.calls[0][0] as StreamArgs;
    expect(system).toMatch(/^You edit a fragment/u);
    expect(system).toContain("Return ONLY the replacement for the selected text.");
    expect(system).toContain("<<<USER_PREFERENCES\nAlways write in British English.\nUSER_PREFERENCES");
    expect(system.indexOf("USER_PREFERENCES")).toBeGreaterThan(system.indexOf("Return ONLY"));
    expect(user).not.toContain("British English");
  });

  it("leaves the system prompt alone without custom instructions", async () => {
    streamText.mockResolvedValue("");
    await runInlineCompletion({ instruction: "x", selection: "y", preferences: "   " });

    const { system } = streamText.mock.calls[0][0] as StreamArgs;
    expect(system).not.toContain("USER_PREFERENCES");
  });

  it("offers presets that cover the common edits", () => {
    expect(PRESETS.map((p) => p.id)).toContain("improve");
    expect(PRESETS.map((p) => p.id)).toContain("grammar");
  });
});
