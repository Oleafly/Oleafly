import type { ModelMetadata, ModelProbe, ModelTrust, StoredModel } from "@/lib/tauri";
import { getProvider, type AIModel } from "@/lib/ai-providers";

export interface FetchedModel extends AIModel {
  trust?: ModelTrust;
  blockedReason?: string;
  metadata?: ModelMetadata;
}

export const MODEL_LIST_REFRESH_THROTTLE_MS = 30_000;
export const MODEL_LIST_AUTO_REFRESH_MS = 24 * 60 * 60 * 1000;

export function seedProviderModels(providerId: string): StoredModel[] {
  const p = getProvider(providerId);
  return (p?.models ?? []).map((m) => ({ id: m.id, name: m.name, enabled: true, source: "builtin" }));
}

function withFetchedFacts(prev: StoredModel, fetched: FetchedModel): StoredModel {
  const next: StoredModel = { ...prev, name: prev.name || fetched.name };
  if (fetched.trust) {
    next.trust = fetched.trust;
    if (fetched.trust === "blocked" && fetched.blockedReason) {
      next.blockedReason = fetched.blockedReason;
    } else {
      delete next.blockedReason;
    }
  }
  if (fetched.metadata) next.metadata = fetched.metadata;
  return next;
}

function fromFetched(fetched: FetchedModel): StoredModel {
  const next: StoredModel = {
    id: fetched.id,
    name: fetched.name || fetched.id,
    enabled: true,
    source: "fetched",
  };
  if (fetched.trust) next.trust = fetched.trust;
  if (fetched.trust === "blocked" && fetched.blockedReason) {
    next.blockedReason = fetched.blockedReason;
  }
  if (fetched.metadata) next.metadata = fetched.metadata;
  return next;
}

export function readableFetchedModels(
  fetched: readonly FetchedModel[],
): FetchedModel[] {
  const seen = new Set<string>();
  const usable: FetchedModel[] = [];
  for (const entry of fetched) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    usable.push({ ...entry, id });
  }
  return usable;
}

export function mergeFetchedModels(
  existing: StoredModel[],
  fetched: readonly FetchedModel[] | null,
): StoredModel[] {
  if (fetched === null) return existing;
  const usable = readableFetchedModels(fetched);
  if (usable.length === 0) return existing;
  const listed = new Set(usable.map((f) => f.id));
  const kept = existing.filter((m) => m.source === "custom" || listed.has(m.id));
  const byId = new Map(kept.map((m) => [m.id, m]));
  for (const f of usable) {
    const prev = byId.get(f.id);
    byId.set(f.id, prev ? withFetchedFacts(prev, f) : fromFetched(f));
  }
  return [...byId.values()];
}

export function diffModelLists(
  before: readonly StoredModel[],
  after: readonly StoredModel[],
): { added: number; removed: number } {
  const beforeIds = new Set(before.map((m) => m.id));
  const afterIds = new Set(after.map((m) => m.id));
  let added = 0;
  for (const id of afterIds) if (!beforeIds.has(id)) added += 1;
  let removed = 0;
  for (const id of beforeIds) if (!afterIds.has(id)) removed += 1;
  return { added, removed };
}

export function describeModelListChange(change: { added: number; removed: number }): string {
  if (change.added === 0 && change.removed === 0) return "No changes";
  return `${change.added} added, ${change.removed} removed`;
}

export function pickActiveModel(
  models: StoredModel[],
  catalogDefault: string,
): string {
  const enabled = models.filter((m) => m.enabled);
  const pool = enabled.length > 0 ? enabled : models;
  if (pool.some((m) => m.id === catalogDefault)) return catalogDefault;
  return pool[0]?.id ?? catalogDefault;
}

export function reconcileActiveModel(
  models: StoredModel[],
  currentModel: string,
  catalogDefault: string,
): string {
  const enabled = models.filter((model) => model.enabled);
  if (enabled.some((model) => model.id === currentModel)) return currentModel;
  if (enabled.some((model) => model.id === catalogDefault)) return catalogDefault;
  return enabled[0]?.id ?? "";
}

export function enabledModels(list: StoredModel[]): StoredModel[] {
  return list.filter((m) => m.enabled);
}

export function addCustomModel(list: StoredModel[], model: AIModel): StoredModel[] {
  if (list.some((m) => m.id === model.id)) return list;
  return [
    ...list,
    { id: model.id, name: model.name || model.id, enabled: true, source: "custom", trust: "untested" },
  ];
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

export function probeKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export interface ResolvedTrust {
  trust?: ModelTrust;
  reason?: string;
  source?: "catalog" | "probe";
}

export function resolveModelTrust(
  model: Pick<StoredModel, "trust" | "blockedReason"> | undefined,
  probe: ModelProbe | undefined,
): ResolvedTrust {
  if (model?.trust === "blocked") {
    return model.blockedReason
      ? { trust: "blocked", reason: model.blockedReason, source: "catalog" }
      : { trust: "blocked", source: "catalog" };
  }
  if (probe?.verdict === "blocked") {
    return probe.reason
      ? { trust: "blocked", reason: probe.reason, source: "probe" }
      : { trust: "blocked", source: "probe" };
  }
  if (probe?.verdict === "verified") return { trust: "verified", source: "probe" };
  return model?.trust ? { trust: model.trust, source: "catalog" } : {};
}

export function mergeModelProbes(
  current: Record<string, ModelProbe>,
  incoming: Record<string, ModelProbe> | undefined,
): Record<string, ModelProbe> {
  if (!incoming) return current;
  const next = { ...current };
  for (const [key, probe] of Object.entries(incoming)) {
    const known = next[key];
    if (!known || probe.probedAt >= known.probedAt) next[key] = probe;
  }
  return next;
}

export function modelIsChatOnly(model: Pick<StoredModel, "metadata"> | undefined): boolean {
  return model?.metadata?.toolCall === false;
}

export function formatContextWindow(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "";
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    const rounded = Math.round(millions * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

export interface ModelCapabilityChip {
  id: "context" | "vision" | "tools" | "reasoning" | "deprecated";
  label: string;
  title: string;
}

export function modelCapabilityChips(metadata: ModelMetadata | undefined): ModelCapabilityChip[] {
  if (!metadata) return [];
  const chips: ModelCapabilityChip[] = [];
  if (metadata.contextWindow) {
    const context = formatContextWindow(metadata.contextWindow);
    if (context) {
      chips.push({
        id: "context",
        label: context,
        title: `${metadata.contextWindow.toLocaleString()} token context window`,
      });
    }
  }
  if (metadata.inputModalities?.includes("image")) {
    chips.push({ id: "vision", label: "Vision", title: "Accepts images" });
  }
  if (metadata.toolCall) {
    chips.push({ id: "tools", label: "Tools", title: "Can call tools" });
  }
  if (metadata.reasoning) {
    chips.push({ id: "reasoning", label: "Reasoning", title: "Reasoning model" });
  }
  if (metadata.status === "deprecated") {
    chips.push({ id: "deprecated", label: "Deprecated", title: "The provider has deprecated this model" });
  }
  return chips;
}

export function shouldAutoRefreshModels(refreshedAt: number | undefined, now: number): boolean {
  if (!refreshedAt || !Number.isFinite(refreshedAt)) return true;
  return now - refreshedAt >= MODEL_LIST_AUTO_REFRESH_MS;
}

const refreshThrottleUntil = new Map<string, number>();
const autoRefreshAttemptedAt = new Map<string, number>();

export function modelListThrottledUntil(providerId: string, now: number): number {
  const until = refreshThrottleUntil.get(providerId) ?? 0;
  return until > now ? until : 0;
}

export function throttleModelListRefresh(providerId: string, now: number): number {
  const until = now + MODEL_LIST_REFRESH_THROTTLE_MS;
  refreshThrottleUntil.set(providerId, until);
  return until;
}

export function clearModelListThrottle(providerId: string): void {
  refreshThrottleUntil.delete(providerId);
}

export function claimModelListAutoRefresh(providerId: string, now: number): boolean {
  const last = autoRefreshAttemptedAt.get(providerId);
  if (last !== undefined && now - last < MODEL_LIST_AUTO_REFRESH_MS) return false;
  autoRefreshAttemptedAt.set(providerId, now);
  return true;
}

export function resetModelListRefreshLedger(): void {
  refreshThrottleUntil.clear();
  autoRefreshAttemptedAt.clear();
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

export function formatRelativeTime(then: number, now: number): string {
  const elapsed = Math.max(0, now - then);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return plural(days, "day");
  return new Date(then).toLocaleDateString();
}
