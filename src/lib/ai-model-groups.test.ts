import { describe, expect, it } from "vitest";
import { getProvider } from "@/lib/ai-providers";
import type { CustomProvider, StoredModel } from "@/lib/tauri";
import { configuredModelGroups, configuredProviders, type ModelGroupSource } from "./ai-model-groups";

function stored(id: string, enabled = true, extra: Partial<StoredModel> = {}): StoredModel {
  return { id, name: id.toUpperCase(), enabled, source: "fetched", ...extra };
}

function source(overrides: Partial<ModelGroupSource> = {}): ModelGroupSource {
  return { keys: {}, customProviders: [], providerModels: {}, ...overrides };
}

const lmStudio: CustomProvider = {
  id: "lmstudio",
  name: "LM Studio",
  baseURL: "http://localhost:1234/v1",
  keyOptional: true,
};

describe("configured model groups", () => {
  it("lists providers with a key, or a key-optional custom provider, in catalog order", () => {
    const providers = configuredProviders(
      source({
        keys: { openai: "", anthropic: "•••", groq: "  " },
        customProviders: [lmStudio, { id: "lab", name: "Lab", baseURL: "http://lab.test/v1" }],
      }),
    );
    expect(providers.map((provider) => provider.id)).toEqual(["anthropic", "lmstudio"]);
  });

  it("uses enabled stored models, and the catalog when nothing is stored", () => {
    const groups = configuredModelGroups(
      source({
        keys: { openai: "sk", anthropic: "sk" },
        providerModels: { openai: [stored("a"), stored("b", false)] },
      }),
    );
    expect(groups.map((group) => group.id)).toEqual(["openai", "anthropic"]);
    expect(groups[0].models).toEqual([{ id: "a", name: "A" }]);
    expect(groups[1].models.map((model) => model.id)).toEqual(
      getProvider("anthropic")?.models.map((model) => model.id),
    );
  });

  it("an empty stored list leaves a provider without models; dropEmpty false keeps the group", () => {
    const empty = source({ keys: { openai: "sk" }, providerModels: { openai: [] } });
    expect(configuredModelGroups(empty).find((group) => group.id === "openai")).toBeUndefined();
    expect(configuredModelGroups(empty, { dropEmpty: false })).toEqual([
      { id: "openai", name: "OpenAI", models: [] },
    ]);
  });

  it("live Ollama tags replace the stored Ollama list", () => {
    const withOllama = source({
      keys: { ollama: "http://127.0.0.1:11434" },
      providerModels: { ollama: [stored("llama3.2")] },
    });
    expect(configuredModelGroups(withOllama, { liveOllama: ["glm-ocr", "llava"] })[0].models).toEqual([
      { id: "glm-ocr", name: "glm-ocr" },
      { id: "llava", name: "llava" },
    ]);
    expect(configuredModelGroups(withOllama, { liveOllama: [] })[0].models).toEqual([
      { id: "llama3.2", name: "LLAMA3.2" },
    ]);
  });

  it("keeps the active model listed when its provider no longer lists it", () => {
    const groups = configuredModelGroups(
      source({ keys: { openai: "sk" }, providerModels: { openai: [stored("a")] } }),
      { keep: { providerId: "openai", modelId: "gpt-legacy" } },
    );
    expect(groups[0].models.at(-1)).toEqual({ id: "gpt-legacy", name: "gpt-legacy" });
    const unchanged = configuredModelGroups(
      source({ keys: { openai: "sk" }, providerModels: { openai: [stored("a")] } }),
      { keep: { providerId: "openai", modelId: "a" } },
    );
    expect(unchanged[0].models).toHaveLength(1);
  });

  it("include filters models and toModel decorates them", () => {
    const metadata = {
      name: "Vision",
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      toolCall: true,
      reasoning: false,
      attachment: true,
      structuredOutput: false,
      status: "active" as const,
    };
    const groups = configuredModelGroups(
      source({
        keys: { openai: "sk", anthropic: "sk" },
        providerModels: { openai: [stored("sees", true, { metadata }), stored("blind")], anthropic: [stored("x")] },
      }),
      {
        toModel: (providerId, model) => ({ id: model.id, name: `${providerId}:${model.name}`, metadata: model.metadata }),
        include: (_providerId, model) => model.metadata?.inputModalities.includes("image") === true,
      },
    );
    expect(groups).toEqual([{ id: "openai", name: "OpenAI", models: [{ id: "sees", name: "openai:SEES", metadata }] }]);
  });
});
