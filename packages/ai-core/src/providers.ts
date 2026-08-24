export interface AIModel {
  id: string;
  name: string;
}

export interface AIProvider {
  id: string;
  name: string;
  blurb: string;
  signupUrl?: string;
  baseURL?: string;
  isHost?: boolean;
  models: AIModel[];
}

export const PROVIDERS: AIProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    blurb: "GPT models. The default choice.",
    signupUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
      { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    blurb: "Claude models - strong at code and writing.",
    signupUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-opus-5", name: "Claude Opus 5" },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
      { id: "claude-fable-5", name: "Claude Fable 5" },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    blurb: "Gemini models from Google AI Studio.",
    signupUrl: "https://aistudio.google.com/app/api-keys",
    models: [
      { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (preview)" },
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
  {
    id: "zai",
    name: "Z.AI (GLM Coding Plan)",
    blurb: "GLM models via a Z.AI GLM Coding Plan subscription.",
    signupUrl: "https://z.ai/subscribe",
    // Use the Coding Plan endpoint. The general /api/paas/v4 one bills separate
    baseURL: "https://api.z.ai/api/coding/paas/v4",
    models: [
      { id: "glm-5.3", name: "GLM-5.3" },
      { id: "glm-5.2", name: "GLM-5.2" },
      { id: "glm-4.6", name: "GLM-4.6" },
      { id: "glm-4.5-air", name: "GLM-4.5 Air" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    blurb: "Very fast open-model inference.",
    signupUrl: "https://console.groq.com/keys",
    baseURL: "https://api.groq.com/openai/v1",
    models: [
      { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
      { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
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
      { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    blurb: "DeepSeek V4 models.",
    signupUrl: "https://platform.deepseek.com/api_keys",
    baseURL: "https://api.deepseek.com",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
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
      { id: "magistral-medium-latest", name: "Magistral Medium" },
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
      { id: "grok-4.6", name: "Grok 4.6" },
      { id: "grok-4.3", name: "Grok 4.3" },
      { id: "grok-build-0.1", name: "Grok Build" },
    ],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    blurb: "Sonar models with live web grounding.",
    signupUrl: "https://www.perplexity.ai/settings/api",
    baseURL: "https://api.perplexity.ai",
    models: [
      { id: "sonar", name: "Sonar" },
      { id: "sonar-pro", name: "Sonar Pro" },
      { id: "sonar-reasoning-pro", name: "Sonar Reasoning Pro" },
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
      { id: "qwen3.6:27b", name: "Qwen 3.6 27B" },
      { id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" },
      { id: "gemma4:12b", name: "Gemma 4 12B" },
    ],
  },
];

export const PROVIDER_BY_ID: Record<string, AIProvider> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p])
);

const MODEL_DISCOVERY = new Set([
  "openai",
  "anthropic",
  "google",
  "ollama",
  "zai",
  "groq",
  "openrouter",
  "deepseek",
  "mistral",
  "xai",
]);

export function supportsModelDiscovery(providerId: string, isCustom = false): boolean {
  return isCustom || MODEL_DISCOVERY.has(providerId);
}

export function getProvider(id: string): AIProvider | undefined {
  return PROVIDER_BY_ID[id];
}

export function defaultModel(providerId: string): string {
  return getProvider(providerId)?.models[0]?.id ?? "gpt-4o-mini";
}

export function credentialMeta(providerId: string): { label: string; placeholder: string } {
  const p = getProvider(providerId);
  if (p?.isHost) {
    return { label: "Host URL", placeholder: "http://localhost:11434" };
  }
  return { label: "API key", placeholder: "sk-…" };
}

export interface CustomProviderLike {
  id: string;
  name: string;
  baseURL: string;
  keyOptional?: boolean;
}

export function mergeCustomProviders(customs: CustomProviderLike[]): AIProvider[] {
  const extra: AIProvider[] = customs.map((c) => ({
    id: c.id,
    name: c.name,
    blurb: "Custom provider.",
    baseURL: c.baseURL,
    models: [],
  }));
  return [...PROVIDERS, ...extra];
}

export interface AIConfigLike {
  ai_provider?: string;
  ai_model?: string;
  ai_api_key?: string;
  ai_keys?: Record<string, string>;
  ai_custom_providers?: CustomProviderLike[];
}

export function pickActiveProvider(cfg: AIConfigLike): {
  providerId: string;
  modelId: string;
  credential: string;
} {
  const saved = cfg.ai_provider || "openai";
  const keys = { ...(cfg.ai_keys ?? {}) };
  if (cfg.ai_api_key && !keys[saved]) keys[saved] = cfg.ai_api_key;
  // A custom provider with keyOptional is "configured" just by existing, even
  // before any key/host value has been typed (e.g. an unauthenticated local
  // server).
  const keyOptionalIds = (cfg.ai_custom_providers ?? [])
    .filter((c) => c.keyOptional)
    .map((c) => c.id);
  const configured = [...new Set([...Object.keys(keys), ...keyOptionalIds])].filter(
    (k) => (keys[k] ?? "").trim() || keyOptionalIds.includes(k)
  );
  const providerId =
    (keys[saved] ?? "").trim() || keyOptionalIds.includes(saved) ? saved : configured[0] ?? saved;
  const credential = keys[providerId] ?? "";
  const modelId =
    providerId === saved && cfg.ai_model ? cfg.ai_model : defaultModel(providerId);
  return { providerId, modelId, credential };
}

export function hasConfiguredProvider(cfg: AIConfigLike): boolean {
  const { providerId, credential } = pickActiveProvider(cfg);
  if (credential.trim().length > 0) return true;
  return Boolean(cfg.ai_custom_providers?.find((c) => c.id === providerId)?.keyOptional);
}
