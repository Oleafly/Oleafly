import { getConfigCached, invalidateConfigCache } from "@/lib/config-cache";
import { getSnapshotConfig } from "@/lib/initial-state";
import { defaultModel } from "@/lib/ai-providers";
import type { AppConfig, CustomProvider, Persona, StoredModel } from "@/lib/tauri";

export interface ProviderState {
  provider: string;
  model: string;
  apiKey: string;
  keysMap: Record<string, string>;
  providerModelsMap: Record<string, StoredModel[]>;
  customProviders: CustomProvider[];
  personas: Persona[];
  customPrompt: string;
}

export function deriveProviderState(cfg: AppConfig): ProviderState {
  const saved = cfg.ai_provider || "openai";
  const keys = { ...(cfg.ai_keys ?? {}) };
  if (cfg.ai_api_key && !keys[saved]) keys[saved] = cfg.ai_api_key;
  const customs = cfg.ai_custom_providers ?? [];
  const keyOptionalIds = customs.filter((c) => c.keyOptional).map((c) => c.id);
  const configured = Object.keys(keys).filter((k) => (keys[k] ?? "").trim());
  const provider =
    (keys[saved] ?? "").trim() || keyOptionalIds.includes(saved)
      ? saved
      : configured[0] ?? saved;
  return {
    provider,
    model: provider === saved && cfg.ai_model ? cfg.ai_model : defaultModel(provider),
    apiKey: keys[provider] || "",
    keysMap: keys,
    providerModelsMap: cfg.ai_provider_models ?? {},
    customProviders: customs,
    personas: cfg.ai_personas ?? [],
    customPrompt: cfg.ai_system_prompt || "",
  };
}

type ProviderConfigListener = (config: AppConfig) => void;

let knownConfig: AppConfig | null = null;
let inFlight: Promise<AppConfig> | null = null;
const listeners = new Set<ProviderConfigListener>();

export function knownProviderConfig(): AppConfig | null {
  return knownConfig ?? getSnapshotConfig();
}

export function rememberProviderConfig(config: AppConfig): void {
  knownConfig = config;
  for (const listener of [...listeners]) listener(config);
}

export function loadProviderConfig(): Promise<AppConfig> {
  if (inFlight) return inFlight;
  const request: Promise<AppConfig> = getConfigCached().then(
    (config) => {
      if (inFlight === request) inFlight = null;
      rememberProviderConfig(config);
      return config;
    },
    (error: unknown) => {
      if (inFlight === request) inFlight = null;
      throw error;
    },
  );
  inFlight = request;
  return request;
}

export function subscribeProviderConfig(listener: ProviderConfigListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetProviderConfigCache(): void {
  knownConfig = null;
  inFlight = null;
  invalidateConfigCache();
}

if (typeof window !== "undefined") {
  window.addEventListener("oleafly:ai-config-changed", (event) => {
    const detail = (event as CustomEvent<AppConfig | undefined>).detail;
    invalidateConfigCache();
    if (detail) rememberProviderConfig(detail);
    else void loadProviderConfig().catch(() => undefined);
  });
}
