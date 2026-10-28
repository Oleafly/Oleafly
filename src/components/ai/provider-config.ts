import { getConfigCached, invalidateConfigCache } from "@/lib/config-cache";
import { getSnapshotConfig } from "@/lib/initial-state";
import { currentLocale } from "@/i18n";
import {
  effectiveProviderKeys,
  isProviderConfigured,
  pickActiveProvider,
  suggestedProviderId,
} from "@/lib/ai-providers";
import type { AppConfig, CustomProvider, Persona, StoredModel } from "@/lib/tauri";

export interface ProviderState {
  provider: string;
  model: string;
  /** The active provider's saved key or host; empty for a key-less custom provider. */
  apiKey: string;
  /** The active provider can take a request: it has a key or host, or is a custom provider that needs none. Gate the chat on this, not on `apiKey`. */
  ready: boolean;
  keysMap: Record<string, string>;
  providerModelsMap: Record<string, StoredModel[]>;
  customProviders: CustomProvider[];
  personas: Persona[];
  customPrompt: string;
}

export function deriveProviderState(
  cfg: AppConfig,
  suggested: string = suggestedProviderId(currentLocale()),
): ProviderState {
  const { providerId, modelId, credential } = pickActiveProvider(cfg, suggested);
  const keys = effectiveProviderKeys(cfg);
  const customs = cfg.ai_custom_providers ?? [];
  return {
    provider: providerId,
    model: modelId,
    apiKey: credential,
    ready: isProviderConfigured(providerId, keys, customs),
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
