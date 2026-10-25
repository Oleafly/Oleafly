import { describe, expect, it } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { AppConfig, ModelMetadata, StoredModel } from "@/lib/tauri";
import { toolsModelGroups } from "./tools-groups";

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

function stored(id: string, enabled = true, metadata?: ModelMetadata): StoredModel {
  return { id, name: id, enabled, source: "fetched", ...(metadata ? { metadata } : {}) };
}

const visionMetadata: ModelMetadata = {
  name: "Vision",
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  toolCall: true,
  reasoning: false,
  attachment: true,
  structuredOutput: false,
  status: "active",
};

describe("Tools model picker groups", () => {
  it("puts Automatic first in the Local group and lists only vision models that are not turned off", () => {
    const groups = toolsModelGroups(
      config({ ai_provider_models: { ollama: [stored("llava", false)] } }),
      [
        { name: "glm-ocr", capabilities: ["completion", "vision"] },
        { name: "llama3.2", capabilities: ["completion", "tools"] },
        { name: "llava", capabilities: null },
      ],
      false,
    );
    expect(groups[0]).toMatchObject({ id: "ollama", name: researchTools.converterModel.localGroup });
    expect(groups[0].models.map((model) => model.id)).toEqual(["", "glm-ocr"]);
    expect(groups[0].models[0].name).toBe(researchTools.converterModel.automatic);
  });

  it("lists vision models from configured hosted providers with their metadata, never Ollama twice", () => {
    const groups = toolsModelGroups(
      config({
        ai_keys: { ollama: "http://127.0.0.1:11434", anthropic: "__stored__", groq: "__stored__", openai: "" },
        ai_provider_models: {
          ollama: [stored("llava")],
          anthropic: [stored("claude-opus-5-5", true, visionMetadata), stored("claude-haiku-5-5", false)],
          groq: [stored("openai/gpt-oss-120b")],
        },
      }),
      [{ name: "llava", capabilities: ["vision"] }],
      false,
    );
    expect(groups.map((group) => group.id)).toEqual(["ollama", "anthropic"]);
    expect(groups.filter((group) => group.id === "ollama")).toHaveLength(1);
    expect(groups[1].models).toEqual([
      { id: "claude-opus-5-5", name: "Claude Opus 5.5", metadata: visionMetadata },
    ]);
  });

  it("adds Mathpix only when its keys are saved", () => {
    expect(toolsModelGroups(config(), [], false).map((group) => group.id)).toEqual(["ollama"]);
    const groups = toolsModelGroups(config(), [], true);
    expect(groups.at(-1)).toEqual({
      id: "mathpix",
      name: "Mathpix",
      models: [{ id: "mathpix", name: researchTools.converterModel.mathpixModel }],
    });
  });

  it("keeps Ollama Cloud models out of the Local group", () => {
    const groups = toolsModelGroups(
      config(),
      [
        { name: "qwen3-vl:235b-cloud", capabilities: ["completion", "vision"], remote: true },
        { name: "minimax-m2:cloud", capabilities: ["completion", "vision"] },
        { name: "qwen2.5vl:7b", capabilities: ["completion", "vision"], remote: false },
      ],
      false,
    );
    expect(groups[0].models.map((model) => model.id)).toEqual(["", "qwen2.5vl:7b"]);
  });

  it("an unreachable Ollama leaves only Automatic", () => {
    const groups = toolsModelGroups(config({ ai_keys: { ollama: "http://127.0.0.1:11434" } }), null, false);
    expect(groups).toHaveLength(1);
    expect(groups[0].models.map((model) => model.id)).toEqual([""]);
  });
});
