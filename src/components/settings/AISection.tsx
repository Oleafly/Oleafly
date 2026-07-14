import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getConfig, setConfig, type AppConfig } from "@/lib/tauri";
import {
  PROVIDERS,
  credentialMeta,
  defaultModel,
  getProvider,
} from "@/lib/ai-providers";
import { listOllamaModels, DEFAULT_OLLAMA_HOST } from "@/lib/ollama";
import { cn } from "@/lib/utils";

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
            <button
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
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
              <Check className="size-3" /> Active
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowHost((s) => !s)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {showHost ? "Hide host" : "Change host (advanced)"}
        </button>
        {onDisconnect && (
          <button
            onClick={onDisconnect}
            className="text-[11px] text-muted-foreground hover:text-destructive"
          >
            Disconnect
          </button>
        )}
      </div>
      {showHost && (
        <input
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


const AI_TOOLS: { name: string; desc: string }[] = [
  { name: "read_file", desc: "Read a file's contents" },
  { name: "write_file", desc: "Write or overwrite a file" },
  { name: "replace_in_file", desc: "Find & replace within a file" },
  { name: "create_file", desc: "Create a file or folder" },
  { name: "rename_file", desc: "Rename or move a path" },
  { name: "delete_file", desc: "Delete a file or folder" },
  { name: "list_files", desc: "List the project tree" },
  { name: "search_project", desc: "Search text in the current project" },
  { name: "project_map", desc: "Structural outline, labels, cites, inputs" },
  { name: "compile", desc: "Compile LaTeX to PDF" },
  { name: "get_log", desc: "Get the last compile log" },
  { name: "get_pdf_text", desc: "Extract text from the PDF" },
  { name: "verify_pdf_pages", desc: "Rasterize pages for vision layout checks" },
  { name: "update_todos", desc: "Maintain a multi-step plan checklist" },
  { name: "get_todos", desc: "Read the current plan checklist" },
  { name: "remember_note", desc: "Save sticky project memory for later turns" },
  { name: "forget_note", desc: "Remove a sticky memory note" },
  { name: "list_notes", desc: "List sticky project memory notes" },
  { name: "set_main_doc", desc: "Set the main .tex document" },
  { name: "toggle_theme", desc: "Toggle light/dark mode" },
];

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
  mcp_enabled: false,
  mcp_port: 5323,
  mcp_read_only: false,
  mcp_approval_policy: "ask",
};

export function AISection() {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CFG);
  const [keys, setKeys] = useState<Record<string, string>>({});
  // Snapshot of persisted keys, used to detect unsaved edits (dirty check below).
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [sysPrompt, setSysPrompt] = useState("");
  const [sysPromptSaved, setSysPromptSaved] = useState(false);
  // Unset falls back to "open if active", so the in-use provider stays expanded.
  const [openProviders, setOpenProviders] = useState<Record<string, boolean>>({});
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
      setKeys(merged);
      setSavedKeys(merged);
      if (Object.keys(c.ai_keys ?? {}).length === 0 && c.ai_api_key) {
        void setConfig(next);
      }
    });
  }, []);

  const activeProvider = cfg.ai_provider;

  const refreshOllama = async (host: string) => {
    setOllama((o) => ({ ...o, status: "loading" }));
    try {
      const models = await listOllamaModels(host);
      setOllama({ status: "ok", models });
    } catch {
      setOllama({ status: "down", models: [] });
    }
  };

  // Cheap localhost request that fails fast, so it's run proactively instead of
  // waiting on the user to configure a host first.
  const savedOllamaHost = cfg.ai_keys?.ollama ?? "";
  useEffect(() => {
    void refreshOllama(savedOllamaHost || DEFAULT_OLLAMA_HOST);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOllamaHost]);

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

  const persist = async (next: AppConfig) => {
    await setConfig(next);
    setCfg(next);
    // Notifies listeners outside this component tree, e.g. the chat panel.
    window.dispatchEvent(new CustomEvent("openleaf:ai-config-changed"));
  };

  const saveProvider = async (id: string) => {
    const value = (keys[id] ?? "").trim();
    if (!value) return;
    setSaving(id);
    setMsg(null);
    try {
      const nextKeys = { ...keys, [id]: value };
      const sameProvider = cfg.ai_provider === id;
      const next: AppConfig = {
        ...cfg,
        ai_keys: nextKeys,
        ai_provider: id,
        ai_model: sameProvider ? cfg.ai_model : defaultModel(id),
      };
      await persist(next);
      setKeys(nextKeys);
      setSavedKeys(nextKeys);
      setMsg({
        ok: true,
        text: `${getProvider(id)?.name ?? id} connected and now active.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
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
      <div className="overflow-hidden rounded-lg border bg-background">
        <button
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
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {AI_TOOLS.map((t) => (
                <div key={t.name} className="flex items-baseline gap-2 text-[11px]">
                  <code className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    {t.name}
                  </code>
                  <span className="text-muted-foreground">{t.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Connect any providers you use below. Keys are stored locally only. Saving one sets it as the
        default; switch between configured providers and models anytime from the dropdown in the chat
        panel.
      </p>

      <div className="space-y-2.5">
        {PROVIDERS.map((p) => {
          const meta = credentialMeta(p.id);
          const value = keys[p.id] ?? "";
          const saved = savedKeys[p.id] ?? "";
          const dirty = value.trim().length > 0 && value !== saved;
          const isActive = activeProvider === p.id;
          const hasSaved = saved.length > 0;
          const isOpen = openProviders[p.id] ?? isActive;
          return (
            <div
              key={p.id}
              className={cn(
                "rounded-lg border bg-background transition-colors",
                isActive && "border-primary/40 ring-1 ring-primary/20"
              )}
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
                    <span className="font-medium">{p.name}</span>
                    {isOpen && <p className="mt-0.5 text-xs text-muted-foreground">{p.blurb}</p>}
                  </div>
                </button>
                {isActive ? (
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3" /> Active
                  </span>
                ) : hasSaved ? (
                  <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Connected
                  </span>
                ) : null}
                {p.signupUrl && isOpen && (
                  <button
                    onClick={() => void open(p.signupUrl!)}
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
                  {isActive && (
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
                          {p.models.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      type="password"
                      value={value}
                      onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                      placeholder={meta.placeholder}
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                    {dirty ? (
                      <Button
                        size="sm"
                        disabled={saving === p.id}
                        onClick={() => void saveProvider(p.id)}
                      >
                        {saving === p.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        Save
                      </Button>
                    ) : hasSaved && !isActive ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={saving === p.id}
                        onClick={() => void activate(p.id)}
                      >
                        Activate
                      </Button>
                    ) : null}
                    {hasSaved && (
                      <button
                        aria-label={`Delete ${p.name} key`}
                        title="Delete key"
                        disabled={saving === p.id}
                        onClick={() => void deleteKey(p.id)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t pt-4">
        <p className="font-medium">Custom instructions</p>
        <p className="text-xs text-muted-foreground">
          Added to every AI request as your personal style and preferences. The
          assistant follows these on top of its built-in behavior. They can't
          override its tools or safety rules.
        </p>
        <textarea
          value={sysPrompt}
          onChange={(e) => setSysPrompt(e.target.value)}
          rows={5}
          placeholder="e.g. Always write in British English. Keep explanations short. Prefer the enumitem package for lists."
          className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveSystemPrompt()}
            disabled={sysPrompt === (cfg.ai_system_prompt || "")}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            Save instructions
          </button>
          {sysPromptSaved && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <p className="font-medium">Agent capabilities</p>
        <label className="flex cursor-pointer items-start gap-2.5 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={cfg.ai_pdf_capture !== false}
            onChange={(e) => {
              const on = e.target.checked;
              const next = { ...cfg, ai_pdf_capture: on };
              setCfg(next);
              try {
                localStorage.setItem("openleaf:ai_pdf_capture", on ? "1" : "0");
              } catch {
                /* ignore */
              }
              void setConfig(next).catch((err) => setMsg({ ok: false, text: String(err) }));
            }}
          />
          <span>
            <span className="font-medium text-foreground">Allow PDF page capture for AI</span>
            <span className="mt-0.5 block text-muted-foreground">
              Lets the agent rasterize compiled pages (verify_pdf_pages) for vision layout checks.
              Disable if you prefer not to send page images to your provider.
            </span>
          </span>
        </label>
      </div>

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
    </div>
  );
}

