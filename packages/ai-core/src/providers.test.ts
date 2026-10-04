import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  getProvider,
  defaultModel,
  credentialMeta,
  hasConfiguredProvider,
  mergeCustomProviders,
  pickActiveProvider,
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

  it("defaultModel returns the provider's first model, or a safe fallback", () => {
    const first = getProvider("openai")?.models[0]?.id;
    expect(defaultModel("openai")).toBe(first);
    expect(defaultModel("does-not-exist")).toBe("gpt-4o-mini");
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
