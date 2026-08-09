import { describe, it, expect } from "vitest";
import type { StoredModel } from "@/lib/tauri";
import {
  addCustomModel,
  deleteModel,
  enabledModels,
  mergeFetchedModels,
  pickActiveModel,
  reconcileActiveModel,
  restoreSeedModels,
  seedProviderModels,
  setModelEnabled,
} from "./ai-model-state";

const stored = (id: string, enabled = true, source: StoredModel["source"] = "builtin"): StoredModel => ({
  id,
  name: id,
  enabled,
  source,
});

describe("seedProviderModels", () => {
  it("seeds a known provider's catalog as enabled builtins", () => {
    const seeds = seedProviderModels("openai");
    expect(seeds.length).toBeGreaterThan(0);
    for (const m of seeds) {
      expect(m.enabled).toBe(true);
      expect(m.source).toBe("builtin");
    }
  });

  it("returns [] for an unknown provider", () => {
    expect(seedProviderModels("nope")).toEqual([]);
  });
});

describe("mergeFetchedModels", () => {
  it("keeps listed entries (enabled state and name) and appends new ones as fetched", () => {
    const existing = [stored("a", false), stored("b")];
    const merged = mergeFetchedModels(existing, [
      { id: "a", name: "A renamed" },
      { id: "c", name: "C" },
    ]);
    expect(merged).toEqual([
      { id: "a", name: "a", enabled: false, source: "builtin" },
      { id: "c", name: "C", enabled: true, source: "fetched" },
    ]);
  });

  it("fills in a missing name from the fetched entry", () => {
    const existing: StoredModel[] = [{ id: "a", name: "", enabled: true, source: "builtin" }];
    const merged = mergeFetchedModels(existing, [{ id: "a", name: "A" }]);
    expect(merged[0].name).toBe("A");
  });
});

describe("model list edits", () => {
  it("enabledModels filters disabled entries", () => {
    expect(enabledModels([stored("a", false), stored("b")])).toEqual([stored("b")]);
  });

  it("addCustomModel appends once and ignores duplicates", () => {
    const withCustom = addCustomModel([stored("a")], { id: "x", name: "" });
    expect(withCustom).toEqual([stored("a"), { id: "x", name: "x", enabled: true, source: "custom" }]);
    expect(addCustomModel(withCustom, { id: "x", name: "X" })).toBe(withCustom);
  });

  it("setModelEnabled toggles only the matching id", () => {
    const next = setModelEnabled([stored("a"), stored("b")], "a", false);
    expect(next).toEqual([stored("a", false), stored("b")]);
  });

  it("deleteModel removes the matching id", () => {
    expect(deleteModel([stored("a"), stored("b")], "a")).toEqual([stored("b")]);
  });
});

describe("restoreSeedModels", () => {
  it("re-adds deleted seed models while keeping existing entries untouched", () => {
    const seeds = seedProviderModels("openai");
    const kept = { ...seeds[0], enabled: false };
    const custom = stored("my-model", true, "custom");
    const restored = restoreSeedModels([kept, custom], "openai");
    expect(restored[0]).toEqual(kept);
    expect(restored[1]).toEqual(custom);
    expect(restored.map((m) => m.id).sort()).toEqual(
      [...seeds.map((m) => m.id), "my-model"].sort()
    );
  });

  it("returns the same list when nothing is missing", () => {
    const full = seedProviderModels("openai");
    expect(restoreSeedModels(full, "openai")).toBe(full);
  });

  it("is a no-op for providers without seeds", () => {
    const list = [stored("a")];
    expect(restoreSeedModels(list, "unknown")).toBe(list);
  });
});

describe("reconciling a refreshed model list", () => {
  const stored = (id: string, source: StoredModel["source"], enabled = true): StoredModel => ({
    id,
    name: id,
    enabled,
    source,
  });

  it("adds models the provider has started offering", () => {
    const next = mergeFetchedModels([stored("glm-4.6", "fetched")], [
      { id: "glm-4.6", name: "GLM-4.6" },
      { id: "glm-5.2", name: "GLM-5.2" },
    ]);
    expect(next.map((m) => m.id)).toEqual(["glm-4.6", "glm-5.2"]);
  });

  it("drops a discovered model the provider has deprecated", () => {
    const next = mergeFetchedModels(
      [stored("glm-4.5", "fetched"), stored("glm-5.2", "fetched")],
      [{ id: "glm-5.2", name: "GLM-5.2" }],
    );
    expect(next.map((m) => m.id)).toEqual(["glm-5.2"]);
  });

  it("keeps a model the user added by hand", () => {
    const next = mergeFetchedModels(
      [stored("my-private-model", "custom"), stored("gone", "fetched")],
      [{ id: "glm-5.2", name: "GLM-5.2" }],
    );
    expect(next.map((m) => m.id)).toEqual(["my-private-model", "glm-5.2"]);
  });

  it("drops a built-in seed the provider no longer lists", () => {
    const next = mergeFetchedModels([stored("glm-5.2", "builtin")], [
      { id: "glm-4.6", name: "GLM-4.6" },
    ]);
    expect(next.map((m) => m.id)).toEqual(["glm-4.6"]);
  });

  it("removes absent built-in and fetched models while retaining custom models", () => {
    const next = mergeFetchedModels(
      [
        stored("old-builtin", "builtin"),
        stored("old-fetched", "fetched"),
        stored("private", "custom", false),
      ],
      [],
    );
    expect(next).toEqual([stored("private", "custom", false)]);
  });

  it("does not treat unsupported or failed discovery as an authoritative empty list", () => {
    const existing = [stored("catalog-default", "builtin"), stored("private", "custom")];
    expect(mergeFetchedModels(existing, null)).toBe(existing);
  });

  it("preserves the enabled state of a model that survives", () => {
    const next = mergeFetchedModels([stored("glm-5.2", "fetched", false)], [
      { id: "glm-5.2", name: "GLM-5.2" },
    ]);
    expect(next[0].enabled).toBe(false);
  });
});

describe("choosing the active model after a key is saved", () => {
  const stored = (id: string, enabled = true): StoredModel => ({
    id,
    name: id,
    enabled,
    source: "fetched",
  });

  it("uses the catalog default when the provider actually offers it", () => {
    const models = [stored("glm-4.6"), stored("glm-5.2")];
    expect(pickActiveModel(models, "glm-5.2")).toBe("glm-5.2");
  });

  it("falls back to what the provider offered when the default is not on the plan", () => {
    const models = [stored("glm-4.5-air"), stored("glm-4.6")];
    expect(pickActiveModel(models, "glm-5.2")).toBe("glm-4.5-air");
  });

  it("never points a custom gateway at the catalog fallback", () => {
    const models = [stored("mixtral-local")];
    expect(pickActiveModel(models, "gpt-4o-mini")).toBe("mixtral-local");
  });

  it("ignores disabled models when a usable one exists", () => {
    const models = [stored("disabled-one", false), stored("usable")];
    expect(pickActiveModel(models, "gpt-4o-mini")).toBe("usable");
  });

  it("keeps the catalog default when the provider listed nothing", () => {
    expect(pickActiveModel([], "glm-5.2")).toBe("glm-5.2");
  });

  it("replaces a selected model removed by live discovery with an enabled survivor", () => {
    const models = [stored("disabled", false), stored("available")];
    expect(reconcileActiveModel(models, "deprecated", "catalog-default")).toBe("available");
  });

  it("keeps a selected model that remains enabled", () => {
    const models = [stored("selected"), stored("other")];
    expect(reconcileActiveModel(models, "selected", "other")).toBe("selected");
  });

  it("clears the selection when discovery leaves no enabled model", () => {
    expect(reconcileActiveModel([stored("disabled", false)], "gone", "disabled")).toBe("");
  });
});
