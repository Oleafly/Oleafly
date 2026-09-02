// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";

const getConfig = vi.fn();
let snapshot: AppConfig | null = null;

vi.mock("@/lib/tauri", () => ({
  getConfig: (...args: unknown[]) => getConfig(...args),
}));

vi.mock("@/lib/initial-state", () => ({
  getSnapshotConfig: () => snapshot,
}));

async function loadModule() {
  vi.resetModules();
  return import("./provider-config");
}

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ai_provider: "openai",
    ai_model: "gpt-4o",
    ai_keys: { openai: "sk-test" },
    ...overrides,
  } as AppConfig;
}

describe("deriveProviderState", () => {
  it("keeps the saved provider and model when its key is present", async () => {
    const { deriveProviderState } = await loadModule();
    const state = deriveProviderState(config());
    expect(state).toMatchObject({ provider: "openai", model: "gpt-4o", apiKey: "sk-test" });
  });

  it("falls back to the first configured provider and its default model", async () => {
    const { deriveProviderState } = await loadModule();
    const state = deriveProviderState(
      config({ ai_provider: "anthropic", ai_keys: { openai: "sk-test", groq: "" } }),
    );
    expect(state.provider).toBe("openai");
    expect(state.apiKey).toBe("sk-test");
    expect(state.model).not.toBe("");
    expect(state.model).not.toBe("gpt-4o-mini-anthropic");
  });

  it("folds the legacy single key into the key map", async () => {
    const { deriveProviderState } = await loadModule();
    const state = deriveProviderState(config({ ai_keys: {}, ai_api_key: "legacy" }));
    expect(state.apiKey).toBe("legacy");
    expect(state.keysMap).toEqual({ openai: "legacy" });
  });

  it("treats a key optional custom provider as configured without a key", async () => {
    const { deriveProviderState } = await loadModule();
    const state = deriveProviderState(
      config({
        ai_provider: "local",
        ai_keys: {},
        ai_custom_providers: [
          { id: "local", name: "Local", baseUrl: "http://localhost", keyOptional: true, models: [] },
        ] as unknown as AppConfig["ai_custom_providers"],
      }),
    );
    expect(state.provider).toBe("local");
    expect(state.apiKey).toBe("");
    expect(state.customProviders).toHaveLength(1);
  });
});

describe("provider config cache", () => {
  beforeEach(() => {
    getConfig.mockReset();
    snapshot = null;
  });

  it("knows nothing before the first read and falls back to the boot snapshot", async () => {
    const { knownProviderConfig } = await loadModule();
    expect(knownProviderConfig()).toBeNull();
    snapshot = config();
    expect(knownProviderConfig()).toBe(snapshot);
  });

  it("single-flights concurrent loads and remembers the result", async () => {
    const { knownProviderConfig, loadProviderConfig } = await loadModule();
    const loaded = config();
    getConfig.mockResolvedValue(loaded);
    const [a, b] = await Promise.all([loadProviderConfig(), loadProviderConfig()]);
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(a).toBe(loaded);
    expect(b).toBe(loaded);
    expect(knownProviderConfig()).toBe(loaded);
    await loadProviderConfig();
    expect(getConfig).toHaveBeenCalledTimes(1);
    const { invalidateConfigCache } = await import("@/lib/config-cache");
    invalidateConfigCache();
    await loadProviderConfig();
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failed read", async () => {
    const { knownProviderConfig, loadProviderConfig } = await loadModule();
    getConfig.mockRejectedValueOnce(new Error("ipc down"));
    await expect(loadProviderConfig()).rejects.toThrow("ipc down");
    expect(knownProviderConfig()).toBeNull();
    getConfig.mockResolvedValue(config());
    await expect(loadProviderConfig()).resolves.toEqual(config());
  });

  it("notifies subscribers when a config is remembered and stops after unsubscribe", async () => {
    const { rememberProviderConfig, subscribeProviderConfig } = await loadModule();
    const listener = vi.fn();
    const unsubscribe = subscribeProviderConfig(listener);
    const remembered = config();
    rememberProviderConfig(remembered);
    expect(listener).toHaveBeenCalledWith(remembered);
    unsubscribe();
    rememberProviderConfig(config());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("adopts a config carried by the ai-config-changed event without an IPC read", async () => {
    const { knownProviderConfig, subscribeProviderConfig } = await loadModule();
    const listener = vi.fn();
    subscribeProviderConfig(listener);
    const next = config({ ai_keys: { groq: "g" } });
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail: next }));
    expect(getConfig).not.toHaveBeenCalled();
    expect(knownProviderConfig()).toBe(next);
    expect(listener).toHaveBeenCalledWith(next);
  });

  it("reloads when the ai-config-changed event carries no config", async () => {
    const { knownProviderConfig } = await loadModule();
    const reloaded = config({ ai_keys: { groq: "g" } });
    getConfig.mockResolvedValue(reloaded);
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed"));
    await vi.waitFor(() => expect(knownProviderConfig()).toBe(reloaded));
    expect(getConfig).toHaveBeenCalled();
  });

  it("forgets everything on reset", async () => {
    const { knownProviderConfig, loadProviderConfig, resetProviderConfigCache } =
      await loadModule();
    getConfig.mockResolvedValue(config());
    await loadProviderConfig();
    resetProviderConfigCache();
    expect(knownProviderConfig()).toBeNull();
  });
});
