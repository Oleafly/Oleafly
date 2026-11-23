import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ModelSelector } from "@/components/ai/ModelSelector";
import { useProviderConfig } from "@/components/ai/use-provider-config";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { configuredModelGroups } from "@/lib/ai-model-groups";
import {
  effectiveProviderKeys,
  hasConfiguredProvider,
  isProviderConfigured,
  pickActiveProvider,
} from "@/lib/ai-providers";
import { useSettingsStore } from "@/store/settings";

export function AiCompletionModelSetting() {
  const { t } = useTranslation(["settings"]);
  const config = useProviderConfig();
  const providerId = useSettingsStore((s) => s.aiCompletionProvider);
  const modelId = useSettingsStore((s) => s.aiCompletionModel);
  const setModel = useSettingsStore((s) => s.setAiCompletionModel);
  const ready = config !== null && hasConfiguredProvider(config);
  const { chosen, groups } = useMemo(() => {
    if (!config || !ready) return { chosen: null, groups: [] };
    const keys = effectiveProviderKeys(config);
    const customProviders = config.ai_custom_providers ?? [];
    const saved = providerId && modelId && isProviderConfigured(providerId, keys, customProviders)
      ? { providerId, modelId }
      : null;
    const active = saved ?? pickActiveProvider(config);
    return {
      chosen: active,
      groups: configuredModelGroups(
        { keys, customProviders, providerModels: config.ai_provider_models ?? {} },
        { keep: { providerId: active.providerId, modelId: active.modelId } },
      ),
    };
  }, [config, ready, providerId, modelId]);

  return (
    <SettingsRow
      testId="settings-ai-completion-model"
      label={t(($) => $.settings.appearance.editor.aiCompletionModel.label)}
      description={
        ready
          ? t(($) => $.settings.appearance.editor.aiCompletionModel.description)
          : t(($) => $.settings.appearance.editor.aiCompletionModel.needsProvider)
      }
      control={
        <ModelSelector
          providerId={chosen?.providerId ?? ""}
          modelId={chosen?.modelId ?? ""}
          groups={groups}
          disabled={groups.length === 0}
          contentClassName="z-[100]"
          className="max-w-56"
          onChange={setModel}
        />
      }
    />
  );
}
