import { beforeEach, describe, it, expect } from "vitest";
import type { ModelMetadata, StoredModel } from "@/lib/tauri";
import {
  MODEL_LIST_AUTO_REFRESH_MS,
  MODEL_LIST_REFRESH_THROTTLE_MS,
  addCustomModel,
  claimModelListAutoRefresh,
  clearModelListThrottle,
  deleteModel,
  describeModelListChange,
  diffModelLists,
  enabledModels,
  formatContextWindow,
  formatRelativeTime,
  mergeFetchedModels,
  mergeModelProbes,
  modelCapabilityChips,
  modelIsChatOnly,
  modelListThrottledUntil,
  pickActiveModel,
  probeKey,
  reconcileActiveModel,
  resetModelListRefreshLedger,
  resolveModelTrust,
  restoreSeedModels,
  seedProviderModels,
  setModelEnabled,
  shouldAutoRefreshModels,
  throttleModelListRefresh,
} from "./ai-model-state";

const metadata = (overrides: Partial<ModelMetadata> = {}): ModelMetadata => ({
  name: "Model",
  contextWindow: 128000,
  outputLimit: 16384,
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  toolCall: true,
  reasoning: false,
  attachment: true,
  structuredOutput: true,
  status: "active",
  ...overrides,
});

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

  it("stores trust and metadata from the fetch on new and surviving entries", () => {
    const meta = metadata();
    const merged = mergeFetchedModels([stored("a", false)], [
      { id: "a", name: "A", trust: "verified", metadata: meta },
      { id: "b", name: "B", trust: "untested" },
      { id: "c", name: "C", trust: "blocked", blockedReason: "Its thinking output breaks the loop." },
    ]);
    expect(merged).toEqual([
      { id: "a", name: "a", enabled: false, source: "builtin", trust: "verified", metadata: meta },
      { id: "b", name: "B", enabled: true, source: "fetched", trust: "untested" },
      {
        id: "c",
        name: "C",
        enabled: true,
        source: "fetched",
        trust: "blocked",
        blockedReason: "Its thinking output breaks the loop.",
      },
    ]);
  });

  it("replaces stale trust with the latest fetch and drops an old blocked reason", () => {
    const previous: StoredModel = {
      ...stored("a", true, "fetched"),
      trust: "blocked",
      blockedReason: "Old reason",
      metadata: metadata({ contextWindow: 8000 }),
    };
    const merged = mergeFetchedModels([previous], [{ id: "a", name: "A", trust: "verified" }]);
    expect(merged[0].trust).toBe("verified");
    expect(merged[0]).not.toHaveProperty("blockedReason");
    expect(merged[0].metadata?.contextWindow).toBe(8000);
  });

  it("keeps the trust and metadata already stored when the fetch carries none", () => {
    const meta = metadata();
    const previous: StoredModel = { ...stored("a", true, "fetched"), trust: "verified", metadata: meta };
    const merged = mergeFetchedModels([previous], [{ id: "a", name: "A" }]);
    expect(merged[0].trust).toBe("verified");
    expect(merged[0].metadata).toBe(meta);
  });

  it("keeps the previous list when the provider returns nothing readable", () => {
    const existing = [stored("a", true, "fetched"), stored("b", false, "builtin")];
    expect(mergeFetchedModels(existing, [])).toBe(existing);
    expect(mergeFetchedModels(existing, [{ id: "  ", name: "blank" }])).toBe(existing);
  });

  it("ignores blank and duplicate ids in the fetched list", () => {
    const merged = mergeFetchedModels([], [
      { id: " a ", name: "A" },
      { id: "", name: "" },
      { id: "a", name: "A again" },
    ]);
    expect(merged.map((m) => m.id)).toEqual(["a"]);
  });

  it("keeps a hand-added model and updates its facts when the provider lists it", () => {
    const custom: StoredModel = { ...stored("mine", true, "custom"), trust: "untested" };
    const merged = mergeFetchedModels([custom], [
      { id: "mine", name: "Mine", trust: "verified", metadata: metadata() },
      { id: "other", name: "Other", trust: "untested" },
    ]);
    expect(merged[0]).toMatchObject({ id: "mine", source: "custom", trust: "verified" });
    expect(merged[0].metadata?.contextWindow).toBe(128000);
    expect(merged[1].id).toBe("other");
  });
});

describe("model list refresh helpers", () => {
  it("counts added and removed ids between two lists", () => {
    const before = [stored("a"), stored("b")];
    const after = [stored("b"), stored("c"), stored("d")];
    expect(diffModelLists(before, after)).toEqual({ added: 2, removed: 1 });
    expect(describeModelListChange({ added: 2, removed: 1 })).toBe("2 added, 1 removed");
    expect(describeModelListChange({ added: 0, removed: 0 })).toBe("No changes");
  });

  it("asks for an automatic refresh only once a day", () => {
    const now = 1_700_000_000_000;
    expect(shouldAutoRefreshModels(undefined, now)).toBe(true);
    expect(shouldAutoRefreshModels(now - 60 * 60 * 1000, now)).toBe(false);
    expect(shouldAutoRefreshModels(now - 25 * 60 * 60 * 1000, now)).toBe(true);
  });

  it("describes when a list was last updated", () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 60_000, now)).toBe("1 minute ago");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe("3 hours ago");
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe("2 days ago");
    expect(formatRelativeTime(now - 40 * 24 * 60 * 60_000, now)).toBe(
      new Date(now - 40 * 24 * 60 * 60_000).toLocaleDateString(),
    );
  });
});

describe("model trust resolution", () => {
  it("lets a catalog block win over any probe", () => {
    const resolved = resolveModelTrust(
      { trust: "blocked", blockedReason: "Catalog says no." },
      { verdict: "verified", reason: "", probedAt: 5 },
    );
    expect(resolved).toEqual({ trust: "blocked", reason: "Catalog says no.", source: "catalog" });
  });

  it("upgrades an untested model with a verified probe and blocks with a failed one", () => {
    expect(
      resolveModelTrust({ trust: "untested" }, { verdict: "verified", reason: "", probedAt: 1 }),
    ).toEqual({ trust: "verified", source: "probe" });
    expect(
      resolveModelTrust({ trust: "untested" }, { verdict: "blocked", reason: "No tool call came back.", probedAt: 1 }),
    ).toEqual({ trust: "blocked", reason: "No tool call came back.", source: "probe" });
  });

  it("reports nothing for a model that was never listed or probed", () => {
    expect(resolveModelTrust(undefined, undefined)).toEqual({});
    expect(resolveModelTrust({ trust: "verified" }, undefined)).toEqual({
      trust: "verified",
      source: "catalog",
    });
  });

  it("keeps the newest probe per model when merging", () => {
    const merged = mergeModelProbes(
      { "openai/a": { verdict: "blocked", reason: "old", probedAt: 10 } },
      {
        "openai/a": { verdict: "verified", reason: "", probedAt: 20 },
        "openai/b": { verdict: "verified", reason: "", probedAt: 1 },
      },
    );
    expect(merged["openai/a"].verdict).toBe("verified");
    expect(merged["openai/b"].probedAt).toBe(1);
    expect(mergeModelProbes(merged, { "openai/a": { verdict: "blocked", reason: "older", probedAt: 5 } })["openai/a"].verdict).toBe("verified");
    expect(probeKey("openai", "gpt-4o")).toBe("openai/gpt-4o");
  });

  it("treats only an explicit toolCall false as chat only", () => {
    expect(modelIsChatOnly({ metadata: metadata({ toolCall: false }) })).toBe(true);
    expect(modelIsChatOnly({ metadata: metadata() })).toBe(false);
    expect(modelIsChatOnly({})).toBe(false);
    expect(modelIsChatOnly(undefined)).toBe(false);
  });
});

describe("capability chips", () => {
  it("shortens context windows", () => {
    expect(formatContextWindow(128000)).toBe("128k");
    expect(formatContextWindow(200000)).toBe("200k");
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(1_500_000)).toBe("1.5M");
    expect(formatContextWindow(512)).toBe("512");
    expect(formatContextWindow(0)).toBe("");
  });

  it("derives chips from metadata and nothing without it", () => {
    expect(modelCapabilityChips(undefined)).toEqual([]);
    const chips = modelCapabilityChips(metadata({ reasoning: true, status: "deprecated" }));
    expect(chips.map((chip) => chip.label)).toEqual(["128k", "Vision", "Tools", "Reasoning", "Deprecated"]);
    const textOnly = modelCapabilityChips(
      metadata({ inputModalities: ["text"], toolCall: false, contextWindow: undefined }),
    );
    expect(textOnly).toEqual([]);
  });
});

describe("model list edits", () => {
  it("enabledModels filters disabled entries", () => {
    expect(enabledModels([stored("a", false), stored("b")])).toEqual([stored("b")]);
  });

  it("addCustomModel appends once as untested and ignores duplicates", () => {
    const withCustom = addCustomModel([stored("a")], { id: "x", name: "" });
    expect(withCustom).toEqual([
      stored("a"),
      { id: "x", name: "x", enabled: true, source: "custom", trust: "untested" },
    ]);
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

  it("keeps every stored model when the provider list is temporarily empty", () => {
    const existing = [
      stored("old-builtin", "builtin"),
      stored("old-fetched", "fetched"),
      stored("private", "custom", false),
    ];
    expect(mergeFetchedModels(existing, [])).toBe(existing);
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

describe("model list refresh ledger", () => {
  beforeEach(() => {
    resetModelListRefreshLedger();
  });

  it("throttles a provider for thirty seconds and forgets it afterwards", () => {
    expect(modelListThrottledUntil("openai", 1_000)).toBe(0);
    const until = throttleModelListRefresh("openai", 1_000);
    expect(until).toBe(1_000 + MODEL_LIST_REFRESH_THROTTLE_MS);
    expect(modelListThrottledUntil("openai", until - 1)).toBe(until);
    expect(modelListThrottledUntil("openai", until)).toBe(0);
    expect(modelListThrottledUntil("anthropic", 1_000)).toBe(0);
  });

  it("clears a throttle on request", () => {
    throttleModelListRefresh("openai", 1_000);
    clearModelListThrottle("openai");
    expect(modelListThrottledUntil("openai", 1_001)).toBe(0);
  });

  it("claims the daily automatic refresh once per provider whatever the outcome", () => {
    expect(claimModelListAutoRefresh("openai", 1_000)).toBe(true);
    expect(claimModelListAutoRefresh("openai", 1_000 + MODEL_LIST_AUTO_REFRESH_MS - 1)).toBe(false);
    expect(claimModelListAutoRefresh("anthropic", 1_000)).toBe(true);
    expect(claimModelListAutoRefresh("openai", 1_000 + MODEL_LIST_AUTO_REFRESH_MS)).toBe(true);
  });

  it("starts over when the ledger is reset", () => {
    throttleModelListRefresh("openai", 1_000);
    claimModelListAutoRefresh("openai", 1_000);
    resetModelListRefreshLedger();
    expect(modelListThrottledUntil("openai", 1_001)).toBe(0);
    expect(claimModelListAutoRefresh("openai", 1_001)).toBe(true);
  });
});
