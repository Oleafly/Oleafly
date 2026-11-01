import type { ModelSelectorGroup, ModelSelectorModel } from "@/components/ai/ModelSelector";
import { enabledModels } from "@/lib/ai-model-state";
import { isProviderConfigured, mergeCustomProviders, type AIProvider } from "@/lib/ai-providers";
import type { CustomProvider, StoredModel } from "@/lib/tauri";

export interface ModelGroupSource {
  keys: Readonly<Record<string, string>>;
  customProviders: readonly CustomProvider[];
  providerModels: Readonly<Record<string, StoredModel[] | undefined>>;
}

export interface ModelGroupOptions {
  liveOllama?: readonly string[];
  keep?: { providerId: string; modelId: string };
  toModel?: (providerId: string, stored: StoredModel) => ModelSelectorModel;
  include?: (providerId: string, model: ModelSelectorModel) => boolean;
  dropEmpty?: boolean;
}

export function configuredProviders(source: ModelGroupSource): AIProvider[] {
  return mergeCustomProviders([...source.customProviders]).filter((provider) =>
    isProviderConfigured(provider.id, source.keys, source.customProviders),
  );
}

function plainModel(_providerId: string, stored: StoredModel): ModelSelectorModel {
  return { id: stored.id, name: stored.name };
}

export function catalogFirst(provider: AIProvider, stored: StoredModel[]): StoredModel[] {
  const rank = new Map(provider.models.map((model, index) => [model.id, index]));
  const last = provider.models.length;
  return stored
    .map((model) => {
      const catalog = provider.models[rank.get(model.id) ?? last];
      return catalog && model.source !== "custom" ? { ...model, name: catalog.name } : model;
    })
    .sort((left, right) => (rank.get(left.id) ?? last) - (rank.get(right.id) ?? last));
}

export function configuredModelGroups(
  source: ModelGroupSource,
  options: ModelGroupOptions = {},
): ModelSelectorGroup[] {
  const toModel = options.toModel ?? plainModel;
  const groups: ModelSelectorGroup[] = [];
  for (const provider of configuredProviders(source)) {
    const stored = source.providerModels[provider.id];
    let models: ModelSelectorModel[] =
      stored !== undefined
        ? catalogFirst(provider, enabledModels(stored)).map((model) => toModel(provider.id, model))
        : provider.models.map((model) => ({ id: model.id, name: model.name }));
    if (provider.id === "ollama" && options.liveOllama && options.liveOllama.length > 0) {
      models = options.liveOllama.map((id) => ({ id, name: id }));
    }
    if (options.include) {
      const include = options.include;
      models = models.filter((model) => include(provider.id, model));
    }
    const keep = options.keep;
    if (keep?.providerId === provider.id && keep.modelId.trim() && !models.some((model) => model.id === keep.modelId)) {
      models = [...models, { id: keep.modelId, name: keep.modelId }];
    }
    if (models.length === 0 && options.dropEmpty !== false) continue;
    groups.push({ id: provider.id, name: provider.name, models });
  }
  return groups;
}
