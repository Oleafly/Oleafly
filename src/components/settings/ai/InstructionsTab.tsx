import { useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { setConfig, type AppConfig } from "@/lib/tauri";
import { mergeCustomProviders } from "@/lib/ai-providers";
import { enabledModels } from "@/lib/ai-model-state";
import { AiToolsGrid } from "@/components/ai/AiToolsList";
import { ModelSelector, type ModelSelectorGroup } from "@/components/ai/ModelSelector";

export interface InstructionsTabProps {
  cfg: AppConfig;
  setCfg: Dispatch<SetStateAction<AppConfig>>;
  savedKeys: Record<string, string>;
  persist: (next: AppConfig) => Promise<void>;
  sysPrompt: string;
  setSysPrompt: Dispatch<SetStateAction<string>>;
  sysPromptSaved: boolean;
  saveSystemPrompt: () => Promise<void>;
  setMsg: Dispatch<SetStateAction<{ ok: boolean; text: string } | null>>;
}

export function InstructionsTab({
  cfg,
  setCfg,
  savedKeys,
  persist,
  sysPrompt,
  setSysPrompt,
  sysPromptSaved,
  saveSystemPrompt,
  setMsg,
}: InstructionsTabProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  // Providers the user has actually connected (saved key, or a custom
  // provider with an optional key), same "configured" definition ChatCore
  // uses for its own model switcher.
  const allProviders = mergeCustomProviders(cfg.ai_custom_providers);
  const configuredProviders = allProviders.filter((p) => {
    if ((savedKeys[p.id] ?? "").trim().length > 0) return true;
    return Boolean(cfg.ai_custom_providers.find((c) => c.id === p.id)?.keyOptional);
  });
  const defaultModelGroups: ModelSelectorGroup[] = configuredProviders.map((p) => {
    const storedModels = cfg.ai_provider_models[p.id];
    const models = storedModels
      ? enabledModels(storedModels).map((m) => ({ id: m.id, name: m.name }))
      : p.models.map((m) => ({ id: m.id, name: m.name }));
    return { id: p.id, name: p.name, models };
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="font-medium">Default chat model</p>
        <p className="text-xs text-muted-foreground">
          Used whenever you start a new chat. You can still switch models for an individual
          conversation from the chat panel.
        </p>
        <div data-testid="ai-default-model" data-tour="ai-default-model">
          <ModelSelector
            providerId={cfg.ai_provider || "openai"}
            modelId={cfg.ai_model || ""}
            groups={defaultModelGroups}
            contentClassName="z-[100]"
            disabled={defaultModelGroups.length === 0}
            onChange={(providerId, modelId) =>
              void persist({ ...cfg, ai_provider: providerId, ai_model: modelId })
            }
          />
        </div>
      </div>

      <div className="space-y-2" data-tour="ai-instructions">
        <p className="font-medium">Custom instructions</p>
        <p className="text-xs text-muted-foreground">
          Added to every AI request as your personal style and preferences. The
          assistant follows these on top of its built-in behavior. They can't
          override its tools or safety rules.
        </p>
        <Textarea
          value={sysPrompt}
          onChange={(e) => setSysPrompt(e.target.value)}
          rows={5}
          placeholder="e.g. Always write in British English. Keep explanations short. Prefer the enumitem package for lists."
          className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void saveSystemPrompt()}
            disabled={sysPrompt === (cfg.ai_system_prompt || "")}
          >
            Save instructions
          </Button>
          {sysPromptSaved && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <p className="font-medium">Agent capabilities</p>
        <label htmlFor="ai-pdf-capture" className="flex cursor-pointer items-start gap-2.5 text-xs">
          <Checkbox
            id="ai-pdf-capture"
            className="mt-0.5"
            checked={cfg.ai_pdf_capture !== false}
            onCheckedChange={(checked) => {
              const on = checked === true;
              const next = { ...cfg, ai_pdf_capture: on };
              setCfg(next);
              try {
                localStorage.setItem("oleafly:ai_pdf_capture", on ? "1" : "0");
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

      <div className="overflow-hidden rounded-lg border bg-card">
        <button
          type="button"
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
