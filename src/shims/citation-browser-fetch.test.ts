import { afterEach, describe, expect, it, vi } from "vitest";
import browserFetch, { Headers } from "./citation-browser-fetch";
import unsupported from "./citation-browser-sync-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("citation browser fetch shim", () => {
  it("forwards requests to the global fetch", async () => {
    const response = new Response("ok");
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    const init = { method: "GET" };
    await expect(browserFetch("https://doi.org/10.1/x", init)).resolves.toBe(response);
    expect(fetch).toHaveBeenCalledWith("https://doi.org/10.1/x", init);
  });

  it("rejects when no global fetch exists", async () => {
    vi.stubGlobal("fetch", undefined);
    await expect(browserFetch("https://doi.org/10.1/x")).rejects.toThrow("Browser fetch is unavailable.");
  });

  it("re-exports the standard Headers class", () => {
    expect(Headers).toBe(globalThis.Headers);
  });
});

describe("citation sync fetch shim", () => {
  it("refuses synchronous requests but exposes Headers for instanceof checks", () => {
    expect(() => unsupported()).toThrow("Synchronous citation requests are unavailable in the desktop app.");
    expect(unsupported.Headers).toBe(globalThis.Headers);
  });
});
