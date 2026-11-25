// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const getConfig = vi.fn();
vi.mock("@/lib/tauri", () => ({
  getConfig: (...args: unknown[]) => getConfig(...args),
}));

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
    getConfig.mockResolvedValue({ });
    const [a, b] = await Promise.all([getConfigCached(), getConfigCached()]);
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("serves later reads from the cache", async () => {
    const { getConfigCached } = await loadModule();
    getConfig.mockResolvedValue({ });
    await getConfigCached();
    await getConfigCached();
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed read", async () => {
    const { getConfigCached } = await loadModule();
    getConfig.mockRejectedValueOnce(new Error("ipc down"));
    getConfig.mockResolvedValue({ });
    await expect(getConfigCached()).rejects.toThrow("ipc down");
    await expect(getConfigCached()).resolves.toEqual({ });
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it("invalidates on explicit request", async () => {
    const { getConfigCached, invalidateConfigCache } = await loadModule();
    getConfig.mockResolvedValue({ });
    await getConfigCached();
    invalidateConfigCache();
    await getConfigCached();
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it("serves a config handed over at startup without reading it again", async () => {
    const { getConfigCached, primeConfigCache } = await loadModule();
    primeConfigCache({ } as never);
    await expect(getConfigCached()).resolves.toEqual({ });
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("keeps an in-flight read instead of a later startup config", async () => {
    const { getConfigCached, primeConfigCache } = await loadModule();
    getConfig.mockResolvedValue({ });
    const pending = getConfigCached();
    primeConfigCache({ } as never);
    await expect(pending).resolves.toEqual({ });
    await expect(getConfigCached()).resolves.toEqual({ });
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("drops a startup config once the config changes", async () => {
    const { getConfigCached, primeConfigCache } = await loadModule();
    getConfig.mockResolvedValue({ });
    primeConfigCache({ } as never);
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed"));
    await expect(getConfigCached()).resolves.toEqual({ });
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("invalidates when the ai-config-changed event fires", async () => {
    const { getConfigCached } = await loadModule();
    getConfig.mockResolvedValue({ });
    await getConfigCached();
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed"));
    await getConfigCached();
    expect(getConfig).toHaveBeenCalledTimes(2);
  });
});
