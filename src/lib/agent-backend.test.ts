import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  completeText,
  completeViaBackend,
  resetAgentBackendCache,
  rustAgentEnabled,
} from "./agent-backend";

function reply(text: string) {
  return { text, usage: { input: 1, output: 2 }, provider_id: "openai", model_id: "gpt-4o" };
}

beforeEach(() => {
  mocks.invoke.mockReset();
  resetAgentBackendCache();
});

describe("backend selection", () => {
  it("is asked for once and then remembered", async () => {
    mocks.invoke.mockResolvedValue("rust");
    expect(await rustAgentEnabled()).toBe(true);
    expect(await rustAgentEnabled()).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("falls back to the TypeScript path when the command is missing", async () => {
    // An older build has no agent_backend command; AI must keep working.
    mocks.invoke.mockRejectedValue(new Error("unknown command"));
    expect(await rustAgentEnabled()).toBe(false);
  });

  it("treats anything other than rust as the TypeScript path", async () => {
    mocks.invoke.mockResolvedValue("ts");
    expect(await rustAgentEnabled()).toBe(false);
  });
});

describe("completion requests", () => {
  it("sends the system prompt and user text the backend expects", async () => {
    mocks.invoke.mockResolvedValue(reply("x^2"));
    const text = await completeText({ system: "sys", user: "hi", temperature: 0.4 });

    expect(text).toBe("x^2");
    const [command, args] = mocks.invoke.mock.calls[0];
    expect(command).toBe("agent_complete");
    expect(args.request).toMatchObject({
      system: "sys",
      temperature: 0.4,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
  });

  it("gives every call its own id so cancelling one cannot stop another", async () => {
    mocks.invoke.mockResolvedValue(reply(""));
    await completeText({ user: "a" });
    await completeText({ user: "b" });
    const [first, second] = mocks.invoke.mock.calls.map((c) => c[1].requestId);
    expect(first).not.toBe(second);
  });

  it("passes a provider override through without any credential", async () => {
    mocks.invoke.mockResolvedValue(reply(""));
    await completeViaBackend({ messages: [] }, undefined, {
      provider_id: "groq",
      model_id: "llama-3.1-8b-instant",
    });
    const args = mocks.invoke.mock.calls[0][1];
    expect(args.providerOverride).toEqual({
      provider_id: "groq",
      model_id: "llama-3.1-8b-instant",
    });
    expect(JSON.stringify(args)).not.toMatch(/key|secret|token/i);
  });
});

describe("cancellation", () => {
  it("refuses to start when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(completeText({ user: "hi", signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("tells the backend to drop an in-flight request and reports an abort", async () => {
    const controller = new AbortController();
    let rejectCall: (reason: unknown) => void = () => {};
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "agent_cancel") return Promise.resolve();
      return new Promise((_, reject) => {
        rejectCall = reject;
      });
    });

    const pending = completeText({ user: "hi", signal: controller.signal });
    controller.abort();
    // The backend surfaces the dropped request as an ordinary error string.
    rejectCall("The request was cancelled.");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledWith("agent_cancel", expect.anything());
  });

  it("reports a genuine provider failure as an error, not an abort", async () => {
    mocks.invoke.mockRejectedValue("The provider returned 401. Incorrect API key provided");
    await expect(completeText({ user: "hi" })).rejects.toThrow(/401/);
  });
});
