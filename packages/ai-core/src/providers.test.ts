import { describe, it, expect } from "vitest";
import {
  CUSTOM_PROVIDER_PRESETS,
  PROVIDERS,
  getProvider,
  defaultModel,
  credentialMeta,
  effectiveProviderKeys,
  hasConfiguredProvider,
  isProviderConfigured,
  mergeCustomProviders,
  pickActiveProvider,
  suggestedFirst,
  suggestedProviderId,
} from "./providers";

describe("ai-providers", () => {
  it("ships a non-empty provider catalog, each with id/name/models", () => {
    expect(PROVIDERS.length).toBeGreaterThan(0);
    for (const p of PROVIDERS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(Array.isArray(p.models)).toBe(true);
    }
  });

  it("getProvider resolves a known id and is undefined for an unknown one", () => {
    expect(getProvider("openai")?.id).toBe("openai");
    expect(getProvider("does-not-exist")).toBeUndefined();
  });

  it("defaultModel returns the provider's first model, and nothing for a provider the catalog lacks", () => {
    const first = getProvider("openai")?.models[0]?.id;
    expect(defaultModel("openai")).toBe(first);
    expect(defaultModel("does-not-exist")).toBe("");
  });

  it("credentialMeta asks for a host URL for local Ollama, an API key otherwise", () => {
    expect(credentialMeta("ollama").label).toBe("Host URL");
    expect(credentialMeta("ollama").placeholder).toContain("localhost");
    expect(credentialMeta("openai").label).toBe("API key");
  });
});

describe("pickActiveProvider", () => {
  it("uses the saved provider + saved model when the saved provider has a key", () => {
    const r = pickActiveProvider({
      ai_provider: "anthropic",
      ai_model: "claude-3-5-haiku-20241022",
      ai_keys: { anthropic: "sk-ant" },
    });
    expect(r).toEqual({
      providerId: "anthropic",
      modelId: "claude-3-5-haiku-20241022",
      credential: "sk-ant",
    });
  });

  it("defaults Anthropic to Claude Opus 5.5 and keeps a saved older Claude model", () => {
    expect(defaultModel("anthropic")).toBe("claude-opus-5-5");
    const r = pickActiveProvider({
      ai_provider: "anthropic",
      ai_model: "claude-opus-5",
      ai_keys: { anthropic: "sk-ant" },
    });
    expect(r.modelId).toBe("claude-opus-5");
  });

  it("falls back to the first configured provider (default model) when the saved one has no key", () => {
    const r = pickActiveProvider({
      ai_provider: "openai",
      ai_model: "gpt-4o",
      ai_keys: { groq: "gsk-x" },
    });
    expect(r.providerId).toBe("groq");
    expect(r.modelId).toBe(defaultModel("groq"));
    expect(r.credential).toBe("gsk-x");
  });

  it("folds the legacy single ai_api_key into the saved provider", () => {
    const r = pickActiveProvider({
      ai_provider: "openai",
      ai_api_key: "sk-legacy",
      ai_keys: {},
    });
    expect(r).toEqual({ providerId: "openai", modelId: defaultModel("openai"), credential: "sk-legacy" });
  });

  it("defaults to openai with an empty credential when nothing is configured", () => {
    const r = pickActiveProvider({});
    expect(r.providerId).toBe("openai");
    expect(r.modelId).toBe(defaultModel("openai"));
    expect(r.credential).toBe("");
  });
});

describe("custom providers", () => {
  it("appends custom providers after the catalog with no preset models", () => {
    const merged = mergeCustomProviders([
      { id: "lab-gateway", name: "Lab gateway", baseURL: "https://gw.example/v1" },
    ]);
    expect(merged.slice(0, PROVIDERS.length)).toEqual(PROVIDERS);
    expect(merged.at(-1)).toEqual({
      id: "lab-gateway",
      name: "Lab gateway",
      blurb: "Custom provider.",
      baseURL: "https://gw.example/v1",
      models: [],
    });
  });

  it("keeps a saved key-optional provider active without any key", () => {
    const r = pickActiveProvider({
      ai_provider: "local-llm",
      ai_model: "mistral-7b",
      ai_custom_providers: [
        { id: "local-llm", name: "Local", baseURL: "http://127.0.0.1:8080", keyOptional: true },
      ],
    });
    expect(r).toEqual({ providerId: "local-llm", modelId: "mistral-7b", credential: "" });
  });

  it("falls back to a key-optional provider when the saved one has only a blank key", () => {
    const r = pickActiveProvider({
      ai_provider: "openai",
      ai_keys: { openai: "   " },
      ai_custom_providers: [
        { id: "plain", name: "Plain", baseURL: "http://a" },
        { id: "local-llm", name: "Local", baseURL: "http://b", keyOptional: true },
      ],
    });
    expect(r.providerId).toBe("local-llm");
    expect(r.credential).toBe("");
  });
});

describe("active provider with custom providers", () => {
  const lemonade = { id: "lemonade", name: "Lemonade", baseURL: "http://localhost:13305/v1", keyOptional: true };
  const model = (id: string, enabled = true) => ({ id, enabled });

  it("never gives the legacy single key to a custom provider or an Ollama host", () => {
    const custom = pickActiveProvider({
      ai_provider: "lemonade",
      ai_model: "qwen",
      ai_api_key: "sk-old-openai",
      ai_custom_providers: [lemonade],
    });
    expect(custom).toEqual({ providerId: "lemonade", modelId: "qwen", credential: "" });
    expect(effectiveProviderKeys({ ai_provider: "lemonade", ai_api_key: "sk-old-openai" })).toEqual({});
    expect(effectiveProviderKeys({ ai_provider: "ollama", ai_api_key: "sk-old-openai" })).toEqual({});
    expect(effectiveProviderKeys({ ai_provider: "groq", ai_api_key: "gsk-legacy" })).toEqual({ groq: "gsk-legacy" });
  });

  it("has no model of its own until its list has one", () => {
    expect(pickActiveProvider({ ai_provider: "lemonade", ai_custom_providers: [lemonade] })).toEqual({
      providerId: "lemonade",
      modelId: "",
      credential: "",
    });
  });

  it("drops a saved model the custom provider does not list", () => {
    const r = pickActiveProvider({
      ai_provider: "lemonade",
      ai_model: "gpt-4o-mini",
      ai_custom_providers: [lemonade],
      ai_provider_models: { lemonade: [model("qwen", false), model("llama"), model("phi")] },
    });
    expect(r.modelId).toBe("llama");
    const kept = pickActiveProvider({
      ai_provider: "lemonade",
      ai_model: "phi",
      ai_custom_providers: [lemonade],
      ai_provider_models: { lemonade: [model("llama"), model("phi")] },
    });
    expect(kept.modelId).toBe("phi");
  });

  it("keeps a saved model of a custom provider whose list is empty or not fetched", () => {
    const base = { ai_provider: "lemonade", ai_model: "typed-by-hand", ai_custom_providers: [lemonade] };
    expect(pickActiveProvider(base).modelId).toBe("typed-by-hand");
    expect(pickActiveProvider({ ...base, ai_provider_models: { lemonade: [model("off", false)] } }).modelId).toBe(
      "typed-by-hand",
    );
  });

  it("uses the fallback provider's catalog default if it is enabled, else its first enabled model", () => {
    const groq = getProvider("groq")?.models.map((m) => m.id) ?? [];
    const base = { ai_provider: "openai", ai_model: "gpt-4o", ai_keys: { groq: "gsk-x" } };
    expect(pickActiveProvider(base).modelId).toBe(defaultModel("groq"));
    expect(
      pickActiveProvider({ ...base, ai_provider_models: { groq: [model("a"), model(groq[0]), model("b")] } }).modelId,
    ).toBe(groq[0]);
    expect(
      pickActiveProvider({ ...base, ai_provider_models: { groq: [model(groq[0], false), model("a"), model("b")] } })
        .modelId,
    ).toBe("a");
  });

  it("falls back to the key-optional provider's own first enabled model", () => {
    const r = pickActiveProvider({
      ai_provider: "openai",
      ai_model: "gpt-4o",
      ai_custom_providers: [lemonade],
      ai_provider_models: { lemonade: [model("qwen", false), model("llama")] },
    });
    expect(r).toEqual({ providerId: "lemonade", modelId: "llama", credential: "" });
  });
});

describe("isProviderConfigured", () => {
  const local = { id: "local", name: "Local", baseURL: "http://127.0.0.1:8080", keyOptional: true };
  const gated = { id: "gated", name: "Gated", baseURL: "https://gw.example/v1" };

  it("needs a non-blank key or host, or a key-optional custom provider", () => {
    expect(isProviderConfigured("groq", { groq: "gsk" })).toBe(true);
    expect(isProviderConfigured("groq", { groq: "   " })).toBe(false);
    expect(isProviderConfigured("groq", {})).toBe(false);
    expect(isProviderConfigured("local", {}, [local, gated])).toBe(true);
    expect(isProviderConfigured("gated", {}, [local, gated])).toBe(false);
    expect(isProviderConfigured("gated", { gated: "k" }, [local, gated])).toBe(true);
  });
});

describe("hasConfiguredProvider", () => {
  it("is true once the active provider has a non-blank key", () => {
    expect(hasConfiguredProvider({ ai_keys: { groq: "gsk" } })).toBe(true);
  });

  it("is false with no keys or only blank ones", () => {
    expect(hasConfiguredProvider({})).toBe(false);
    expect(hasConfiguredProvider({ ai_provider: "anthropic", ai_keys: { anthropic: "  " } })).toBe(false);
  });

  it("counts a key-optional custom provider as configured", () => {
    expect(
      hasConfiguredProvider({
        ai_provider: "local-llm",
        ai_custom_providers: [{ id: "local-llm", name: "Local", baseURL: "http://b", keyOptional: true }],
      }),
    ).toBe(true);
  });

  it("does not count a custom provider that needs a key it lacks", () => {
    expect(
      hasConfiguredProvider({
        ai_provider: "gateway",
        ai_custom_providers: [{ id: "gateway", name: "Gateway", baseURL: "http://b" }],
      }),
    ).toBe(false);
  });
});

describe("suggested provider", () => {
  it("suggests DeepSeek for Chinese interfaces and OpenAI everywhere else", () => {
    expect(suggestedProviderId("zh-Hans")).toBe("deepseek");
    expect(suggestedProviderId("zh-Hant")).toBe("deepseek");
    expect(suggestedProviderId("ZH-cn")).toBe("deepseek");
    expect(suggestedProviderId("en")).toBe("openai");
    expect(suggestedProviderId("ja")).toBe("openai");
    expect(suggestedProviderId(undefined)).toBe("openai");
    expect(getProvider(suggestedProviderId("zh-Hans"))).toBeDefined();
  });

  it("moves the suggested provider to the front and keeps the rest in order", () => {
    const ids = (list: { id: string }[]) => list.map((provider) => provider.id);
    const list = [{ id: "openai" }, { id: "anthropic" }, { id: "deepseek" }, { id: "zai" }];
    expect(ids(suggestedFirst(list, "deepseek"))).toEqual(["deepseek", "openai", "anthropic", "zai"]);
    expect(ids(suggestedFirst(list, "openai"))).toEqual(["openai", "anthropic", "deepseek", "zai"]);
    expect(ids(suggestedFirst(list, "missing"))).toEqual(["openai", "anthropic", "deepseek", "zai"]);
    expect(suggestedFirst(list, "openai")).not.toBe(list);
  });
});

describe("custom provider presets", () => {
  it("fills in OpenAI-compatible endpoints with ids no built-in provider uses", () => {
    expect(CUSTOM_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      "qwen",
      "kimi",
      "zhipu",
      "siliconflow",
      "volcengine-ark",
    ]);
    for (const preset of CUSTOM_PROVIDER_PRESETS) {
      expect(preset.id).toMatch(/^[a-z0-9][a-z0-9-]*$/u);
      expect(getProvider(preset.id)).toBeUndefined();
      expect(new URL(preset.baseURL).protocol).toBe("https:");
      expect(preset.baseURL.endsWith("/")).toBe(false);
    }
  });
});
