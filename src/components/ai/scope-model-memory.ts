import { effectiveProviderKeys, isProviderConfigured } from "@/lib/ai-providers";
import type { AppConfig } from "@/lib/tauri";

export interface ScopeModelChoice {
  providerId: string;
  modelId: string;
}

export interface AssistantScopeModelMemory {
  read(): ScopeModelChoice | null;
  save(choice: ScopeModelChoice): void;
}

export function rememberedModel(memory: AssistantScopeModelMemory | undefined, cfg: AppConfig): ScopeModelChoice | null {
  const saved = memory?.read() ?? null;
  if (!saved?.providerId || !saved.modelId) return null;
  if (!isProviderConfigured(saved.providerId, effectiveProviderKeys(cfg), cfg.ai_custom_providers ?? [])) return null;
  const enabled = (cfg.ai_provider_models?.[saved.providerId] ?? []).filter((model) => model.enabled);
  if (enabled.length > 0 && !enabled.some((model) => model.id === saved.modelId)) return null;
  return { providerId: saved.providerId, modelId: saved.modelId };
}
