import { describe, expect, it } from "vitest";
import { PROVIDERS, supportsModelDiscovery } from "./providers";

describe("which providers can validate a pasted key", () => {
  it("validates the providers that serve a model listing", () => {
    for (const id of ["openai", "anthropic", "google", "zai", "groq", "openrouter"]) {
      expect(supportsModelDiscovery(id), id).toBe(true);
    }
  });

  it("treats any custom provider as validatable", () => {
    expect(supportsModelDiscovery("my-gateway", true)).toBe(true);
  });

  it("never claims discovery for a provider outside the catalog", () => {
    expect(supportsModelDiscovery("my-gateway")).toBe(false);
  });

  it("only names providers that exist in the catalog", () => {
    const ids = new Set(PROVIDERS.map((p) => p.id));
    for (const id of ["openai", "anthropic", "google", "ollama", "zai", "groq"]) {
      expect(ids.has(id), `${id} must be a real provider`).toBe(true);
    }
  });
});
