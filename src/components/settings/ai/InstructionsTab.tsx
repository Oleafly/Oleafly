import { useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { AppConfig } from "@/lib/tauri";
import { describeError } from "@/lib/app-error";
import { suggestedProviderId } from "@/lib/ai-providers";
import { configuredModelGroups } from "@/lib/ai-model-groups";
import { AiToolsTable } from "@/components/ai/AiToolsList";
import { ModelSelector } from "@/components/ai/ModelSelector";

export interface InstructionsTabProps {
  cfg: AppConfig;
  /** False until the stored config is read: the switches stay off so a click can't write the defaults. */
  configLoaded: boolean;
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
  configLoaded,
  savedKeys,
  persist,
  sysPrompt,
  setSysPrompt,
  sysPromptSaved,
  saveSystemPrompt,
  setMsg,
}: Readonly<InstructionsTabProps>) {
  const { t, i18n } = useTranslation(["settings"]);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Providers the user has actually connected (saved key, or a custom
  // provider with an optional key), same "configured" definition ChatCore
  // uses for its own model switcher.
  const defaultModelGroups = configuredModelGroups(
    {
      keys: savedKeys,
      customProviders: cfg.ai_custom_providers,
      providerModels: cfg.ai_provider_models,
    },
    { dropEmpty: false },
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="font-medium">{t(($) => $.settings.ai.instructions.defaultModelTitle)}</p>
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.ai.instructions.defaultModelDescription)}
        </p>
        <div data-testid="ai-default-model" data-tour="ai-default-model">
          <ModelSelector
            providerId={cfg.ai_provider || suggestedProviderId(i18n.language)}
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
        <p className="font-medium">{t(($) => $.settings.ai.instructions.customTitle)}</p>
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.ai.instructions.customDescription)}
        </p>
        <Textarea
          value={sysPrompt}
          onChange={(e) => setSysPrompt(e.target.value)}
          rows={5}
          placeholder={t(($) => $.settings.ai.instructions.customPlaceholder)}
          className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed focus:border-ring"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void saveSystemPrompt()}
            disabled={sysPrompt === (cfg.ai_system_prompt || "")}
          >
            {t(($) => $.settings.ai.instructions.save)}
          </Button>
          {sysPromptSaved && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              {t(($) => $.settings.ai.instructions.saved)}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <p className="font-medium">{t(($) => $.settings.ai.instructions.capabilitiesTitle)}</p>
        <label htmlFor="ai-pdf-capture" className="flex cursor-pointer items-start gap-2.5 text-xs">
          <Checkbox
            id="ai-pdf-capture"
            className="mt-0.5"
            checked={cfg.ai_pdf_capture !== false}
            disabled={!configLoaded}
            onCheckedChange={(checked) => {
              const on = checked === true;
              // persist() merges into the stored config; the box changes only once it is saved.
              void persist({ ...cfg, ai_pdf_capture: on })
                .then(() => {
                  try {
                    localStorage.setItem("oleafly:ai_pdf_capture", on ? "1" : "0");
                  } catch {
                    /* ignore */
                  }
                })
                .catch((err) => setMsg({ ok: false, text: describeError(err) }));
            }}
          />
          <span>
            <span className="font-medium text-foreground">
              {t(($) => $.settings.ai.instructions.pdfCaptureLabel)}
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              {t(($) => $.settings.ai.instructions.pdfCaptureDescription)}
            </span>
          </span>
        </label>
        <label htmlFor="ai-reasoning-summaries" className="flex cursor-pointer items-start gap-2.5 text-xs">
          <Checkbox
            id="ai-reasoning-summaries"
            className="mt-0.5"
            checked={cfg.ai_reasoning_summaries === true}
            disabled={!configLoaded}
            onCheckedChange={(checked) => {
              void persist({ ...cfg, ai_reasoning_summaries: checked === true }).catch((err) =>
                setMsg({ ok: false, text: describeError(err) }),
              );
            }}
          />
          <span>
            <span className="font-medium text-foreground">
              {t(($) => $.settings.ai.instructions.reasoningSummariesLabel)}
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              {t(($) => $.settings.ai.instructions.reasoningSummariesDescription)}
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
          {t(($) => $.settings.ai.instructions.toolsTitle)}
          {toolsOpen ? (
            <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
          )}
        </button>
        {toolsOpen && (
          <div className="border-t px-3 pb-3 pt-2">
            <p className="mb-2 text-[0.6875rem] text-muted-foreground">
              {t(($) => $.settings.ai.instructions.toolsHint)}
            </p>
            <AiToolsTable />
          </div>
        )}
      </div>
    </div>
  );
}
