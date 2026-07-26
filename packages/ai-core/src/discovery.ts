import type { AIModel } from "./providers";

export type DiscoveryKind = "openai" | "gemini" | "ollama" | "none";

export interface ModelDiscovery {
  kind: DiscoveryKind;
  /** Path appended to the provider baseURL; defaults to "/models". */
  modelsPath?: string;
  authHeader?: "authorization" | "x-api-key" | "query-key";
  extraHeaders?: Record<string, string>;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function parseOpenAIModels(json: unknown): AIModel[] {
  const data = (json as { data?: unknown })?.data;
  return asArray(data)
    .map((m) => (m as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string")
    .map((id) => ({ id, name: id }));
}

export function parseGeminiModels(json: unknown): AIModel[] {
  const models = (json as { models?: unknown })?.models;
  return asArray(models)
    .map((m) => m as { name?: unknown; displayName?: unknown })
    .filter((m) => typeof m.name === "string")
    .map((m) => {
      const id = (m.name as string).replace(/^models\//, "");
      const name = typeof m.displayName === "string" ? m.displayName : id;
      return { id, name };
    });
}

export type FetchModelsResult =
  | { ok: true; models: AIModel[] }
  | { ok: false; reason: "invalid-key" | "network" | "bad-response"; message?: string };

export async function fetchProviderModels(args: {
  providerId: string;
  baseURL?: string;
  key: string;
  discovery: ModelDiscovery;
  seed: AIModel[];
  fetchImpl?: typeof fetch;
}): Promise<FetchModelsResult> {
  const { discovery, key, seed } = args;
  if (discovery.kind === "none" || discovery.kind === "ollama") {
    return { ok: true, models: seed };
  }
  const doFetch = args.fetchImpl ?? fetch;
  const base = (args.baseURL ?? "").replace(/\/+$/, "");
  try {
    let url: string;
    const headers: Record<string, string> = { ...(discovery.extraHeaders ?? {}) };
    if (discovery.kind === "gemini") {
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    } else {
      const path = discovery.modelsPath ?? "/models";
      url = base ? `${base}${path}` : `https://api.openai.com/v1${path}`;
      if (discovery.authHeader === "x-api-key") {
        headers["x-api-key"] = key;
        headers["anthropic-version"] = headers["anthropic-version"] ?? "2023-06-01";
      } else {
        headers["authorization"] = `Bearer ${key}`;
      }
    }
    const resp = await doFetch(url, { headers });
    if (resp.status === 401 || resp.status === 403) return { ok: false, reason: "invalid-key" };
    if (!resp.ok) return { ok: false, reason: "bad-response", message: `HTTP ${resp.status}` };
    const json = await resp.json();
    const models = discovery.kind === "gemini" ? parseGeminiModels(json) : parseOpenAIModels(json);
    if (models.length === 0) return { ok: false, reason: "bad-response", message: "no models returned" };
    return { ok: true, models };
  } catch (e) {
    return { ok: false, reason: "network", message: e instanceof Error ? e.message : String(e) };
  }
}
