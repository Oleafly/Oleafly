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
