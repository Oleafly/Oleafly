import { describe, expect, it } from "vitest";
import type { StoredModel } from "@/lib/tauri";
import { pickActiveModel } from "@/lib/ai-model-state";

// The rule addCustomProvider applies: activate only when nothing is
// configured yet, and pick a model the gateway actually listed.
function activation(
  current: { provider: string; model: string },
  addedId: string,
  discovered: StoredModel[],
  catalogDefault: string,
): { provider: string; model: string } {
  const isFirst = !current.provider;
  return {
    provider: isFirst ? addedId : current.provider,
    model: isFirst ? pickActiveModel(discovered, catalogDefault) : current.model,
  };
}

const model = (id: string): StoredModel => ({ id, name: id, enabled: true, source: "fetched" });

describe("adding a custom provider", () => {
  it("activates it when it is the first provider configured", () => {
    const next = activation({ provider: "", model: "" }, "my-gateway", [model("mixtral-local")], "gpt-4o-mini");
    expect(next).toEqual({ provider: "my-gateway", model: "mixtral-local" });
  });

  it("never leaves a gateway pointed at the catalog fallback", () => {
    // defaultModel() answers gpt-4o-mini outside the catalog. Reached by
    // provider fallback, that made every call fail on an unknown model.
    const next = activation({ provider: "", model: "" }, "my-gateway", [model("llama-3-70b")], "gpt-4o-mini");
    expect(next.model).not.toBe("gpt-4o-mini");
  });

  it("does not hijack a provider the user already has working", () => {
    const next = activation(
      { provider: "zai", model: "glm-5.2" },
      "my-gateway",
      [model("mixtral-local")],
      "gpt-4o-mini",
    );
    expect(next).toEqual({ provider: "zai", model: "glm-5.2" });
  });

  it("falls back to the catalog default when the gateway listed nothing", () => {
    const next = activation({ provider: "", model: "" }, "my-gateway", [], "gpt-4o-mini");
    expect(next).toEqual({ provider: "my-gateway", model: "gpt-4o-mini" });
  });
});
