import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/agent-backend";
import type { AppConfig } from "@/lib/tauri";

const streamViaBackend = vi.hoisted(() => vi.fn());
const warmAgentConnection = vi.hoisted(() => vi.fn(async () => undefined));
const getConfigCached = vi.hoisted(() => vi.fn());
const notifyError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/agent-backend", () => ({ streamViaBackend, warmAgentConnection }));
vi.mock("@/lib/config-cache", () => ({ getConfigCached }));
vi.mock("@/lib/toast", () => ({ notifyError }));

import { aiCompletionActive, requestAiCompletion, warmAiCompletion } from "@/lib/ai-completion";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useVisualModeStore } from "@/store/visual-mode";

const CONFIGURED = { ai_provider: "openai", ai_model: "gpt-5-mini", ai_keys: { openai: "sk-test" } } as unknown as AppConfig;
const EMPTY = { ai_provider: "openai", ai_model: "", ai_keys: {} } as unknown as AppConfig;

async function ask(before = "The results sh", after = "", signal = new AbortController().signal) {
  const texts: string[] = [];
  await requestAiCompletion({ before, after, signal, onText: (text) => texts.push(text) });
  return texts;
}

function streams(...pieces: string[]) {
  streamViaBackend.mockImplementation(async (_request: unknown, onEvent: (event: AgentEvent) => void) => {
    for (const text of pieces) onEvent({ kind: "textDelta", text } as AgentEvent);
  });
}

beforeEach(() => {
  getConfigCached.mockResolvedValue(CONFIGURED);
  useSettingsStore.setState({ aiCompletion: true, aiCompletionProvider: "", aiCompletionModel: "" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("requestAiCompletion", () => {
  it("asks nothing without an API provider", async () => {
    getConfigCached.mockResolvedValue(EMPTY);
    expect(await ask()).toEqual([]);
    expect(streamViaBackend).not.toHaveBeenCalled();
  });

  it("streams the text around the cursor with thinking off, on the default model", async () => {
    streams("ow a", " trend");
    expect(await ask("The results sh", " here.")).toEqual(["ow a", "ow a trend"]);
    const [request, , , route] = streamViaBackend.mock.calls[0];
    expect(request.messages[0].content[0].text).toBe("<document>\nThe results sh<cursor/> here.\n</document>");
    expect(request).toMatchObject({ effort: "none", reasoning_summary: false, max_tokens: 64 });
    expect(request.system).toContain("<cursor/>");
    expect(route).toBeUndefined();
  });

  it("uses the chosen model while its provider is set up", async () => {
    streams("x");
    useSettingsStore.setState({ aiCompletionProvider: "openai", aiCompletionModel: "gpt-5-nano" });
    await ask();
    expect(streamViaBackend.mock.calls[0][3]).toEqual({ provider_id: "openai", model_id: "gpt-5-nano" });

    useSettingsStore.setState({ aiCompletionProvider: "anthropic", aiCompletionModel: "claude-haiku-5-5" });
    await ask();
    expect(streamViaBackend.mock.calls[1][3]).toBeUndefined();
  });

  it("unwraps a fenced answer as it streams", async () => {
    streams("```la", "tex\n\\label", "{fig:a}\n```");
    expect(await ask()).toEqual(["", "\\label", "\\label{fig:a}\n"]);
  });

  it("keeps a leading space", async () => {
    streams(" that the trend holds");
    expect(await ask("The results show")).toEqual([" that the trend holds"]);
  });

  it("shows a failure once until a request succeeds", async () => {
    streamViaBackend.mockRejectedValue(new Error("401 invalid key"));
    await ask();
    await ask();
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError.mock.calls[0][2]).toBe("AI completion failed: 401 invalid key");

    streams("ok");
    await ask();
    streamViaBackend.mockRejectedValue(new Error("401 invalid key"));
    await ask();
    expect(notifyError).toHaveBeenCalledTimes(2);
  });

  it("says nothing when the request was cancelled", async () => {
    const controller = new AbortController();
    streamViaBackend.mockImplementation(async () => {
      controller.abort();
      throw new Error("cancelled");
    });
    await ask("a", "", controller.signal);
    expect(notifyError).not.toHaveBeenCalled();
  });
});

describe("warmAiCompletion", () => {
  it("opens the connection to the chosen model, and only with a provider", async () => {
    useSettingsStore.setState({ aiCompletionProvider: "openai", aiCompletionModel: "gpt-5-nano" });
    warmAiCompletion();
    await vi.waitFor(() =>
      expect(warmAgentConnection).toHaveBeenCalledWith({ provider_id: "openai", model_id: "gpt-5-nano" }),
    );

    getConfigCached.mockResolvedValue(EMPTY);
    warmAiCompletion();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warmAgentConnection).toHaveBeenCalledTimes(1);
  });
});

describe("aiCompletionActive", () => {
  it("follows the switch and stays off in Visual mode", () => {
    useFilesStore.setState({ activePath: "main.tex" });
    expect(aiCompletionActive()).toBe(true);
    useVisualModeStore.getState().setMode("main.tex", "visual");
    expect(aiCompletionActive()).toBe(false);
    useVisualModeStore.getState().setMode("main.tex", "code");
    useSettingsStore.setState({ aiCompletion: false });
    expect(aiCompletionActive()).toBe(false);
  });
});
