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
  destinationName,
  LOCAL_TOOLS_PROVIDER,
  toolsChoice,
  toolsOllamaHost,
  type ToolsChoiceSummary,
  type ToolsDestination,
} from "@/features/tools-ai/tools-choice";
import { toolsModelGroups } from "@/features/tools-ai/tools-groups";
import { editorImageFallback, type ToolsSettingsTarget } from "@/features/tools-ai/tools-model";
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

/** The Tools' Ollama listing, shared by the picker and the notice. */
function useOllamaModels(config: AppConfig | null, enabled = true) {
  const host = config ? toolsOllamaHost(config) : null;
  return useQuery({
    queryKey: ["ollama-model-details", host],
    queryFn: () => listOllamaModelDetails(host ?? ""),
    enabled: enabled && host !== null,
    staleTime: 30_000,
    retry: false,
    meta: { silent: true },
  });
}

export function useToolsModel(): ToolsModelState {
  const config = useToolsConfig();
  const ollama = useOllamaModels(config);
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
    summary: config ? describeToolsChoice(config, ollamaModels) : null,
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
    <fieldset
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
    </fieldset>
  );
}

/** Where images go with the current choice. Shown before the user converts.
 * With Automatic and no local model that reads images, the editor's Image to
 * LaTeX/Typst uses the assistant's model, so the images notice says so
 * unless `editorFallback` is false (a converter, which never falls back). */
export function ToolsModelNotice({
  scope,
  editorFallback = true,
}: Readonly<{ scope: "images" | "scans"; editorFallback?: boolean }>) {
  const { t } = useTranslation(["researchTools"]);
  const config = useToolsConfig();
  const choice = config ? toolsChoice(config) : null;
  const checksFallback = editorFallback && scope === "images" && config !== null && choice === null;
  // The listing also shows whether a picked Ollama model runs on Ollama Cloud.
  const ollama = useOllamaModels(config, checksFallback || choice?.provider === LOCAL_TOOLS_PROVIDER);
  if (!config) return null;
  const summary = describeToolsChoice(config, ollama.data);
  const destination = summary.destination;
  const fallbackName = checksFallback ? editorFallbackName(config, ollama) : null;
  if (fallbackName) {
    return (
      <span
        data-testid="tools-model-notice"
        data-destination="assistant"
        className="flex min-w-0 items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400"
      >
        <CloudUpload className="size-3.5 shrink-0" />{" "}
        <span className="min-w-0">
          {t(($) => $.researchTools.converterModel.editorFallback, { provider: fallbackName })}
        </span>
      </span>
    );
  }
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
  const text = sentToText(t, scope, summary.engine, destination);
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

/** The assistant's model that editor images fall back to, once the Ollama
 * listing has answered or failed, or null when there is no such fallback. */
function editorFallbackName(config: AppConfig, ollama: ReturnType<typeof useOllamaModels>): string | null {
  if (!ollama.isError && !ollama.isSuccess) return null;
  const fallback = editorImageFallback(config, ollama.isError ? null : (ollama.data ?? null));
  return fallback ? destinationName(fallback) : null;
}

/** The notice for a destination that is neither this computer nor the
 * assistant's model: the Ollama host, Mathpix or a hosted provider. */
function sentToText(
  t: Translate,
  scope: "images" | "scans",
  engine: ToolsChoiceSummary["engine"],
  destination: Exclude<ToolsDestination, { kind: "device" }>,
): string {
  if (destination.kind === "host") {
    return scope === "scans"
      ? t(($) => $.researchTools.converterModel.scansSentToHost, { host: destination.host })
      : t(($) => $.researchTools.converterModel.sentToHost, { host: destination.host });
  }
  if (engine === "mathpix" && scope === "scans") {
    return t(($) => $.researchTools.converterModel.pdfSentToMathpix);
  }
  return scope === "scans"
    ? t(($) => $.researchTools.converterModel.scansSentTo, { provider: destination.name })
    : t(($) => $.researchTools.converterModel.sentTo, { provider: destination.name });
}

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
    case "plan":
      return t(($) => $.researchTools.converterModel.estimatePlan, { count, provider: estimate.provider });
    case "local":
      return t(($) => $.researchTools.converterModel.estimateLocal, { count });
    case "free":
      return t(($) => $.researchTools.converterModel.estimateFree, { count, model: summary.label });
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
  const ollama = useOllamaModels(config, config !== null && toolsChoice(config)?.provider === LOCAL_TOOLS_PROVIDER);
  if (!config) return null;
  return (
    <p data-testid="scan-estimate" className="text-xs text-muted-foreground">
      {estimateText(t, sizes, describeToolsChoice(config, ollama.data))}
    </p>
  );
}

/** Opens Settings on AI (the Ollama card, on Providers and keys) or on AI,
 * Tools. */
export function openToolsSettings(target: ToolsSettingsTarget): void {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("ai");
  if (target === "ai-tools") settings.setSettingsScrollTarget("ai-tools");
  settings.setSettingsOpen(true);
}
