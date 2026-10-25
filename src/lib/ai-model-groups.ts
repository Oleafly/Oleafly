// The "configured providers and their models" list every model picker shows:
// the chat, the default-model setting, template generation and the Tools
// model. One helper so they agree on what "configured" and "listed" mean.
import type { ModelSelectorGroup, ModelSelectorModel } from "@/components/ai/ModelSelector";
import { enabledModels } from "@/lib/ai-model-state";
import { mergeCustomProviders, type AIProvider } from "@/lib/ai-providers";
import type { CustomProvider, StoredModel } from "@/lib/tauri";

export interface ModelGroupSource {
  keys: Readonly<Record<string, string>>;
  customProviders: readonly CustomProvider[];
  providerModels: Readonly<Record<string, StoredModel[] | undefined>>;
}

export interface ModelGroupOptions {
  /** Live Ollama tags. When non-empty they replace the stored Ollama list (ChatCore). */
  liveOllama?: readonly string[];
  /** Keep this model in its provider's group even if nothing lists it (ChatCore's active model). */
  keep?: { providerId: string; modelId: string };
  /** Shape a stored model. Default: `{ id, name }`. */
  toModel?: (providerId: string, stored: StoredModel) => ModelSelectorModel;
  /** Keep only matching models (the Tools picker keeps vision models). */
  include?: (providerId: string, model: ModelSelectorModel) => boolean;
  /** Drop providers left with no models. Default true. */
  dropEmpty?: boolean;
}

/** Providers the user set up: a saved key or host, or a custom provider
 * that needs no key. In catalog order, custom providers last. */
export function configuredProviders(source: ModelGroupSource): AIProvider[] {
  return mergeCustomProviders([...source.customProviders]).filter((provider) => {
    if ((source.keys[provider.id] ?? "").trim().length > 0) return true;
    return Boolean(source.customProviders.find((custom) => custom.id === provider.id)?.keyOptional);
  });
}

function plainModel(_providerId: string, stored: StoredModel): ModelSelectorModel {
  return { id: stored.id, name: stored.name };
}

/** Each configured provider with the models it offers: its enabled stored
 * models, or the catalog when nothing is stored. An empty stored list means
 * no models. */
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
        ? enabledModels(stored).map((model) => toModel(provider.id, model))
        : provider.models.map((model) => ({ id: model.id, name: model.name }));
    if (provider.id === "ollama" && options.liveOllama && options.liveOllama.length > 0) {
      models = options.liveOllama.map((id) => ({ id, name: id }));
    }
    if (options.include) {
      const include = options.include;
      models = models.filter((model) => include(provider.id, model));
    }
    const keep = options.keep;
    if (keep?.providerId === provider.id && keep.modelId && !models.some((model) => model.id === keep.modelId)) {
      models = [...models, { id: keep.modelId, name: keep.modelId }];
    }
    if (models.length === 0 && options.dropEmpty !== false) continue;
    groups.push({ id: provider.id, name: provider.name, models });
  }
  return groups;
}
