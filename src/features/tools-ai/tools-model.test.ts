// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { AppConfig, ModelMetadata, StoredModel } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  listOllamaModelDetails: vi.fn(),
  mathpixKeyStatus: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ getConfig: mocks.getConfig, setConfig: mocks.setConfig }));
vi.mock("@/lib/ollama", () => ({
  DEFAULT_OLLAMA_HOST: "http://127.0.0.1:11434",
  listOllamaModelDetails: mocks.listOllamaModelDetails,
}));
vi.mock("@/lib/mathpix", () => ({ mathpixKeyStatus: mocks.mathpixKeyStatus }));

import { useSettingsStore } from "@/store/settings";
import {
  LocalModelError,
  pickLocalModel,
  resolveToolsModel,
  ToolsModelError,
  toolsMaxTokens,
} from "./tools-model";

const errors = researchTools.converterModel.errors;

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ai_keys: {},
    ai_provider: "",
    ai_model: "",
    ai_api_key: "",
    ai_provider_models: {},
    ai_custom_providers: [],
    ...overrides,
  } as AppConfig;
}

function stored(id: string, enabled = true, extra: Partial<StoredModel> = {}): StoredModel {
  return { id, name: id, enabled, source: "fetched", ...extra };
}

const vision = (name: string) => ({ name, capabilities: ["completion", "vision"] });
const text = (name: string) => ({ name, capabilities: ["completion"] });

const opusMetadata: ModelMetadata = {
  name: "Claude Opus 5.5",
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  toolCall: true,
  reasoning: true,
  attachment: true,
  structuredOutput: true,
  status: "active",
  outputLimit: 64_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ offline: false });
  mocks.getConfig.mockResolvedValue(config());
  mocks.setConfig.mockResolvedValue(undefined);
  mocks.listOllamaModelDetails.mockResolvedValue([vision("llava")]);
  mocks.mathpixKeyStatus.mockResolvedValue({ configured: true, appId: "APP" });
});

describe("automatic local model", () => {
  it("with no choice it prefers an OCR model in Ollama", async () => {
    mocks.listOllamaModelDetails.mockResolvedValue([vision("llava"), vision("glm-ocr")]);
    await expect(resolveToolsModel("image")).resolves.toMatchObject({
      engine: "llm",
      providerId: "ollama",
      modelId: "glm-ocr",
      label: "glm-ocr",
      hosted: false,
      destination: { kind: "device" },
      profile: { id: "glm-ocr" },
    });
    expect(mocks.listOllamaModelDetails).toHaveBeenCalledWith("http://127.0.0.1:11434");
  });

  it("otherwise it uses the assistant's Ollama model, then the first vision model", () => {
    const models = [vision("llava"), vision("qwen2.5vl:7b"), text("llama3.2")];
    expect(pickLocalModel(models, "image", "qwen2.5vl:7b", new Set())).toBe("qwen2.5vl:7b");
    expect(pickLocalModel(models, "image", "llama3.2", new Set())).toBe("llava");
    expect(pickLocalModel([vision("deepseek-ocr"), vision("dots.ocr")], "image", "", new Set())).toBe("deepseek-ocr");
    expect(pickLocalModel([text("llama3.2")], "image", "", new Set())).toBeNull();
  });

  it("never picks a model turned off in Settings", async () => {
    expect(pickLocalModel([vision("glm-ocr"), vision("llava")], "image", "", new Set(["glm-ocr"]))).toBe("llava");
    mocks.getConfig.mockResolvedValue(
      config({ ai_provider_models: { ollama: [stored("llava", false), stored("glm-ocr", false)] } }),
    );
    mocks.listOllamaModelDetails.mockResolvedValue([vision("llava"), vision("glm-ocr")]);
    await expect(resolveToolsModel("image")).rejects.toBeInstanceOf(LocalModelError);
  });

  it("counts Ollama models without capabilities when their name says vision", () => {
    expect(pickLocalModel([{ name: "llava", capabilities: null }], "image", "", new Set())).toBe("llava");
    expect(pickLocalModel([{ name: "llama3.2", capabilities: null }], "image", "", new Set())).toBeNull();
  });

  it("typed equations skip OCR-only models", async () => {
    mocks.listOllamaModelDetails.mockResolvedValue([vision("glm-ocr"), text("llama3.2")]);
    await expect(resolveToolsModel("equation-text")).resolves.toMatchObject({ modelId: "llama3.2", profile: null });
    expect(pickLocalModel([text("phi"), text("llama3.2")], "equation-text", "llama3.2", new Set())).toBe("llama3.2");
  });

  it("says how to get a model when Ollama has none that fits", async () => {
    mocks.listOllamaModelDetails.mockResolvedValue([text("llama3.2")]);
    await expect(resolveToolsModel("image")).rejects.toThrow(researchTools.converterErrors.visionModelMissing);
    mocks.listOllamaModelDetails.mockResolvedValue([vision("glm-ocr")]);
    await expect(resolveToolsModel("equation-text")).rejects.toThrow(
      researchTools.converterErrors.localModelMissing,
    );
    mocks.listOllamaModelDetails.mockRejectedValue(new Error("connection refused"));
    const unreachable = resolveToolsModel("image");
    await expect(unreachable).rejects.toBeInstanceOf(LocalModelError);
    await expect(unreachable).rejects.toThrow(researchTools.converterErrors.ollamaUnavailable);
  });
});

describe("explicit choices", () => {
  it("an explicit local model that is gone is an error, not a switch", async () => {
    mocks.getConfig.mockResolvedValue(config({ ai_tools_model: { provider: "ollama", model: "glm-ocr" } }));
    mocks.listOllamaModelDetails.mockResolvedValue([vision("llava")]);
    const gone = resolveToolsModel("image");
    await expect(gone).rejects.toBeInstanceOf(LocalModelError);
    await expect(gone).rejects.toThrow("glm-ocr");
    await expect(gone).rejects.toThrow(errors.localModelGone.replace("{{model}}", "glm-ocr"));
  });

  it("an explicit local model must read images for an image and be a language model for typed math", async () => {
    mocks.getConfig.mockResolvedValue(config({ ai_tools_model: { provider: "ollama", model: "llama3.2" } }));
    mocks.listOllamaModelDetails.mockResolvedValue([text("llama3.2")]);
    await expect(resolveToolsModel("image")).rejects.toThrow(errors.cannotSeeImages.replace("{{model}}", "llama3.2"));
    await expect(resolveToolsModel("equation-text")).resolves.toMatchObject({ modelId: "llama3.2" });

    mocks.getConfig.mockResolvedValue(config({ ai_tools_model: { provider: "ollama", model: "glm-ocr" } }));
    mocks.listOllamaModelDetails.mockResolvedValue([vision("glm-ocr")]);
    await expect(resolveToolsModel("equation-text")).rejects.toThrow(errors.imagesOnly.replace("{{model}}", "glm-ocr"));
  });

  it("a hosted choice resolves with its metadata and is hosted", async () => {
    mocks.getConfig.mockResolvedValue(
      config({
        ai_keys: { anthropic: "__stored__" },
        ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" },
        ai_provider_models: {
          anthropic: [stored("claude-opus-5-5", true, { name: "Claude Opus 5.5", metadata: opusMetadata })],
        },
      }),
    );
    await expect(resolveToolsModel("image")).resolves.toEqual({
      engine: "llm",
      providerId: "anthropic",
      modelId: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      hosted: true,
      destination: { kind: "provider", providerId: "anthropic", name: "Anthropic" },
      metadata: opusMetadata,
      profile: null,
    });
    expect(mocks.listOllamaModelDetails).not.toHaveBeenCalled();
  });

  it("never falls back to another provider when the chosen provider has no key", async () => {
    mocks.getConfig.mockResolvedValue(
      config({
        ai_keys: { ollama: "http://127.0.0.1:11434", openai: "__stored__" },
        ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" },
      }),
    );
    const refused = resolveToolsModel("image");
    await expect(refused).rejects.toBeInstanceOf(ToolsModelError);
    await expect(refused).rejects.toThrow(errors.providerNotConfigured.replace("{{provider}}", "Anthropic"));
    expect(listOllamaModelDetailsCalls()).toBe(0);
  });

  it("refuses a hosted model turned off in Settings", async () => {
    mocks.getConfig.mockResolvedValue(
      config({
        ai_keys: { anthropic: "__stored__" },
        ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" },
        ai_provider_models: { anthropic: [stored("claude-opus-5-5", false, { name: "Claude Opus 5.5" })] },
      }),
    );
    await expect(resolveToolsModel("image")).rejects.toThrow(
      errors.modelDisabled.replace("{{model}}", "Claude Opus 5.5"),
    );
  });

  it("refuses a hosted model that can't read images, but allows it for typed equations", async () => {
    mocks.getConfig.mockResolvedValue(
      config({
        ai_keys: { groq: "__stored__" },
        ai_tools_model: { provider: "groq", model: "openai/gpt-oss-120b" },
      }),
    );
    await expect(resolveToolsModel("image")).rejects.toThrow(
      errors.cannotSeeImages.replace("{{model}}", "openai/gpt-oss-120b"),
    );
    await expect(resolveToolsModel("equation-text")).resolves.toMatchObject({
      providerId: "groq",
      modelId: "openai/gpt-oss-120b",
      hosted: true,
    });
  });

  it("offline mode refuses hosted models and Mathpix but allows Ollama, even on another computer", async () => {
    useSettingsStore.setState({ offline: true });
    mocks.getConfig.mockResolvedValue(
      config({ ai_keys: { anthropic: "__stored__" }, ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" } }),
    );
    await expect(resolveToolsModel("image")).rejects.toThrow(errors.offline);
    mocks.getConfig.mockResolvedValue(config({ ai_tools_model: { provider: "mathpix", model: "mathpix" } }));
    await expect(resolveToolsModel("image")).rejects.toThrow(errors.offline);
    expect(mocks.mathpixKeyStatus).not.toHaveBeenCalled();
    mocks.getConfig.mockResolvedValue(config({ ai_keys: { ollama: "http://192.168.1.9:11434" } }));
    await expect(resolveToolsModel("image")).resolves.toMatchObject({
      providerId: "ollama",
      hosted: false,
      destination: { kind: "host", host: "192.168.1.9:11434" },
    });
    expect(mocks.listOllamaModelDetails).toHaveBeenCalledWith("http://192.168.1.9:11434");
  });

  it("Mathpix needs saved keys and reads images only", async () => {
    mocks.getConfig.mockResolvedValue(config({ ai_tools_model: { provider: "mathpix", model: "mathpix" } }));
    await expect(resolveToolsModel("image")).resolves.toEqual({
      engine: "mathpix",
      label: "Mathpix",
      hosted: true,
      destination: { kind: "provider", providerId: "mathpix", name: "Mathpix" },
    });
    mocks.mathpixKeyStatus.mockResolvedValue({ configured: false, appId: null });
    const missing = resolveToolsModel("image");
    await expect(missing).rejects.toThrow(errors.mathpixNotSetUp);
    await expect(missing).rejects.toMatchObject({ settings: "ai-tools" });
    await expect(resolveToolsModel("equation-text")).rejects.toThrow(errors.imagesOnly.replace("{{model}}", "Mathpix"));
    mocks.mathpixKeyStatus.mockRejectedValue(new Error("no backend"));
    await expect(resolveToolsModel("image")).rejects.toThrow(errors.mathpixNotSetUp);
  });
});

function listOllamaModelDetailsCalls(): number {
  return mocks.listOllamaModelDetails.mock.calls.length;
}

describe("the editor's fallback to the assistant's model", () => {
  const anthropicAssistant = (overrides: Partial<AppConfig> = {}) =>
    config({
      ai_provider: "anthropic",
      ai_model: "claude-opus-5-5",
      ai_keys: { anthropic: "__stored__" },
      ai_provider_models: {
        anthropic: [stored("claude-opus-5-5", true, { name: "Claude Opus 5.5", metadata: opusMetadata })],
      },
      ...overrides,
    });
  const editor = { assistantFallback: true };

  it("uses the assistant's model when nothing is saved for Tools and Ollama does not answer", async () => {
    mocks.getConfig.mockResolvedValue(anthropicAssistant());
    mocks.listOllamaModelDetails.mockRejectedValue(new Error("connection refused"));
    await expect(resolveToolsModel("image", editor)).resolves.toEqual({
      engine: "llm",
      providerId: "anthropic",
      modelId: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      hosted: true,
      destination: { kind: "provider", providerId: "anthropic", name: "Anthropic" },
      metadata: opusMetadata,
      profile: null,
    });
    // The converters keep to the local default.
    await expect(resolveToolsModel("image")).rejects.toThrow(researchTools.converterErrors.ollamaUnavailable);
  });

  it("uses it when Ollama runs without a model that reads images", async () => {
    mocks.getConfig.mockResolvedValue(anthropicAssistant());
    mocks.listOllamaModelDetails.mockResolvedValue([text("llama3.2")]);
    await expect(resolveToolsModel("image", editor)).resolves.toMatchObject({
      providerId: "anthropic",
      modelId: "claude-opus-5-5",
    });
  });

  it("prefers a local model that can run", async () => {
    mocks.getConfig.mockResolvedValue(anthropicAssistant());
    await expect(resolveToolsModel("image", editor)).resolves.toMatchObject({
      providerId: "ollama",
      modelId: "llava",
      hosted: false,
    });
  });

  it("keeps the Ollama message when the assistant's model cannot stand in", async () => {
    mocks.listOllamaModelDetails.mockRejectedValue(new Error("connection refused"));
    const unavailable = researchTools.converterErrors.ollamaUnavailable;
    const cases: AppConfig[] = [
      config(),
      config({ ai_provider: "ollama", ai_model: "llava", ai_keys: { ollama: "http://127.0.0.1:11434" } }),
      config({ ai_provider: "groq", ai_model: "openai/gpt-oss-120b", ai_keys: { groq: "__stored__" } }),
      anthropicAssistant({
        ai_provider_models: { anthropic: [stored("claude-opus-5-5", false, { metadata: opusMetadata })] },
      }),
    ];
    for (const cfg of cases) {
      mocks.getConfig.mockResolvedValue(cfg);
      const refused = resolveToolsModel("image", editor);
      await expect(refused).rejects.toBeInstanceOf(LocalModelError);
      await expect(refused).rejects.toThrow(unavailable);
    }
    useSettingsStore.setState({ offline: true });
    mocks.getConfig.mockResolvedValue(anthropicAssistant());
    await expect(resolveToolsModel("image", editor)).rejects.toThrow(unavailable);
  });

  it("never replaces a local model the user picked", async () => {
    mocks.getConfig.mockResolvedValue(anthropicAssistant({ ai_tools_model: { provider: "ollama", model: "llava" } }));
    mocks.listOllamaModelDetails.mockRejectedValue(new Error("connection refused"));
    await expect(resolveToolsModel("image", editor)).rejects.toThrow(
      researchTools.converterErrors.ollamaUnavailable,
    );
  });

  it("does not hide other errors behind the assistant's model", async () => {
    mocks.getConfig.mockResolvedValue(
      anthropicAssistant({ ai_provider_models: { ...anthropicAssistant().ai_provider_models, ollama: [] } }),
    );
    mocks.listOllamaModelDetails.mockResolvedValue([vision("llava")]);
    mocks.setConfig.mockRejectedValue(new Error("disk full"));
    await expect(resolveToolsModel("image", editor)).rejects.toThrow("disk full");
  });
});

describe("the stored Ollama list", () => {
  it("adds a newly pulled Ollama model to the stored list before using it", async () => {
    const before = config({ ai_provider_models: { ollama: [stored("llava")] } });
    mocks.getConfig.mockResolvedValue(before);
    mocks.listOllamaModelDetails.mockResolvedValue([vision("llava"), vision("glm-ocr")]);
    const events: unknown[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener("oleafly:ai-config-changed", listener);
    try {
      await expect(resolveToolsModel("image")).resolves.toMatchObject({ modelId: "glm-ocr" });
    } finally {
      window.removeEventListener("oleafly:ai-config-changed", listener);
    }
    expect(mocks.setConfig).toHaveBeenCalledOnce();
    const written = mocks.setConfig.mock.calls[0][0] as AppConfig;
    expect(written.ai_provider_models.ollama).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "glm-ocr", enabled: true })]),
    );
    expect(written.ai_provider_models.ollama).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "llava", enabled: true })]),
    );
    expect(events).toEqual([written]);
  });

  it("writes nothing when no Ollama list is stored", async () => {
    mocks.listOllamaModelDetails.mockResolvedValue([vision("glm-ocr")]);
    await resolveToolsModel("image");
    mocks.getConfig.mockResolvedValue(config({ ai_provider_models: { ollama: [stored("glm-ocr")] } }));
    await resolveToolsModel("image");
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });
});

describe("reply budget", () => {
  it.each([
    [{ outputLimit: 4096 }, true, 4096],
    [undefined, true, 8192],
    [undefined, false, 12000],
    [{ outputLimit: 64000 }, true, 12000],
    [{ outputLimit: 0 }, true, 8192],
  ])("toolsMaxTokens(%o, hosted %s) is %d", (limits, hosted, expected) => {
    const metadata = limits ? ({ ...opusMetadata, ...limits } as ModelMetadata) : undefined;
    expect(toolsMaxTokens({ hosted, metadata })).toBe(expected);
  });

  it("an Ollama host on another computer keeps local limits but is not this device", async () => {
    mocks.getConfig.mockResolvedValue(config({ ai_keys: { ollama: "http://192.168.1.9:11434" } }));
    const model = await resolveToolsModel("image");
    expect(model).toMatchObject({ hosted: false, destination: { kind: "host" } });
    expect(model.engine === "llm" && toolsMaxTokens(model)).toBe(12000);
  });
});
