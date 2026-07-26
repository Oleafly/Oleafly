import type { StoredModel } from "@/lib/tauri";
import { getProvider, type AIModel } from "@/lib/ai-providers";

export function seedProviderModels(providerId: string): StoredModel[] {
  const p = getProvider(providerId);
  return (p?.models ?? []).map((m) => ({ id: m.id, name: m.name, enabled: true, source: "builtin" }));
}

export function mergeFetchedModels(existing: StoredModel[], fetched: AIModel[]): StoredModel[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const f of fetched) {
    const prev = byId.get(f.id);
    if (prev) byId.set(f.id, { ...prev, name: prev.name || f.name });
    else byId.set(f.id, { id: f.id, name: f.name, enabled: true, source: "fetched" });
  }
  return [...byId.values()];
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
