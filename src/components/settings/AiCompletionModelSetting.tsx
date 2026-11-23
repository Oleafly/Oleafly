import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ModelSelector } from "@/components/ai/ModelSelector";
import { configuredModelGroups } from "@/lib/ai-model-groups";
import {
  effectiveProviderKeys,
  hasConfiguredProvider,
  isProviderConfigured,
  pickActiveProvider,
} from "@/lib/ai-providers";
import type { AppConfig } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

export function AiCompletionModelSetting({ config }: Readonly<{ config: AppConfig }>) {
  const { t } = useTranslation(["settings"]);
  const providerId = useSettingsStore((s) => s.aiCompletionProvider);
  const modelId = useSettingsStore((s) => s.aiCompletionModel);
  const setModel = useSettingsStore((s) => s.setAiCompletionModel);
  const { chosen, groups } = useMemo(() => {
    if (!hasConfiguredProvider(config)) return { chosen: null, groups: [] };
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
  }, [config, providerId, modelId]);

  return (
    <div className="space-y-2" data-testid="settings-ai-completion-model">
      <p className="font-medium">{t(($) => $.settings.ai.instructions.completionModelTitle)}</p>
      <p className="text-xs text-muted-foreground">
        {t(($) => $.settings.ai.instructions.completionModelDescription)}
      </p>
      <ModelSelector
        providerId={chosen?.providerId ?? ""}
        modelId={chosen?.modelId ?? ""}
        groups={groups}
        contentClassName="z-[100]"
        disabled={groups.length === 0}
        onChange={setModel}
      />
    </div>
  );
}
