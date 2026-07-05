import { describe, it, expect } from "vitest";
import { PROVIDERS, getProvider, defaultModel, credentialMeta } from "./ai-providers";

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
