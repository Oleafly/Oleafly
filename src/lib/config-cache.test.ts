// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const getConfig = vi.fn();
vi.mock("@/lib/tauri", () => ({
  getConfig: (...args: unknown[]) => getConfig(...args),
}));

// Module-level cache state: import a fresh copy per test.
async function loadModule() {
  vi.resetModules();
  return import("./config-cache");
}

describe("getConfigCached", () => {
  beforeEach(() => {
    getConfig.mockReset();
  });

  it("single-flights concurrent reads into one IPC call", async () => {
    const { getConfigCached } = await loadModule();
    getConfig.mockResolvedValue({ ai_provider: "openai" });
    const [a, b] = await Promise.all([getConfigCached(), getConfigCached()]);
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("serves later reads from the cache", async () => {
    const { getConfigCached } = await loadModule();
    getConfig.mockResolvedValue({ ai_provider: "openai" });
    await getConfigCached();
    await getConfigCached();
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed read", async () => {
    const { getConfigCached } = await loadModule();
    getConfig.mockRejectedValueOnce(new Error("ipc down"));
    getConfig.mockResolvedValue({ ai_provider: "openai" });
    await expect(getConfigCached()).rejects.toThrow("ipc down");
    await expect(getConfigCached()).resolves.toEqual({ ai_provider: "openai" });
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it("invalidates on explicit request", async () => {
    const { getConfigCached, invalidateConfigCache } = await loadModule();
    getConfig.mockResolvedValue({ ai_provider: "openai" });
    await getConfigCached();
    invalidateConfigCache();
    await getConfigCached();
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it("invalidates when the ai-config-changed event fires", async () => {
    const { getConfigCached } = await loadModule();
    getConfig.mockResolvedValue({ ai_provider: "openai" });
    await getConfigCached();
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed"));
    await getConfigCached();
    expect(getConfig).toHaveBeenCalledTimes(2);
  });
});
