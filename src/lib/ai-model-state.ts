import type { StoredModel } from "@/lib/tauri";
import { getProvider, type AIModel } from "@/lib/ai-providers";

export function seedProviderModels(providerId: string): StoredModel[] {
  const p = getProvider(providerId);
  return (p?.models ?? []).map((m) => ({ id: m.id, name: m.name, enabled: true, source: "builtin" }));
}

/**
 * Reconcile a stored model list with what the provider now advertises.
 *
 * New models are added and names filled in. Models the provider has stopped
 * listing are dropped, but only the ones discovery put there: a built-in seed
 * survives because some providers expose an incomplete /models, and a
 * user-added model survives because it was deliberate. Enabled state is kept
 * for everything that stays.
 */
export function mergeFetchedModels(existing: StoredModel[], fetched: AIModel[]): StoredModel[] {
  const listed = new Set(fetched.map((f) => f.id));
  const kept = existing.filter((m) => m.source !== "fetched" || listed.has(m.id));
  const byId = new Map(kept.map((m) => [m.id, m]));
  for (const f of fetched) {
    const prev = byId.get(f.id);
    if (prev) byId.set(f.id, { ...prev, name: prev.name || f.name });
    else byId.set(f.id, { id: f.id, name: f.name, enabled: true, source: "fetched" });
  }
  return [...byId.values()];
}

/**
 * Choose a model the provider will actually accept.
 *
 * The catalog default is a guess: a plan may not include it, and for a custom
 * gateway it is not even the right vendor. Prefer it only when the provider
 * listed it, otherwise take the first model the provider offered.
 */
export function pickActiveModel(
  models: StoredModel[],
  catalogDefault: string,
): string {
  const enabled = models.filter((m) => m.enabled);
  const pool = enabled.length > 0 ? enabled : models;
  if (pool.some((m) => m.id === catalogDefault)) return catalogDefault;
  return pool[0]?.id ?? catalogDefault;
}

export function enabledModels(list: StoredModel[]): StoredModel[] {
  return list.filter((m) => m.enabled);
}

export function addCustomModel(list: StoredModel[], model: AIModel): StoredModel[] {
  if (list.some((m) => m.id === model.id)) return list;
  return [...list, { id: model.id, name: model.name || model.id, enabled: true, source: "custom" }];
}

export function setModelEnabled(list: StoredModel[], id: string, enabled: boolean): StoredModel[] {
  return list.map((m) => (m.id === id ? { ...m, enabled } : m));
}

export function deleteModel(list: StoredModel[], id: string): StoredModel[] {
  return list.filter((m) => m.id !== id);
}

export function restoreSeedModels(list: StoredModel[], providerId: string): StoredModel[] {
  const existing = new Set(list.map((m) => m.id));
  const missing = seedProviderModels(providerId).filter((m) => !existing.has(m.id));
  return missing.length ? [...list, ...missing] : list;
}
