import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";

export interface AIModel {
  id: string;
  name: string;
}

export interface AIProvider {
  id: string;
  name: string;
  blurb: string;
  /** Where to get a key (or, for Ollama, that it's local). */
  signupUrl?: string;
  /** Fixed OpenAI-compatible base URL. Omit for OpenAI itself. */
  baseURL?: string;
  /** Credential is a host URL, not an API key (Ollama). */
  isHost?: boolean;
  models: AIModel[];
}

/**
 * Supported AI providers. Most are OpenAI-compatible and work with just an API
 * key via `createOpenAI({ baseURL })`. Anthropic uses its own SDK. Ollama runs
 * locally and takes a host URL instead of a key.
 */
export const PROVIDERS: AIProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    blurb: "GPT models. The default choice.",
    signupUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 mini" },
      { id: "o3-mini", name: "o3-mini" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    blurb: "Claude models - strong at code and writing.",
    signupUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
    ],
  },
  {
    id: "zai",
    name: "Z.AI (GLM Coding Plan)",
    blurb: "GLM models via a Z.AI GLM Coding Plan subscription.",
    signupUrl: "https://z.ai/subscribe",
    // Use the Coding Plan endpoint. The general /api/paas/v4 one bills separate
    // pay-as-you-go balance and returns "insufficient balance" for plan keys —
    // which is what most people using GLM in a coding tool actually have.
    baseURL: "https://api.z.ai/api/coding/paas/v4",
    models: [
      { id: "glm-5.2", name: "GLM-5.2" },
      { id: "glm-4.6", name: "GLM-4.6" },
      { id: "glm-4.5-air", name: "GLM-4.5 Air" },
      { id: "glm-4.5", name: "GLM-4.5" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    blurb: "Very fast Llama & Mixtral inference.",
    signupUrl: "https://console.groq.com/keys",
    baseURL: "https://api.groq.com/openai/v1",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    blurb: "One key, access models from many labs.",
    signupUrl: "https://openrouter.ai/keys",
    baseURL: "https://openrouter.ai/api/v1",
    models: [
      { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
      { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
      { id: "google/gemini-flash-1.5", name: "Gemini Flash 1.5" },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    blurb: "DeepSeek V3 / R1 reasoning models.",
    signupUrl: "https://platform.deepseek.com/api_keys",
    baseURL: "https://api.deepseek.com",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3 (chat)" },
      { id: "deepseek-reasoner", name: "DeepSeek R1 (reasoner)" },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    blurb: "Mistral & Codestral models.",
    signupUrl: "https://console.mistral.ai/api-keys",
    baseURL: "https://api.mistral.ai/v1",
    models: [
      { id: "mistral-large-latest", name: "Mistral Large" },
      { id: "codestral-latest", name: "Codestral" },
      { id: "mistral-small-latest", name: "Mistral Small" },
    ],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    blurb: "Grok models from xAI.",
    signupUrl: "https://console.x.ai",
    baseURL: "https://api.x.ai/v1",
    models: [
      { id: "grok-2", name: "Grok 2" },
      { id: "grok-beta", name: "Grok Beta" },
    ],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    blurb: "Runs models on your machine. No key needed - install Ollama and pull a model.",
    signupUrl: "https://ollama.com/download",
    isHost: true,
    models: [
      { id: "llama3.2", name: "Llama 3.2" },
      { id: "qwen2.5", name: "Qwen 2.5" },
      { id: "mistral", name: "Mistral" },
      { id: "gemma2", name: "Gemma 2" },
    ],
  },
];

export const PROVIDER_BY_ID: Record<string, AIProvider> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p])
);

export function getProvider(id: string): AIProvider | undefined {
  return PROVIDER_BY_ID[id];
}

export function defaultModel(providerId: string): string {
  return getProvider(providerId)?.models[0]?.id ?? "gpt-4o-mini";
}

/** The credential label/placeholder for a provider's input. */
export function credentialMeta(providerId: string): { label: string; placeholder: string } {
  const p = getProvider(providerId);
  if (p?.isHost) {
    return { label: "Host URL", placeholder: "http://localhost:11434" };
  }
  return { label: "API key", placeholder: "sk-…" };
}

/**
 * Build a runnable model for a provider. OpenAI-compatible providers (incl.
 * Groq, OpenRouter, DeepSeek, Mistral, xAI) use `createOpenAI` with a baseURL.
 * Anthropic uses its own client. Ollama uses the OpenAI shim against the local
 * server with a dummy key.
 */
export function buildModel(provider: string, model: string, credential: string) {
  if (provider === "anthropic") {
    return createAnthropic({ apiKey: credential })(model);
  }
  if (provider === "ollama") {
    const host = (credential || "http://localhost:11434").replace(/\/+$/, "");
    return createOpenAI({ baseURL: `${host}/v1`, apiKey: "ollama" }).chat(model);
  }
  // GLM and DeepSeek stream their thinking phase as `reasoning_content`, a
  // field the strict OpenAI provider silently drops. Dropping it means the
  // app sees TOTAL silence while the model thinks, so the stall watchdog
  // aborts long-thinking runs (GLM-4.6) with no reply. The openai-compatible
  // provider maps reasoning_content into real reasoning stream parts.
  if (provider === "zai" || provider === "deepseek") {
    const p = getProvider(provider);
    return createOpenAICompatible({
      name: provider,
      baseURL: p?.baseURL ?? "",
      apiKey: credential,
    }).chatModel(model);
  }
  const baseURL = getProvider(provider)?.baseURL;
  return createOpenAI({
    apiKey: credential,
    ...(baseURL ? { baseURL } : {}),
  }).chat(model);
}

/** The AI-related fields of the app config that provider resolution reads. */
export interface AIConfigLike {
  ai_provider?: string;
  ai_model?: string;
  ai_api_key?: string;
  ai_keys?: Record<string, string>;
}

/**
 * Resolve the active provider/model/credential from the stored config, matching
 * the chat panel's logic: prefer the saved provider if it has a key, otherwise
 * fall back to the first configured one; fold the legacy single key into the map.
 */
export function pickActiveProvider(cfg: AIConfigLike): {
  providerId: string;
  modelId: string;
  credential: string;
} {
  const saved = cfg.ai_provider || "openai";
  const keys = { ...(cfg.ai_keys ?? {}) };
  if (cfg.ai_api_key && !keys[saved]) keys[saved] = cfg.ai_api_key;
  const configured = Object.keys(keys).filter((k) => (keys[k] ?? "").trim());
  const providerId = (keys[saved] ?? "").trim() ? saved : configured[0] ?? saved;
  const credential = keys[providerId] ?? "";
  const modelId =
    providerId === saved && cfg.ai_model ? cfg.ai_model : defaultModel(providerId);
  return { providerId, modelId, credential };
}

/** Whether any provider is configured with a non-empty key/host. */
export function hasConfiguredProvider(cfg: AIConfigLike): boolean {
  return pickActiveProvider(cfg).credential.trim().length > 0;
}

/** Build the runnable model for the active provider, plus a display label. */
export function resolveActiveModel(cfg: AIConfigLike): {
  model: ReturnType<typeof buildModel>;
  providerId: string;
  modelId: string;
  label: string;
} {
  const { providerId, modelId, credential } = pickActiveProvider(cfg);
  const label =
    getProvider(providerId)?.models.find((m) => m.id === modelId)?.name ?? modelId;
  return { model: buildModel(providerId, modelId, credential), providerId, modelId, label };
}
