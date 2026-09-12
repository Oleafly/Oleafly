import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppConfig, StoredModel } from "@/lib/tauri";
import { defaultModel, mergeCustomProviders, supportsModelDiscovery } from "@/lib/ai-providers";
import { enabledModels, seedProviderModels } from "@/lib/ai-model-state";
import { DEFAULT_OLLAMA_HOST } from "@/lib/ollama";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { ModelManager, ModelMetadataStatusLine } from "./ModelManager";

export type ProviderStatus = "idle" | "validating" | "valid" | "error";

type OllamaStatus = "idle" | "loading" | "ok" | "down";

const STATUS_BADGE =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium leading-none";

const RUNNING_BADGE = `${STATUS_BADGE} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400`;

const STOPPED_BADGE = `${STATUS_BADGE} bg-amber-500/15 text-amber-600 dark:text-amber-500`;

function ProviderStatusBadge({
  isHost,
  ollamaStatus,
  isConfigured,
}: Readonly<{
  isHost?: boolean;
  ollamaStatus: OllamaStatus;
  isConfigured: boolean;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  if (isHost) {
    if (ollamaStatus === "ok") {
      return (
        <span className={RUNNING_BADGE}>
          <Check className="size-3 shrink-0" /> {t(($) => $.settings.ai.providers.badge.running)}
        </span>
      );
    }
    if (ollamaStatus === "down") {
      return (
        <span className={STOPPED_BADGE}>{t(($) => $.settings.ai.providers.badge.notRunning)}</span>
      );
    }
    return null;
  }
  if (!isConfigured) return null;
  return (
    <span className={RUNNING_BADGE}>
      <Check className="size-3 shrink-0" /> {t(($) => $.settings.ai.providers.badge.connected)}
    </span>
  );
}

function OllamaStatusLine({
  status,
  models,
}: Readonly<{ status: OllamaStatus; models: string[] }>) {
  const { t } = useTranslation(["common", "settings"]);
  if (status === "loading") {
    return (
      <span className="text-[11px] text-muted-foreground">
        {t(($) => $.settings.ai.providers.ollama.checking)}
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span className="text-[11px] text-emerald-600 dark:text-emerald-500">
        {t(($) => $.settings.ai.providers.ollama.runningModels, { count: models.length })}
      </span>
    );
  }
  if (status === "down") {
    return (
      <span className="text-[11px] text-amber-600 dark:text-amber-500">
        {t(($) => $.settings.ai.providers.ollama.notDetected)}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-muted-foreground">
      {t(($) => $.settings.ai.providers.ollama.notChecked)}
    </span>
  );
}

function OllamaModelChoice({
  active,
  models,
  selectedModel,
  onUse,
}: Readonly<{
  active: boolean;
  models: string[];
  selectedModel: string;
  onUse: (model: string) => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground">
        {t(($) => $.settings.ai.providers.modelLabel)}
      </span>
      <Select
        value={active && models.includes(selectedModel) ? selectedModel : ""}
        onValueChange={onUse}
      >
        <SelectTrigger className="h-8 flex-1">
          <SelectValue placeholder={t(($) => $.settings.ai.providers.ollama.modelPlaceholder)} />
        </SelectTrigger>
        <SelectContent className="z-[100]">
          {models.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active && (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium leading-none text-primary">
          <Check className="size-3 shrink-0" /> {t(($) => $.settings.ai.providers.ollama.active)}
        </span>
      )}
    </div>
  );
}

function OllamaHostControls({
  host,
  onHostChange,
  onDisconnect,
}: Readonly<{
  host: string;
  onHostChange: (v: string) => void;
  onDisconnect?: () => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const [showHost, setShowHost] = useState(false);
  return (
    <>
      <div className="flex items-center gap-3">
        <button type="button"
          onClick={() => setShowHost((s) => !s)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {showHost
            ? t(($) => $.settings.ai.providers.ollama.hideHost)
            : t(($) => $.settings.ai.providers.ollama.changeHost)}
        </button>
        {onDisconnect && (
          <button type="button"
            onClick={onDisconnect}
            className="text-[11px] text-muted-foreground hover:text-destructive"
          >
            {t(($) => $.settings.ai.providers.ollama.disconnect)}
          </button>
        )}
      </div>
      {showHost && (
        <Input
          type="text"
          value={host}
          onChange={(e) => onHostChange(e.target.value)}
          placeholder={DEFAULT_OLLAMA_HOST}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      )}
    </>
  );
}

function OllamaSetup({
  active,
  host,
  onHostChange,
  status,
  models,
  onDetect,
  selectedModel,
  onUse,
  onDisconnect,
  installed,
  starting,
  onStart,
}: Readonly<{
  active: boolean;
  host: string;
  onHostChange: (v: string) => void;
  status: OllamaStatus;
  models: string[];
  onDetect: () => void;
  installed: boolean;
  starting: boolean;
  onStart: () => void;
  selectedModel: string;
  onUse: (model: string) => void;
  onDisconnect?: () => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const shown = host.trim() || DEFAULT_OLLAMA_HOST;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={status === "loading"}
          onClick={onDetect}
        >
          {status === "loading" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {status === "idle"
            ? t(($) => $.settings.ai.providers.ollama.check)
            : t(($) => $.settings.ai.providers.ollama.recheck)}
        </Button>
        <OllamaStatusLine status={status} models={models} />
      </div>

      {status === "down" && (
        <div className="space-y-2 rounded-md border border-dashed bg-background p-3 text-[11px] text-muted-foreground">
          <p>
            <Trans
              ns="settings"
              i18nKey={($) => $.settings.ai.providers.ollama.noneResponding}
              values={{ host: shown }}
              components={{ host: <code /> }}
            />
          </p>
          {installed ? (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                data-testid="ollama-start"
                disabled={starting}
                onClick={onStart}
              >
                {starting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t(($) => $.settings.ai.providers.ollama.start)}
              </Button>
              <span>{t(($) => $.settings.ai.providers.ollama.installedHint)}</span>
            </div>
          ) : null}
          <p>
            <Trans
              ns="settings"
              i18nKey={($) => $.settings.ai.providers.ollama.setupSteps}
              components={{
                download: (
                  <button
                    type="button"
                    onClick={() => void open("https://ollama.com/download")}
                    className="font-medium text-primary hover:underline"
                  />
                ),
                icon: <ExternalLink className="inline size-3" />,
                serve: <code />,
                pull: <code />,
              }}
            />
          </p>
        </div>
      )}

      {status === "ok" && models.length === 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          <Trans
            ns="settings"
            i18nKey={($) => $.settings.ai.providers.ollama.noModels}
            components={{ pull: <code /> }}
          />
        </p>
      )}

      {status === "ok" && models.length > 0 && (
        <OllamaModelChoice
          active={active}
          models={models}
          selectedModel={selectedModel}
          onUse={onUse}
        />
      )}

      <OllamaHostControls host={host} onHostChange={onHostChange} onDisconnect={onDisconnect} />
    </div>
  );
}

export interface ProvidersTabProps {
  cfg: AppConfig;
  keys: Record<string, string>;
  savedKeys: Record<string, string>;
  saving: string | null;
  openProviders: Record<string, boolean>;
  setOpenProviders: Dispatch<SetStateAction<Record<string, boolean>>>;
  setKeys: Dispatch<SetStateAction<Record<string, string>>>;
  ollama: {
    status: "idle" | "loading" | "ok" | "down";
    models: string[];
    installed: boolean;
    starting: boolean;
  };
  onStartOllama: () => void;
  refreshOllama: (host: string) => Promise<void>;
  applyOllamaModel: (model: string) => Promise<void>;
  validateAndSave: (id: string) => Promise<void>;
  status: Record<string, ProviderStatus>;
  errorMsg: Record<string, string>;
  changeModel: (modelId: string) => Promise<void>;
  deleteKey: (id: string) => Promise<void>;
  persistModels: (id: string, next: StoredModel[]) => Promise<void>;
  persistRefreshedModels: (id: string, next: StoredModel[], refreshedAt: number) => Promise<void>;
  onAddCustomProvider: () => void;
  onEditCustomProvider: (id: string) => void;
  deleteCustomProvider: (id: string) => Promise<void>;
}

const BUILT_IN_PROVIDER_IDS = [
  "anthropic",
  "deepseek",
  "google",
  "groq",
  "mistral",
  "ollama",
  "openai",
  "openrouter",
  "perplexity",
  "xai",
  "zai",
] as const;

type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number];

function isBuiltInProviderId(id: string): id is BuiltInProviderId {
  return (BUILT_IN_PROVIDER_IDS as readonly string[]).includes(id);
}

export function ProvidersTab({
  cfg,
  keys,
  savedKeys,
  saving,
  openProviders,
  setOpenProviders,
  setKeys,
  ollama,
  onStartOllama,
  refreshOllama,
  applyOllamaModel,
  validateAndSave,
  status,
  errorMsg,
  changeModel,
  deleteKey,
  persistModels,
  persistRefreshedModels,
  onAddCustomProvider,
  onEditCustomProvider,
  deleteCustomProvider,
}: Readonly<ProvidersTabProps>) {
  const { t } = useTranslation(["common", "settings"]);
  const activeProvider = cfg.ai_provider;
  const allProviders = mergeCustomProviders(cfg.ai_custom_providers);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);
  const [editingKey, setEditingKey] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setEditingKey((current) => {
      const settled = Object.keys(current).filter((id) => current[id] && status[id] === "valid");
      if (!settled.length) return current;
      const next = { ...current };
      for (const id of settled) delete next[id];
      return next;
    });
  }, [status]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {t(($) => $.settings.ai.providers.intro)}
      </p>

      <div className="space-y-2.5" data-tour="ai-settings-providers">
        {allProviders.map((p) => {
          const isCustom = cfg.ai_custom_providers.some((c) => c.id === p.id);
          const providerBlurbKey: BuiltInProviderId | "custom" = isBuiltInProviderId(p.id)
            ? p.id
            : "custom";
          const value = keys[p.id] ?? "";
          const saved = savedKeys[p.id] ?? "";
          const dirty = value.trim().length > 0 && value !== saved;
          const hasSaved = saved.length > 0;
          // A custom provider is usable the moment it's added, key or not
          // (self-hosted bases may not require one).
          const isConfigured = hasSaved || isCustom;
          const isReplacingKey = !hasSaved || (editingKey[p.id] ?? false);
          const isSelected = activeProvider === p.id;
          const isActive = isSelected && isConfigured;
          // Settings never recommends or expands a provider implicitly. The
          // user chooses which card to inspect, including the active provider.
          const isOpen = openProviders[p.id] ?? false;
          return (
            <div
              key={p.id}
              data-testid={`ai-provider-card-${p.id}`}
              className="rounded-lg border bg-card transition-colors"
            >
              <div className="flex items-start gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setOpenProviders((m) => ({ ...m, [p.id]: !isOpen }))}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <ProviderLogo providerId={p.id} size={18} />
                      {p.name}
                    </span>
                    {isOpen && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {providerBlurbKey === "custom"
                          ? t(($) => $.settings.ai.providers.blurbs.custom)
                          : t(($) => $.settings.ai.providers.blurbs[providerBlurbKey])}
                      </p>
                    )}
                  </div>
                </button>
                <div className="mt-0.5 flex shrink-0 items-center gap-2">
                  <ProviderStatusBadge
                    isHost={p.isHost}
                    ollamaStatus={ollama.status}
                    isConfigured={isConfigured}
                  />
                  {p.signupUrl && isOpen && (
                    <button type="button"
                      onClick={() => {
                        if (p.signupUrl) void open(p.signupUrl);
                      }}
                      className="flex shrink-0 items-center gap-1 text-[11px] leading-none text-primary hover:underline dark:text-primary"
                    >
                      {p.isHost
                        ? t(($) => $.settings.ai.providers.docs)
                        : t(($) => $.settings.ai.providers.getKey)}{" "}
                      <ExternalLink className="size-3" />
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (p.id === "ollama" ? (
                <div className="px-3 pb-3">
                  <OllamaSetup
                    active={isActive}
                    host={value}
                    onHostChange={(v) => setKeys((k) => ({ ...k, ollama: v }))}
                    status={ollama.status}
                    models={ollama.models}
                    onDetect={() => void refreshOllama(value || DEFAULT_OLLAMA_HOST)}
                    selectedModel={cfg.ai_model || ""}
                    onUse={(m) => void applyOllamaModel(m)}
                    onDisconnect={hasSaved ? () => void deleteKey("ollama") : undefined}
                    installed={ollama.installed}
                    starting={ollama.starting}
                    onStart={onStartOllama}
                  />
                </div>
              ) : (
                <div className="px-3 pb-3">
                  {(() => {
                    const storedModels = cfg.ai_provider_models[p.id] ?? seedProviderModels(p.id);
                    const enabled = enabledModels(storedModels);
                    return (
                      isSelected &&
                      enabled.length > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            {t(($) => $.settings.ai.providers.modelLabel)}
                          </span>
                          <Select
                            value={cfg.ai_model || defaultModel(p.id)}
                            onValueChange={(v) => void changeModel(v)}
                          >
                            <SelectTrigger className="h-8 flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="z-[100]">
                              {enabled.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )
                    );
                  })()}
                  <div className="mt-2 flex gap-2">
                    {isReplacingKey ? (
                      <Input
                        type="password"
                        value={value}
                        onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                        placeholder={t(($) => $.settings.ai.providers.keyPlaceholder)}
                        data-testid={`ai-provider-key-${p.id}`}
                        autoFocus={hasSaved}
                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                      />
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`ai-provider-replace-${p.id}`}
                        disabled={saving === p.id}
                        onClick={() => setEditingKey((m) => ({ ...m, [p.id]: true }))}
                        className="h-8 text-xs"
                      >
                        {t(($) => $.settings.ai.providers.replaceKey)}
                      </Button>
                    )}
                    {dirty ? (
                      <Button
                        size="sm"
                        data-testid={`ai-provider-save-${p.id}`}
                        disabled={saving === p.id}
                        onClick={() => void validateAndSave(p.id)}
                      >
                        {saving === p.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        {t(($) => $.common.actions.save)}
                      </Button>
                    ) : null}
                    {isCustom ? (
                      <>
                        <Tooltip label={t(($) => $.settings.ai.providers.editTooltip)}>
                          <button type="button"
                            data-testid={`ai-provider-edit-${p.id}`}
                            aria-label={t(($) => $.settings.ai.providers.editAriaLabel, {
                              provider: p.name,
                            })}
                            disabled={saving === p.id}
                            onClick={() => onEditCustomProvider(p.id)}
                            className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip label={t(($) => $.settings.ai.providers.removeTooltip)}>
                          <button type="button"
                            data-testid={`ai-provider-delete-${p.id}`}
                            aria-label={t(($) => $.settings.ai.providers.removeAriaLabel, {
                              provider: p.name,
                            })}
                            disabled={saving === p.id}
                            onClick={() => setConfirmRemove({ id: p.id, name: p.name })}
                            className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </Tooltip>
                      </>
                    ) : null}
                    {!isCustom && hasSaved ? (
                      <Tooltip label={t(($) => $.settings.ai.providers.deleteKeyTooltip)}>
                        <button type="button"
                          data-testid={`ai-provider-delete-${p.id}`}
                          aria-label={t(($) => $.settings.ai.providers.deleteKeyAriaLabel, {
                            provider: p.name,
                          })}
                          disabled={saving === p.id}
                          onClick={() => void deleteKey(p.id)}
                          className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                  {(() => {
                    const providerStatus = status[p.id] ?? "idle";
                    if (providerStatus === "idle") return null;
                    const nonValidClass =
                      providerStatus === "error"
                        ? "mt-1.5 text-[11px] text-destructive"
                        : "mt-1.5 text-[11px] text-muted-foreground";
                    const nonValidatingText =
                      providerStatus === "valid"
                        ? t(($) => $.settings.ai.providers.status.valid)
                        : t(($) => $.settings.ai.providers.status.error, {
                            message:
                              errorMsg[p.id] ??
                              t(($) => $.settings.ai.providers.status.errorFallback),
                          });
                    return (
                      <p
                        data-testid={`ai-provider-status-${p.id}`}
                        className={
                          providerStatus === "valid"
                            ? "mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-500"
                            : nonValidClass
                        }
                      >
                        {providerStatus === "validating"
                          ? t(($) => $.settings.ai.providers.status.validating)
                          : nonValidatingText}
                      </p>
                    );
                  })()}
                  {isConfigured && (
                    <ModelManager
                      providerId={p.id}
                      models={cfg.ai_provider_models[p.id] ?? seedProviderModels(p.id)}
                      apiKey={value}
                      onChange={(next) => void persistModels(p.id, next)}
                      onRefreshed={(next, at) => void persistRefreshedModels(p.id, next, at)}
                      refreshedAt={cfg.ai_model_lists_refreshed_at?.[p.id]}
                      probes={cfg.ai_model_probes}
                      discoverable={supportsModelDiscovery(p.id, isCustom)}
                    />
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModelMetadataStatusLine />
        <div className="ml-auto flex justify-end" data-tour="ai-settings-custom-provider">
          <Button data-testid="ai-add-custom-provider" onClick={onAddCustomProvider}>
            <Plus className="size-4" />
            {t(($) => $.settings.ai.providers.addCustom)}
          </Button>
        </div>
      </div>

      <ConfirmationDialog
        open={confirmRemove !== null}
        title={t(($) => $.settings.ai.providers.removeDialog.title)}
        description={t(($) => $.settings.ai.providers.removeDialog.description, {
          provider: confirmRemove?.name ?? "",
        })}
        confirmLabel={t(($) => $.common.actions.remove)}
        destructive
        onConfirm={() => {
          if (confirmRemove) void deleteCustomProvider(confirmRemove.id);
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}
