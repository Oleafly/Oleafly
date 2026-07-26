import { describe, it, expect, vi } from "vitest";
import {
  DISCOVERY,
  discoveryFor,
  fetchProviderModels,
  parseGeminiModels,
  parseOpenAIModels,
} from "./discovery";

const SEED = [{ id: "seed-1", name: "Seed 1" }];

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("parseOpenAIModels", () => {
  it("maps data[].id into id/name pairs and drops non-string ids", () => {
    const models = parseOpenAIModels({ data: [{ id: "gpt-4o" }, { id: 42 }, {}, { id: "o3" }] });
    expect(models).toEqual([
      { id: "gpt-4o", name: "gpt-4o" },
      { id: "o3", name: "o3" },
    ]);
  });

  it("returns [] for malformed payloads", () => {
    expect(parseOpenAIModels(null)).toEqual([]);
    expect(parseOpenAIModels({})).toEqual([]);
    expect(parseOpenAIModels({ data: "nope" })).toEqual([]);
  });
});

describe("parseGeminiModels", () => {
  it("strips the models/ prefix and prefers displayName", () => {
    const models = parseGeminiModels({
      models: [
        { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
        { name: "models/gemini-pro" },
        { displayName: "no name" },
      ],
    });
    expect(models).toEqual([
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      { id: "gemini-pro", name: "gemini-pro" },
    ]);
  });

  it("returns [] for malformed payloads", () => {
    expect(parseGeminiModels(null)).toEqual([]);
    expect(parseGeminiModels({ models: {} })).toEqual([]);
  });
});

describe("fetchProviderModels", () => {
  it("returns the seed without fetching for kind none and ollama", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (const kind of ["none", "ollama"] as const) {
      const res = await fetchProviderModels({
        providerId: "p",
        key: "k",
        discovery: { kind },
        seed: SEED,
        fetchImpl,
      });
      expect(res).toEqual({ ok: true, models: SEED });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps 401/403 to invalid-key", async () => {
    for (const status of [401, 403]) {
      const res = await fetchProviderModels({
        providerId: "openai",
        key: "bad",
        discovery: { kind: "openai" },
        seed: [],
        fetchImpl: fetchReturning(status, {}),
      });
      expect(res).toEqual({ ok: false, reason: "invalid-key" });
    }
  });

  it("maps other HTTP failures to bad-response with the status", async () => {
    const res = await fetchProviderModels({
      providerId: "openai",
      key: "k",
      discovery: { kind: "openai" },
      seed: [],
      fetchImpl: fetchReturning(500, {}),
    });
    expect(res).toEqual({ ok: false, reason: "bad-response", message: "HTTP 500" });
  });

  it("treats an empty model list as bad-response", async () => {
    const res = await fetchProviderModels({
      providerId: "openai",
      key: "k",
      discovery: { kind: "openai" },
      seed: [],
      fetchImpl: fetchReturning(200, { data: [] }),
    });
    expect(res).toEqual({ ok: false, reason: "bad-response", message: "no models returned" });
  });

  it("maps thrown fetch errors to network", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const res = await fetchProviderModels({
      providerId: "openai",
      key: "k",
      discovery: { kind: "openai" },
      seed: [],
      fetchImpl,
    });
    expect(res).toEqual({ ok: false, reason: "network", message: "offline" });
  });

  it("hits the Gemini endpoint with the key in the query string", async () => {
    const fetchImpl = fetchReturning(200, {
      models: [{ name: "models/gemini-pro", displayName: "Gemini Pro" }],
    });
    const res = await fetchProviderModels({
      providerId: "google",
      key: "a b",
      discovery: { kind: "gemini" },
      seed: [],
      fetchImpl,
    });
    expect(res).toEqual({ ok: true, models: [{ id: "gemini-pro", name: "Gemini Pro" }] });
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models?key=a%20b");
  });

  it("uses x-api-key plus anthropic-version when authHeader is x-api-key", async () => {
    const fetchImpl = fetchReturning(200, { data: [{ id: "claude-x" }] });
    await fetchProviderModels({
      providerId: "anthropic",
      baseURL: "https://api.anthropic.com",
      key: "sk-ant",
      discovery: { kind: "openai", modelsPath: "/v1/models", authHeader: "x-api-key" },
      seed: [],
      fetchImpl,
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    expect(init.headers["x-api-key"]).toBe("sk-ant");
    expect(init.headers["anthropic-version"]).toBeTruthy();
    expect(init.headers.authorization).toBeUndefined();
  });

  it("falls back to the OpenAI base and a bearer header, trimming trailing slashes", async () => {
    const fetchImpl = fetchReturning(200, { data: [{ id: "m" }] });
    await fetchProviderModels({
      providerId: "custom",
      baseURL: "https://api.example.com/v1///",
      key: "k",
      discovery: { kind: "openai" },
      seed: [],
      fetchImpl,
    });
    let [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://api.example.com/v1/models");
    expect(init.headers.authorization).toBe("Bearer k");

    await fetchProviderModels({
      providerId: "openai",
      key: "k",
      discovery: { kind: "openai" },
      seed: [],
      fetchImpl,
    });
    [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://api.openai.com/v1/models");
  });
});

describe("DISCOVERY map", () => {
  it("covers the built-in providers with the expected kinds", () => {
    expect(DISCOVERY.google.kind).toBe("gemini");
    expect(DISCOVERY.perplexity.kind).toBe("none");
    expect(DISCOVERY.ollama.kind).toBe("ollama");
    expect(DISCOVERY.zai.kind).toBe("openai");
    expect(DISCOVERY.anthropic.authHeader).toBe("x-api-key");
  });

  it("discoveryFor falls back to kind none for unknown providers", () => {
    expect(discoveryFor("openai")).toBe(DISCOVERY.openai);
    expect(discoveryFor("nope")).toEqual({ kind: "none" });
  });
});
