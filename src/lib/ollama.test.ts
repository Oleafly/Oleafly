import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { DEFAULT_OLLAMA_HOST, listOllamaModelDetails, listOllamaModels, switchableThinkingModels } from "./ollama";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue([]);
});

describe("Ollama bridge", () => {
  it("asks the default host when none is saved", async () => {
    await listOllamaModelDetails("   ");
    expect(mocks.invoke).toHaveBeenCalledWith("ollama_list_model_details", {
      host: "http://127.0.0.1:11434",
    });
    expect(DEFAULT_OLLAMA_HOST).toBe("http://127.0.0.1:11434");
  });

  it("passes a saved host through trimmed and returns the capabilities", async () => {
    mocks.invoke.mockResolvedValue([{ name: "glm-ocr:latest", capabilities: ["completion", "vision"] }]);
    await expect(listOllamaModelDetails(" http://192.168.1.9:11434 ")).resolves.toEqual([
      { name: "glm-ocr:latest", capabilities: ["completion", "vision"] },
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith("ollama_list_model_details", {
      host: "http://192.168.1.9:11434",
    });
  });

  it("picks out the thinking models Ollama can switch off", () => {
    expect(
      switchableThinkingModels([
        { name: "qwen3:0.6b", capabilities: ["completion", "tools", "thinking"], stopsThinking: true },
        { name: "qwen3:4b", capabilities: ["completion", "tools", "thinking"], stopsThinking: false },
        { name: "llama3.2:latest", capabilities: ["completion", "tools"] },
      ]),
    ).toEqual(new Set(["qwen3:0.6b"]));
  });

  it("keeps the plain name listing on its own command", async () => {
    await listOllamaModels("");
    expect(mocks.invoke).toHaveBeenCalledWith("ollama_list_models", { host: DEFAULT_OLLAMA_HOST });
  });
});
