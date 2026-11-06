import type { ModelSelectorGroup, ModelSelectorModel } from "@/components/ai/ModelSelector";
import { i18n } from "@/i18n";
import { acpUsable, type AcpAgentStatus } from "@/lib/acp";
import { configuredModelGroups } from "@/lib/ai-model-groups";
import type { OllamaModelInfo } from "@/lib/ollama";
import type { AppConfig } from "@/lib/tauri";
import {
  AGENT_DEFAULT_MODEL,
  AGENT_TOOLS_PREFIX,
  disabledModels,
  LOCAL_TOOLS_PROVIDER,
  MATHPIX_TOOLS_MODEL,
  MATHPIX_TOOLS_PROVIDER,
  ollamaModelIsRemote,
  ollamaModelSeesImages,
  visionCapable,
} from "./tools-choice";

/** A CLI agent that has run shows what it offered. One that hasn't is listed
 * with its own default model. One known not to read images, or that can't be
 * held to reading, isn't listed. */
function agentGroups(agents: readonly AcpAgentStatus[]): ModelSelectorGroup[] {
  return agents
    .filter((agent) => acpUsable(agent) && agent.runtime?.image !== false && agent.runtime?.readOnly !== false)
    .map((agent) => {
      const offered = (agent.runtime?.models ?? []).map((model) => ({ id: model.modelId, name: model.name }));
      const models = offered.some((model) => model.id === AGENT_DEFAULT_MODEL)
        ? offered
        : [{ id: AGENT_DEFAULT_MODEL, name: i18n.t(($) => $.researchTools.converterModel.agentDefaultModel) }, ...offered];
      return { id: `${AGENT_TOOLS_PREFIX}${agent.definition.id}`, name: agent.definition.name, models };
    });
}

export function toolsModelGroups(
  cfg: AppConfig,
  ollama: readonly OllamaModelInfo[] | null,
  mathpixConfigured: boolean,
  agents: readonly AcpAgentStatus[] = [],
): ModelSelectorGroup[] {
  const disabled = disabledModels(cfg, LOCAL_TOOLS_PROVIDER);
  const local: ModelSelectorModel[] = [
    { id: "", name: i18n.t(($) => $.researchTools.converterModel.automatic) },
    // Ollama Cloud models run on ollama.com, so they are not "Local".
    ...(ollama ?? [])
      .filter((model) => !disabled.has(model.name) && !ollamaModelIsRemote(model) && ollamaModelSeesImages(model))
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
    ...agentGroups(agents),
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
