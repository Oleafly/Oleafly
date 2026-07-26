import { useState, type Dispatch, type SetStateAction } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { defaultModel, mergeCustomProviders } from "@/lib/ai-providers";
import { enabledModels, seedProviderModels } from "@/lib/ai-model-state";
import { DEFAULT_OLLAMA_HOST } from "@/lib/ollama";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { ModelManager } from "./ModelManager";

export type ProviderStatus = "idle" | "validating" | "valid" | "error";

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
}: {
  active: boolean;
  host: string;
  onHostChange: (v: string) => void;
  status: "idle" | "loading" | "ok" | "down";
  models: string[];
  onDetect: () => void;
  selectedModel: string;
  onUse: (model: string) => void;
  onDisconnect?: () => void;
}) {
  const [showHost, setShowHost] = useState(false);
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
          {status === "idle" ? "Check for Ollama" : "Re-check"}
        </Button>
        {status === "loading" ? (
          <span className="text-[11px] text-muted-foreground">Checking…</span>
        ) : status === "ok" ? (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-500">
            Running · {models.length} model{models.length === 1 ? "" : "s"}
          </span>
        ) : status === "down" ? (
          <span className="text-[11px] text-amber-600 dark:text-amber-500">
            Not detected
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Not checked yet</span>
        )}
      </div>

      {status === "down" && (
        <div className="space-y-1 rounded-md border border-dashed bg-background p-3 text-[11px] text-muted-foreground">
          <p>
            No Ollama responding at <code>{shown}</code>.
          </p>
          <p>
            1. Install from{" "}
            <button type="button"
              onClick={() => void open("https://ollama.com/download")}
              className="font-medium text-primary hover:underline"
            >
              ollama.com <ExternalLink className="inline size-3" />
            </button>{" "}
            · 2. It starts automatically (or run <code>ollama serve</code>) · 3. Pull a
            model, e.g. <code>ollama pull llama3.2</code> · 4. Re-check.
          </p>
        </div>
      )}

      {status === "ok" && models.length === 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          Ollama is running but no models are installed. Run{" "}
          <code>ollama pull llama3.2</code>, then Re-check.
        </p>
      )}

      {status === "ok" && models.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Model</span>
          <Select
            value={active && models.includes(selectedModel) ? selectedModel : ""}
            onValueChange={onUse}
          >
            <SelectTrigger className="h-8 flex-1">
              <SelectValue placeholder="Choose a model to use" />
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
              <Check className="size-3 shrink-0" /> Active
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="button"
          onClick={() => setShowHost((s) => !s)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {showHost ? "Hide host" : "Change host (advanced)"}
        </button>
        {onDisconnect && (
          <button type="button"
            onClick={onDisconnect}
            className="text-[11px] text-muted-foreground hover:text-destructive"
          >
            Disconnect
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
  ollama: { status: "idle" | "loading" | "ok" | "down"; models: string[] };
  refreshOllama: (host: string) => Promise<void>;
  applyOllamaModel: (model: string) => Promise<void>;
  validateAndSave: (id: string) => Promise<void>;
  status: Record<string, ProviderStatus>;
  errorMsg: Record<string, string>;
  changeModel: (modelId: string) => Promise<void>;
  deleteKey: (id: string) => Promise<void>;
  persistModels: (id: string, next: StoredModel[]) => Promise<void>;
  onAddCustomProvider: () => void;
  deleteCustomProvider: (id: string) => Promise<void>;
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
  refreshOllama,
  applyOllamaModel,
  validateAndSave,
  status,
  errorMsg,
  changeModel,
  deleteKey,
  persistModels,
  onAddCustomProvider,
  deleteCustomProvider,
}: ProvidersTabProps) {
  const activeProvider = cfg.ai_provider;
  const allProviders = mergeCustomProviders(cfg.ai_custom_providers);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect any providers you use below. Keys are stored locally only. Saving one sets it as the
        default; switch between configured providers and models anytime from the dropdown in the chat
        panel.
      </p>

      <div className="space-y-2.5" data-tour="ai-settings-providers">
        {allProviders.map((p) => {
          const isCustom = cfg.ai_custom_providers.some((c) => c.id === p.id);
          const value = keys[p.id] ?? "";
          const saved = savedKeys[p.id] ?? "";
          const dirty = value.trim().length > 0 && value !== saved;
          const hasSaved = saved.length > 0;
          // A custom provider is usable the moment it's added, key or not
          // (self-hosted bases may not require one).
          const isConfigured = hasSaved || isCustom;
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
                    {isOpen && <p className="mt-0.5 text-xs text-muted-foreground">{p.blurb}</p>}
                  </div>
                </button>
                {isConfigured && (
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-medium leading-none text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3 shrink-0" /> Connected
                  </span>
                )}
                {p.signupUrl && isOpen && (
                  <button type="button"
                    onClick={() => {
                      if (p.signupUrl) void open(p.signupUrl);
                    }}
                    className="flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline dark:text-primary"
                  >
                    {p.isHost ? "Docs" : "Get key"} <ExternalLink className="size-3" />
                  </button>
                )}
              </div>

              {!isOpen ? null : p.id === "ollama" ? (
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
                          <span className="text-[11px] text-muted-foreground">Model</span>
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
                    <Input
                      type="password"
                      value={value}
                      onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                      placeholder="Paste your API key here"
                      data-testid={`ai-provider-key-${p.id}`}
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
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
                        Save
                      </Button>
                    ) : null}
                    {isCustom ? (
                      <Tooltip label="Remove custom provider">
                        <button type="button"
                          data-testid={`ai-provider-delete-${p.id}`}
                          aria-label={`Remove ${p.name}`}
                          disabled={saving === p.id}
                          onClick={() => setConfirmRemove({ id: p.id, name: p.name })}
                          className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </Tooltip>
                    ) : hasSaved ? (
                      <Tooltip label="Delete key">
                        <button type="button"
                          data-testid={`ai-provider-delete-${p.id}`}
                          aria-label={`Delete ${p.name} key`}
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
                    return (
                      <p
                        data-testid={`ai-provider-status-${p.id}`}
                        className={
                          providerStatus === "valid"
                            ? "mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-500"
                            : providerStatus === "error"
                              ? "mt-1.5 text-[11px] text-destructive"
                              : "mt-1.5 text-[11px] text-muted-foreground"
                        }
                      >
                        {providerStatus === "validating"
                          ? "Checking key..."
                          : providerStatus === "valid"
                            ? "Key valid. Models are ready below."
                            : `Error: ${errorMsg[p.id] ?? "Could not validate the key."}`}
                      </p>
                    );
                  })()}
                  {isConfigured && (
                    <ModelManager
                      providerId={p.id}
                      models={cfg.ai_provider_models[p.id] ?? seedProviderModels(p.id)}
                      apiKey={value}
                      onChange={(next) => void persistModels(p.id, next)}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end" data-tour="ai-settings-custom-provider">
        <Button data-testid="ai-add-custom-provider" onClick={onAddCustomProvider}>
          <Plus className="size-4" />
          Add custom provider
        </Button>
      </div>

      <ConfirmationDialog
        open={confirmRemove !== null}
        title="Remove custom provider"
        description={`Remove "${confirmRemove?.name ?? ""}"? Its saved key and model list are deleted with it.`}
        confirmLabel="Remove"
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
