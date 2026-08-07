import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeText } = vi.hoisted(() => ({ completeText: vi.fn() }));
vi.mock("@/lib/agent-backend", () => ({ completeText }));

import { completeChatWithActiveModel } from "./llm-complete";

beforeEach(() => {
  completeText.mockReset();
});

describe("completeChatWithActiveModel", () => {
  it("routes through the Rust agent and returns its text", async () => {
    completeText.mockResolvedValue("NEEDS: ...\n1.\nFOR: a\nAGAINST: b\nSCORE: 80");

    const out = await completeChatWithActiveModel({
      system: "sys",
      user: "user prompt",
      temperature: 0.2,
    });

    expect(out).toBe("NEEDS: ...\n1.\nFOR: a\nAGAINST: b\nSCORE: 80");
    expect(completeText).toHaveBeenCalledWith({
      system: "sys",
      user: "user prompt",
      temperature: 0.2,
      signal: undefined,
    });
  });

  it("forwards the abort signal so a scan can be cancelled", async () => {
    completeText.mockResolvedValue("");
    const controller = new AbortController();

    await completeChatWithActiveModel({
      system: "s",
      user: "u",
      temperature: 0,
      signal: controller.signal,
    });

    expect(completeText.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it("never receives a provider credential from the caller", async () => {
    completeText.mockResolvedValue("");
    await completeChatWithActiveModel({ system: "s", user: "u", temperature: 0 });
    expect(JSON.stringify(completeText.mock.calls[0][0])).not.toMatch(/sk-|api[_-]?key/i);
  });
});
