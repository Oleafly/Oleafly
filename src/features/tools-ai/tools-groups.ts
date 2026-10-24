// The Tools model picker: Automatic and the local vision models first, then
// vision models from every configured hosted provider, then Mathpix when its
// keys are saved. Models turned off in Settings are not offered.
import type { ModelSelectorGroup, ModelSelectorModel } from "@/components/ai/ModelSelector";
import { i18n } from "@/i18n";
import { configuredModelGroups } from "@/lib/ai-model-groups";
import type { OllamaModelInfo } from "@/lib/ollama";
import type { AppConfig } from "@/lib/tauri";
import {
  disabledModels,
  LOCAL_TOOLS_PROVIDER,
  MATHPIX_TOOLS_MODEL,
  MATHPIX_TOOLS_PROVIDER,
  ollamaModelSeesImages,
  visionCapable,
} from "./tools-choice";

/** `ollama` is null when Ollama could not be reached. */
export function toolsModelGroups(
  cfg: AppConfig,
  ollama: readonly OllamaModelInfo[] | null,
  mathpixConfigured: boolean,
): ModelSelectorGroup[] {
  const disabled = disabledModels(cfg, LOCAL_TOOLS_PROVIDER);
  const local: ModelSelectorModel[] = [
    { id: "", name: i18n.t(($) => $.researchTools.converterModel.automatic) },
    ...(ollama ?? [])
      .filter((model) => !disabled.has(model.name) && ollamaModelSeesImages(model))
      .map((model) => ({ id: model.name, name: model.name })),
  ];
  const hosted = configuredModelGroups(
    {
      keys: cfg.ai_keys ?? {},
      customProviders: cfg.ai_custom_providers ?? [],
      providerModels: cfg.ai_provider_models ?? {},
    },
    {
      include: (providerId, model) =>
        providerId !== LOCAL_TOOLS_PROVIDER && visionCapable(providerId, model.id, model.metadata),
      toModel: (_providerId, stored) => ({
        id: stored.id,
        name: stored.name,
        ...(stored.metadata ? { metadata: stored.metadata } : {}),
      }),
    },
  ).filter((group) => group.id !== LOCAL_TOOLS_PROVIDER);
  const groups: ModelSelectorGroup[] = [
    {
      id: LOCAL_TOOLS_PROVIDER,
      name: i18n.t(($) => $.researchTools.converterModel.localGroup),
      models: local,
    },
    ...hosted,
  ];
  if (mathpixConfigured) {
    groups.push({
      id: MATHPIX_TOOLS_PROVIDER,
      name: "Mathpix",
      models: [
        {
          id: MATHPIX_TOOLS_MODEL,
          name: i18n.t(($) => $.researchTools.converterModel.mathpixModel),
        },
      ],
    });
  }
  return groups;
}
