import { describe, expect, it } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { AppConfig, StoredModel } from "@/lib/tauri";
import {
  choiceFromSelection,
  describeToolsChoice,
  destinationName,
  disabledModels,
  isLoopbackHost,
  ollamaModelSeesImages,
  toolsChoice,
  toolsDestination,
  toolsImageReady,
  toolsProviderConfigured,
  visionCapable,
} from "./tools-choice";

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

function stored(id: string, enabled = true, name = id): StoredModel {
  return { id, name, enabled, source: "fetched" };
}

describe("Tools model choice", () => {
  it("treats no choice and an empty Ollama model as automatic local", () => {
    expect(toolsChoice(config())).toBeNull();
    expect(toolsChoice(config({ ai_tools_model: null }))).toBeNull();
    expect(toolsChoice(config({ ai_tools_model: { provider: "ollama", model: " " } }))).toBeNull();
    expect(toolsChoice(config({ ai_tools_model: { provider: " ", model: "x" } }))).toBeNull();
    expect(toolsChoice(config({ ai_tools_model: { provider: " ollama ", model: " glm-ocr " } }))).toEqual({
      provider: "ollama",
      model: "glm-ocr",
    });
    expect(choiceFromSelection("ollama", "")).toBeNull();
    expect(choiceFromSelection("anthropic", "claude-opus-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-opus-5-5",
    });
    expect(choiceFromSelection("mathpix", "mathpix")).toEqual({ provider: "mathpix", model: "mathpix" });
  });

  it.each([
    ["http://127.0.0.1:11434", true],
    ["http://localhost:11434/v1", true],
    ["localhost:11434", true],
    ["http://[::1]:11434", true],
    ["http://0.0.0.0:11434", true],
    ["http://127.0.0.2:11434", true],
    ["http://ollama.localhost:11434", true],
    ["http://192.168.1.9:11434", false],
    ["https://ollama.example.org", false],
    ["http://127.0.0.1.example.org", false],
    ["not a host", false],
    ["", false],
  ])("isLoopbackHost(%s) is %s", (host, loopback) => expect(isLoopbackHost(host)).toBe(loopback));

  it("automatic local with no saved host stays on this device", () => {
    expect(toolsDestination(config())).toEqual({ kind: "device" });
    expect(destinationName({ kind: "device" })).toBeNull();
  });

  it("an Ollama host on another computer is named, not called local", () => {
    const remote = config({ ai_keys: { ollama: "http://192.168.1.9:11434" } });
    expect(toolsDestination(remote)).toEqual({ kind: "host", host: "192.168.1.9:11434" });
    expect(destinationName(toolsDestination(remote))).toBe("Ollama (192.168.1.9:11434)");
    const explicit = config({
      ai_keys: { ollama: "http://192.168.1.9:11434/" },
      ai_tools_model: { provider: "ollama", model: "glm-ocr" },
    });
    expect(toolsDestination(explicit).kind).toBe("host");
  });

  it("a hosted provider is named by its display name", () => {
    const hosted = config({ ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" } });
    expect(toolsDestination(hosted)).toEqual({ kind: "provider", providerId: "anthropic", name: "Anthropic" });
    expect(destinationName(toolsDestination(hosted))).toBe("Anthropic");
  });

  it("names the destination of a provider other than the saved choice", () => {
    expect(toolsDestination(config(), "anthropic")).toEqual({
      kind: "provider",
      providerId: "anthropic",
      name: "Anthropic",
    });
  });

  it("a custom provider on localhost stays on this device", () => {
    const local = config({
      ai_custom_providers: [{ id: "lmstudio", name: "LM Studio", baseURL: "http://localhost:1234/v1", keyOptional: true }],
      ai_tools_model: { provider: "lmstudio", model: "dots.ocr" },
    });
    expect(toolsDestination(local)).toEqual({ kind: "device" });
    const remote = config({
      ai_custom_providers: [{ id: "lab", name: "Lab server", baseURL: "https://lab.example.org/v1" }],
      ai_tools_model: { provider: "lab", model: "qwen2.5vl" },
    });
    expect(toolsDestination(remote)).toEqual({ kind: "provider", providerId: "lab", name: "Lab server" });
  });

  it("Mathpix is a provider destination", () => {
    const mathpix = config({ ai_tools_model: { provider: "mathpix", model: "mathpix" } });
    expect(toolsDestination(mathpix)).toEqual({ kind: "provider", providerId: "mathpix", name: "Mathpix" });
    expect(describeToolsChoice(mathpix)).toMatchObject({
      engine: "mathpix",
      label: researchTools.converterModel.mathpixModel,
    });
  });

  it("describes the choice with the stored name and metadata", () => {
    expect(describeToolsChoice(config())).toMatchObject({
      engine: "llm",
      providerId: "ollama",
      modelId: "",
      label: researchTools.converterModel.automatic,
      destination: { kind: "device" },
    });
    const metadata = {
      name: "Claude Opus 5.5",
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      toolCall: true,
      reasoning: true,
      attachment: true,
      structuredOutput: true,
      status: "active" as const,
      outputLimit: 64_000,
    };
    const hosted = config({
      ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" },
      ai_provider_models: {
        anthropic: [{ ...stored("claude-opus-5-5", true, "Claude Opus 5.5"), metadata }],
      },
    });
    expect(describeToolsChoice(hosted)).toEqual({
      engine: "llm",
      providerId: "anthropic",
      modelId: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      destination: { kind: "provider", providerId: "anthropic", name: "Anthropic" },
      metadata,
    });
  });

  it("the toolbar shows Image to LaTeX when any AI is set up and the choice is automatic", () => {
    expect(toolsImageReady(config())).toBe(false);
    expect(toolsImageReady(config({ ai_keys: { ollama: "http://127.0.0.1:11434" } }))).toBe(true);
    expect(toolsImageReady(config({ ai_provider: "anthropic", ai_keys: { anthropic: "__stored__" } }))).toBe(true);
  });

  it("a hosted choice needs a key, an enabled model and image input", () => {
    const choice = { ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" } };
    expect(toolsImageReady(config(choice))).toBe(false);
    expect(toolsImageReady(config({ ...choice, ai_keys: { anthropic: "__stored__" } }))).toBe(true);
    expect(
      toolsImageReady(
        config({
          ...choice,
          ai_keys: { anthropic: "__stored__" },
          ai_provider_models: { anthropic: [stored("claude-opus-5-5", false)] },
        }),
      ),
    ).toBe(false);
    expect(
      toolsImageReady(
        config({
          ...choice,
          ai_keys: { anthropic: "__stored__" },
          ai_provider_models: { anthropic: [stored("claude-haiku-5-5")] },
        }),
      ),
    ).toBe(false);
    expect(
      toolsImageReady(
        config({
          ai_tools_model: { provider: "groq", model: "openai/gpt-oss-120b" },
          ai_keys: { groq: "__stored__" },
        }),
      ),
    ).toBe(false);
    expect(toolsImageReady(config({ ai_tools_model: { provider: "ollama", model: "llama3.2" } }))).toBe(true);
    expect(toolsImageReady(config({ ai_tools_model: { provider: "mathpix", model: "mathpix" } }))).toBe(true);
  });

  it("OCR model names count as vision models", () => {
    expect(visionCapable("lmstudio", "dots.ocr")).toBe(true);
    expect(visionCapable("ollama", "glm-ocr:latest")).toBe(true);
    expect(visionCapable("groq", "openai/gpt-oss-120b")).toBe(false);
    expect(
      visionCapable("mistral", "pixtral-large", {
        name: "Pixtral",
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        toolCall: true,
        reasoning: false,
        attachment: true,
        structuredOutput: false,
        status: "active",
      }),
    ).toBe(true);
  });

  it("trusts Ollama's capabilities and falls back to the model name", () => {
    expect(ollamaModelSeesImages({ name: "glm-ocr", capabilities: ["completion", "vision"] })).toBe(true);
    expect(ollamaModelSeesImages({ name: "llava", capabilities: ["completion"] })).toBe(false);
    expect(ollamaModelSeesImages({ name: "llava", capabilities: null })).toBe(true);
    expect(ollamaModelSeesImages({ name: "llama3.2", capabilities: null })).toBe(false);
  });

  it("lists models turned off in Settings and knows which providers are set up", () => {
    const cfg = config({
      ai_keys: { openai: "__stored__" },
      ai_provider: "groq",
      ai_api_key: "__stored__",
      ai_custom_providers: [{ id: "lmstudio", name: "LM Studio", baseURL: "http://localhost:1234/v1", keyOptional: true }],
      ai_provider_models: { ollama: [stored("llava", false), stored("glm-ocr")] },
    });
    expect([...disabledModels(cfg, "ollama")]).toEqual(["llava"]);
    expect(disabledModels(cfg, "openai").size).toBe(0);
    expect(toolsProviderConfigured(cfg, "openai")).toBe(true);
    expect(toolsProviderConfigured(cfg, "groq")).toBe(true);
    expect(toolsProviderConfigured(cfg, "lmstudio")).toBe(true);
    expect(toolsProviderConfigured(cfg, "anthropic")).toBe(false);
  });
});
