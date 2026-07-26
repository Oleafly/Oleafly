import { describe, it, expect } from "vitest";
import type { StoredModel } from "@/lib/tauri";
import {
  addCustomModel,
  deleteModel,
  enabledModels,
  mergeFetchedModels,
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
  it("keeps existing entries (enabled state and name) and appends new ones as fetched", () => {
    const existing = [stored("a", false), stored("b")];
    const merged = mergeFetchedModels(existing, [
      { id: "a", name: "A renamed" },
      { id: "c", name: "C" },
    ]);
    expect(merged).toEqual([
      { id: "a", name: "a", enabled: false, source: "builtin" },
      { id: "b", name: "b", enabled: true, source: "builtin" },
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
