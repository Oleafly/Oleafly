import { describe, expect, it } from "vitest";
import type { AppConfig } from "@/lib/tauri";
import { rememberedModel } from "./scope-model-memory";

const CFG = {
  ai_provider: "openai",
  ai_model: "gpt-5-mini",
  ai_keys: { openai: "key" },
  ai_provider_models: { openai: [{ id: "gpt-5", enabled: true }, { id: "gpt-old", enabled: false }] },
  ai_custom_providers: [{ id: "local", name: "Local", base_url: "http://localhost", keyOptional: true }],
} as unknown as AppConfig;

function memory(choice: { providerId: string; modelId: string } | null) {
  return { read: () => choice, save: () => {} };
}

describe("a scope's remembered model", () => {
  it("uses the saved model while its provider and model are still set up", () => {
    expect(rememberedModel(memory({ providerId: "openai", modelId: "gpt-5" }), CFG)).toEqual({ providerId: "openai", modelId: "gpt-5" });
    expect(rememberedModel(memory({ providerId: "local", modelId: "llama" }), CFG)).toEqual({ providerId: "local", modelId: "llama" });
  });

  it("falls back when there is no memory, nothing saved, or the choice is no longer set up", () => {
    expect(rememberedModel(undefined, CFG)).toBeNull();
    expect(rememberedModel(memory(null), CFG)).toBeNull();
    expect(rememberedModel(memory({ providerId: "anthropic", modelId: "claude" }), CFG)).toBeNull();
    expect(rememberedModel(memory({ providerId: "openai", modelId: "gpt-old" }), CFG)).toBeNull();
    expect(rememberedModel(memory({ providerId: "openai", modelId: "" }), CFG)).toBeNull();
  });
});
