// The Tools model in the converter views, the scanned-PDF banner and
// Settings, AI, Tools: a picker, a notice that says where images go, and the
// estimate shown before a long scan.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { CloudUpload, ShieldCheck } from "lucide-react";
import { ModelSelector, type ModelSelectorGroup } from "@/components/ai/ModelSelector";
import {
  knownProviderConfig,
  loadProviderConfig,
  subscribeProviderConfig,
} from "@/components/ai/provider-config";
import { estimateScan, type PageSize } from "@/features/tools-ai/scan-estimate";
import {
  choiceFromSelection,
  describeToolsChoice,
  LOCAL_TOOLS_PROVIDER,
  toolsChoice,
  toolsOllamaHost,
  type ToolsChoiceSummary,
} from "@/features/tools-ai/tools-choice";
import { toolsModelGroups } from "@/features/tools-ai/tools-groups";
import { describeError } from "@/lib/app-error";
import { formatNumber } from "@/lib/intl";
import { mathpixKeyStatus } from "@/lib/mathpix";
import { listOllamaModelDetails } from "@/lib/ollama";
import { getConfig, setAiToolsModel, type AppConfig, type ToolsModelChoice } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";

/** The saved AI config, kept current with every settings write. */
function useToolsConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(() => knownProviderConfig());
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeProviderConfig((next) => {
      if (active) setConfig(next);
    });
    void loadProviderConfig()
      .then((next) => {
        if (active) setConfig(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return config;
}

export interface ToolsModelState {
  config: AppConfig | null;
  choice: ToolsModelChoice | null;
  summary: ToolsChoiceSummary | null;
  groups: ModelSelectorGroup[];
  select(providerId: string, modelId: string): Promise<void>;
}

export function useToolsModel(): ToolsModelState {
  const config = useToolsConfig();
  const host = config ? toolsOllamaHost(config) : null;
  const ollama = useQuery({
    queryKey: ["ollama-model-details", host],
    queryFn: () => listOllamaModelDetails(host ?? ""),
    enabled: host !== null,
    staleTime: 30_000,
    retry: false,
    meta: { silent: true },
  });
  const mathpix = useQuery({
    queryKey: ["mathpix-key-status"],
    queryFn: mathpixKeyStatus,
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  });
  const ollamaModels = ollama.isError ? null : (ollama.data ?? null);
  const mathpixConfigured = mathpix.data?.configured === true;
  const groups = useMemo(
    () => (config ? toolsModelGroups(config, ollamaModels, mathpixConfigured) : []),
    [config, ollamaModels, mathpixConfigured],
  );
  const select = useCallback(async (providerId: string, modelId: string) => {
    try {
      await setAiToolsModel(choiceFromSelection(providerId, modelId));
      const fresh = await getConfig();
      window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail: fresh }));
    } catch (error) {
      notifyError("save the Tools model", error, describeError(error));
    }
  }, []);
  return {
    config,
    choice: config ? toolsChoice(config) : null,
    summary: config ? describeToolsChoice(config) : null,
    groups,
    select,
  };
}

export function ToolsModelPicker({
  compact,
  className,
  contentClassName,
}: Readonly<{ compact?: boolean; className?: string; contentClassName?: string }>) {
  const { t } = useTranslation(["researchTools"]);
  const { choice, groups, select } = useToolsModel();
  return (
    <div
      role="group"
      aria-label={t(($) => $.researchTools.converterModel.label)}
      data-testid="tools-model-picker"
      className={cn("min-w-0", className)}
    >
      <ModelSelector
        providerId={choice?.provider ?? LOCAL_TOOLS_PROVIDER}
        modelId={choice?.model ?? ""}
        groups={groups}
        compact={compact}
        className={compact ? undefined : "w-full"}
        contentClassName={cn("z-[100]", contentClassName)}
        onChange={(providerId, modelId) => void select(providerId, modelId)}
      />
    </div>
  );
}

/** Where images go with the current choice. Shown before the user converts. */
export function ToolsModelNotice({ scope }: Readonly<{ scope: "images" | "scans" }>) {
  const { t } = useTranslation(["researchTools"]);
  const config = useToolsConfig();
  if (!config) return null;
  const summary = describeToolsChoice(config);
  const destination = summary.destination;
  if (destination.kind === "device") {
    return (
      <span
        data-testid="tools-model-notice"
        data-destination="device"
        className="flex items-center gap-1.5 whitespace-nowrap font-medium text-emerald-600 dark:text-emerald-400"
      >
        <ShieldCheck className="size-3.5 shrink-0" /> {t(($) => $.researchTools.converter.runsOnDevice)}
      </span>
    );
  }
  let text: string;
  if (destination.kind === "host") {
    text =
      scope === "scans"
        ? t(($) => $.researchTools.converterModel.scansSentToHost, { host: destination.host })
        : t(($) => $.researchTools.converterModel.sentToHost, { host: destination.host });
  } else if (summary.engine === "mathpix" && scope === "scans") {
    text = t(($) => $.researchTools.converterModel.pdfSentToMathpix);
  } else {
    text =
      scope === "scans"
        ? t(($) => $.researchTools.converterModel.scansSentTo, { provider: destination.name })
        : t(($) => $.researchTools.converterModel.sentTo, { provider: destination.name });
  }
  return (
    <span
      data-testid="tools-model-notice"
      data-destination={destination.kind}
      className="flex min-w-0 items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400"
    >
      <CloudUpload className="size-3.5 shrink-0" /> <span className="min-w-0">{text}</span>
    </span>
  );
}

type Translate = ReturnType<typeof useTranslation<["researchTools"]>>["t"];

function estimateText(t: Translate, sizes: readonly PageSize[], summary: ToolsChoiceSummary): string {
  const estimate = estimateScan(sizes, summary);
  const count = estimate.pages;
  switch (estimate.kind) {
    case "ollama":
      return t(($) => $.researchTools.converterModel.estimateOllama, { count });
    case "cost":
      return t(($) => $.researchTools.converterModel.estimateCost, {
        count,
        cost: formatNumber(Math.max(estimate.usd, 0.01), {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        }),
        model: summary.label,
      });
    case "unknown":
      return t(($) => $.researchTools.converterModel.estimateUnknown, {
        count,
        provider: estimate.provider,
      });
  }
}

/** The page count of a scan and, for a hosted model or Mathpix, its rough price. */
export function ScanEstimateText({ sizes }: Readonly<{ sizes: readonly PageSize[] }>) {
  const { t } = useTranslation(["researchTools"]);
  const config = useToolsConfig();
  if (!config) return null;
  return (
    <p data-testid="scan-estimate" className="text-xs text-muted-foreground">
      {estimateText(t, sizes, describeToolsChoice(config))}
    </p>
  );
}

/** Opens Settings on AI (the Ollama card) or on AI, Tools. */
export function openToolsSettings(target: "ai" | "ai-tools"): void {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("ai");
  if (target === "ai-tools") settings.setSettingsScrollTarget("ai-tools");
  settings.setSettingsOpen(true);
}
