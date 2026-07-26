import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { getConfig, setConfig, type AppConfig, type CustomProvider, type StoredModel } from "@/lib/tauri";
import { defaultModel, discoveryFor, fetchProviderModels, getProvider } from "@/lib/ai-providers";
import { enabledModels, mergeFetchedModels, seedProviderModels } from "@/lib/ai-model-state";
import { listOllamaModels, DEFAULT_OLLAMA_HOST } from "@/lib/ollama";
import { AiToolsGrid } from "@/components/ai/AiToolsList";
import { cn } from "@/lib/utils";
import { ProvidersTab, type ProviderStatus } from "./ai/ProvidersTab";
import { InstructionsTab } from "./ai/InstructionsTab";
import { PersonasTab } from "./ai/PersonasTab";
import { AddCustomProviderDialog, type AddCustomProviderInput } from "./ai/AddCustomProviderDialog";

type AITab = "providers" | "instructions" | "personas";

const DEFAULT_CFG: AppConfig = {
  github_token: "",
  github_user: "",
  github_connected: false,
  ai_api_key: "",
  ai_provider: "openai",
  ai_model: "gpt-4o-mini",
  ai_keys: {},
  ai_system_prompt: "",
  ai_pdf_capture: true,
  ai_provider_models: {},
  ai_custom_providers: [],
  ai_personas: [],
  mcp_enabled: false,
  mcp_port: 5323,
  mcp_read_only: false,
  mcp_approval_policy: "ask",
};

export function AISection() {
  const [tab, setTab] = useState<AITab>("providers");
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CFG);
  const [keys, setKeys] = useState<Record<string, string>>({});
  // Snapshot of persisted keys, used to detect unsaved edits (dirty check below).
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, ProviderStatus>>({});
  const [errorMsg, setErrorMsg] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [sysPrompt, setSysPrompt] = useState("");
  const [sysPromptSaved, setSysPromptSaved] = useState(false);
  // Unset falls back to "open if active", so the in-use provider stays expanded.
  const [openProviders, setOpenProviders] = useState<Record<string, boolean>>({});
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [ollama, setOllama] = useState<{
    status: "idle" | "loading" | "ok" | "down";
    models: string[];
  }>({ status: "idle", models: [] });

  useEffect(() => {
    void getConfig().then((c) => {
      // One-time migration from the old single ai_api_key field to the per-provider map.
      const merged: Record<string, string> = { ...(c.ai_keys ?? {}) };
      const legacy = c.ai_provider || "openai";
      if (Object.keys(merged).length === 0 && c.ai_api_key) {
        merged[legacy] = c.ai_api_key;
      }
      const next: AppConfig = { ...DEFAULT_CFG, ...c, ai_keys: merged };
      setCfg(next);
      setSysPrompt(next.ai_system_prompt || "");
      // Merge under any keys already typed: the load resolves async and must
      // not wipe an edit made before it landed.
      setKeys((prev) => ({ ...merged, ...prev }));
      setSavedKeys(merged);
      if (Object.keys(c.ai_keys ?? {}).length === 0 && c.ai_api_key) {
        void setConfig(next);
      }
    });
  }, []);

  const refreshOllama = useCallback(async (host: string) => {
    setOllama((o) => ({ ...o, status: "loading" }));
    try {
      const models = await listOllamaModels(host);
      setOllama({ status: "ok", models });
    } catch {
      setOllama({ status: "down", models: [] });
    }
  }, []);

  // Cheap localhost request that fails fast, so it's run proactively instead of
  // waiting on the user to configure a host first.
  const savedOllamaHost = cfg.ai_keys?.ollama ?? "";
  useEffect(() => {
    void refreshOllama(savedOllamaHost || DEFAULT_OLLAMA_HOST);
  }, [savedOllamaHost, refreshOllama]);

  const persist = async (next: AppConfig) => {
    await setConfig(next);
    setCfg(next);
    // Notifies listeners outside this component tree, e.g. the chat panel.
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail: next }));
  };

  // Saves the host and activates the model in one step; no separate "Save" button for Ollama.
  const applyOllamaModel = async (model: string) => {
    const host = (keys.ollama || DEFAULT_OLLAMA_HOST).trim();
    const nextKeys = { ...keys, ollama: host };
    setSaving("ollama");
    setMsg(null);
    try {
      await persist({
        ...cfg,
        ai_keys: nextKeys,
        ai_provider: "ollama",
        ai_model: model,
      });
      setKeys(nextKeys);
      setSavedKeys(nextKeys);
      setMsg({ ok: true, text: `Ollama connected · ${model}` });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
    }
  };

  // Pastes are validated by fetching the provider's live model list before
  // the key is trusted; an unreachable or rejected key never gets persisted.
  // Custom providers are the exception: most third-party bases are
  // OpenAI-compatible, so discovery is attempted with that shape, but a
  // failure there only skips auto-discovered models - the key still saves
  // and the user can add models manually via ModelManager.
  const validateAndSave = async (id: string) => {
    const value = (keys[id] ?? "").trim();
    if (!value) return;
    setSaving(id);
    setMsg(null);
    setStatus((s) => ({ ...s, [id]: "validating" }));
    setErrorMsg((m) => ({ ...m, [id]: "" }));
    try {
      const custom = cfg.ai_custom_providers.find((c) => c.id === id);
      const provider = getProvider(id);
      const baseURL = custom?.baseURL ?? provider?.baseURL;
      const discovery = custom ? { kind: "openai" as const, modelsPath: "/models" } : discoveryFor(id);
      const res = await fetchProviderModels({
        providerId: id,
        baseURL,
        key: value,
        discovery,
        seed: provider?.models ?? [],
      });
      if (!res.ok && !custom) {
        setStatus((s) => ({ ...s, [id]: "error" }));
        setErrorMsg((m) => ({
          ...m,
          [id]: res.reason === "invalid-key" ? "Invalid API key." : "Could not reach the provider.",
        }));
        return;
      }
      const nextKeys = { ...keys, [id]: value };
      const existingModels = cfg.ai_provider_models[id] ?? seedProviderModels(id);
      const mergedModels = res.ok ? mergeFetchedModels(existingModels, res.models) : existingModels;
      const wasActive = Boolean(cfg.ai_provider);
      const next: AppConfig = {
        ...cfg,
        ai_keys: nextKeys,
        ai_provider_models: { ...cfg.ai_provider_models, [id]: mergedModels },
        ai_provider: cfg.ai_provider || id,
        ai_model: wasActive ? cfg.ai_model : defaultModel(id),
      };
      await persist(next);
      setKeys(nextKeys);
      setSavedKeys(nextKeys);
      setStatus((s) => ({ ...s, [id]: "valid" }));
      setMsg({
        ok: true,
        text:
          custom && !res.ok
            ? `${custom.name} key saved. Add models manually below.`
            : `${provider?.name ?? custom?.name ?? id} connected.`,
      });
    } catch (e) {
      setStatus((s) => ({ ...s, [id]: "error" }));
      setErrorMsg((m) => ({ ...m, [id]: String(e) }));
    } finally {
      setSaving(null);
    }
  };

  // Adds a user-defined OpenAI-compatible provider. Discovery is attempted
  // but never blocks the save - a custom base that doesn't expose /models
  // just starts with an empty model list for manual entry.
  const addCustomProvider = async (
    input: AddCustomProviderInput
  ): Promise<{ ok: boolean; message?: string }> => {
    const { id, name, apiKey } = input;
    const baseURL = input.baseURL.replace(/\/+$/, "");
    if (getProvider(id) || cfg.ai_custom_providers.some((c) => c.id === id)) {
      return { ok: false, message: "That provider ID is already in use." };
    }
    let models: StoredModel[] = [];
    const res = await fetchProviderModels({
      providerId: id,
      baseURL,
      key: apiKey,
      discovery: { kind: "openai", modelsPath: "/models" },
      seed: [],
    });
    if (res.ok) {
      models = res.models.map((m) => ({ id: m.id, name: m.name, enabled: true, source: "fetched" as const }));
    }
    const customProvider: CustomProvider = { id, name, baseURL, keyOptional: !apiKey };
    const nextKeys = apiKey ? { ...cfg.ai_keys, [id]: apiKey } : cfg.ai_keys;
    const next: AppConfig = {
      ...cfg,
      ai_custom_providers: [...cfg.ai_custom_providers, customProvider],
      ai_provider_models: { ...cfg.ai_provider_models, [id]: models },
      ai_keys: nextKeys,
    };
    try {
      await persist(next);
      if (apiKey) {
        setKeys((k) => ({ ...k, [id]: apiKey }));
        setSavedKeys((k) => ({ ...k, [id]: apiKey }));
      }
      setOpenProviders((m) => ({ ...m, [id]: true }));
      setMsg({ ok: true, text: `${name} added.` });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  };

  const deleteCustomProvider = async (id: string) => {
    setSaving(id);
    setMsg(null);
    try {
      const nextKeys = { ...keys };
      delete nextKeys[id];
      const nextModels = { ...cfg.ai_provider_models };
      delete nextModels[id];
      const wasActive = cfg.ai_provider === id;
      const next: AppConfig = {
        ...cfg,
        ai_custom_providers: cfg.ai_custom_providers.filter((c) => c.id !== id),
        ai_provider_models: nextModels,
        ai_keys: nextKeys,
        ai_provider: wasActive ? "" : cfg.ai_provider,
        ai_model: wasActive ? "" : cfg.ai_model,
      };
      await persist(next);
      setKeys(nextKeys);
      setSavedKeys(nextKeys);
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
    }
  };

  // Persists a model-manager edit (add, enable, disable, delete) for one
  // provider; if the change drops the currently active model, fall back to
  // the first remaining enabled model instead of leaving a dangling id.
  const persistModels = async (id: string, next: StoredModel[]) => {
    let nextConfig: AppConfig = {
      ...cfg,
      ai_provider_models: { ...cfg.ai_provider_models, [id]: next },
    };
    if (cfg.ai_provider === id) {
      const stillEnabled = enabledModels(next).some((m) => m.id === cfg.ai_model);
      if (!stillEnabled) {
        nextConfig = { ...nextConfig, ai_model: enabledModels(next)[0]?.id ?? "" };
      }
    }
    try {
      await persist(nextConfig);
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  const activate = async (id: string) => {
    if (cfg.ai_provider === id) return;
    setSaving(id);
    setMsg(null);
    try {
      await persist({ ...cfg, ai_provider: id, ai_model: defaultModel(id) });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
    }
  };

  const changeModel = async (modelId: string) => {
    try {
      await persist({ ...cfg, ai_model: modelId });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  const saveSystemPrompt = async () => {
    try {
      await persist({ ...cfg, ai_system_prompt: sysPrompt });
      setSysPromptSaved(true);
      setTimeout(() => setSysPromptSaved(false), 1500);
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  const deleteKey = async (id: string) => {
    setSaving(id);
    setMsg(null);
    try {
      const nextKeys = { ...keys };
      delete nextKeys[id];
      const wasActive = cfg.ai_provider === id;
      const next: AppConfig = {
        ...cfg,
        ai_keys: nextKeys,
        // Clear the active provider/model too if this was the key in use.
        ai_provider: wasActive ? "" : cfg.ai_provider,
        ai_model: wasActive ? "" : cfg.ai_model,
        ai_api_key: wasActive ? "" : cfg.ai_api_key,
      };
      await persist(next);
      setKeys(nextKeys);
      setSavedKeys(nextKeys);
      setMsg({
        ok: true,
        text: wasActive
          ? `${getProvider(id)?.name ?? id} key removed - AI access disabled.`
          : `${getProvider(id)?.name ?? id} key removed.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="flex gap-2 border-b">
        {(["providers", "instructions", "personas"] as AITab[]).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`ai-settings-tab-${t}`}
            onClick={() => setTab(t)}
            className={cn(
              "px-2.5 py-1.5 text-xs transition-colors",
              tab === t
                ? "border-b-2 border-primary font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "providers" ? "Providers and keys" : t === "instructions" ? "Instructions" : "Personas"}
          </button>
        ))}
      </div>

      {tab === "providers" && (
        <ProvidersTab
          cfg={cfg}
          keys={keys}
          savedKeys={savedKeys}
          saving={saving}
          openProviders={openProviders}
          setOpenProviders={setOpenProviders}
          setKeys={setKeys}
          ollama={ollama}
          refreshOllama={refreshOllama}
          applyOllamaModel={applyOllamaModel}
          validateAndSave={validateAndSave}
          status={status}
          errorMsg={errorMsg}
          activate={activate}
          changeModel={changeModel}
          deleteKey={deleteKey}
          persistModels={persistModels}
          onAddCustomProvider={() => setCustomDialogOpen(true)}
          deleteCustomProvider={deleteCustomProvider}
        />
      )}

      <AddCustomProviderDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        onSubmit={addCustomProvider}
      />

      {tab === "instructions" && (
        <InstructionsTab
          cfg={cfg}
          setCfg={setCfg}
          savedKeys={savedKeys}
          persist={persist}
          sysPrompt={sysPrompt}
          setSysPrompt={setSysPrompt}
          sysPromptSaved={sysPromptSaved}
          saveSystemPrompt={saveSystemPrompt}
          setMsg={setMsg}
        />
      )}

      {tab === "personas" && <PersonasTab />}

      {msg && (
        <div
          className={cn(
            "rounded-md border p-2.5 text-xs",
            msg.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          {msg.text}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <button type="button"
          onClick={() => setToolsOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 p-3 text-left text-xs font-semibold hover:bg-accent/40"
          aria-expanded={toolsOpen}
        >
          <Sparkles className="size-3.5 text-primary" />
          The assistant currently supports these tools
          {toolsOpen ? (
            <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
          )}
        </button>
        {toolsOpen && (
          <div className="border-t px-3 pb-3 pt-2">
            <p className="mb-2 text-[11px] text-muted-foreground">
              Ask it things like "fix the LaTeX errors", "add a Publications section", or "recompile
              and check the PDF".
            </p>
            <AiToolsGrid columns={2} />
          </div>
        )}
      </div>
    </div>
  );
}
