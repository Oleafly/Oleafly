import { useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { AppConfig } from "@/lib/tauri";
import { describeError } from "@/lib/app-error";
import { suggestedProviderId } from "@/lib/ai-providers";
import { configuredModelGroups } from "@/lib/ai-model-groups";
import { AiToolsTable } from "@/components/ai/AiToolsList";
import { ModelSelector } from "@/components/ai/ModelSelector";
import { AiCompletionModelSetting } from "@/components/settings/AiCompletionModelSetting";
import { useSettingsStore } from "@/store/settings";
import { SavedInstructionsSection } from "./SavedInstructionsSection";

export interface InstructionsTabProps {
  cfg: AppConfig;
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
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({});
  const [budgetSaving, setBudgetSaving] = useState(false);
  const aiCompletion = useSettingsStore((s) => s.aiCompletion);
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

      {aiCompletion ? <AiCompletionModelSetting config={cfg} /> : null}

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
          className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-xs leading-relaxed"
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
        <p className="font-medium">{t(($) => $.settings.ai.instructions.agentBudgets.title)}</p>
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.ai.instructions.agentBudgets.description)}
        </p>
        {([
          ["ai_agent_max_steps", t(($) => $.settings.ai.instructions.agentBudgets.stepsLabel), 2000, 50],
          [
            "ai_agent_max_output_tokens",
            t(($) => $.settings.ai.instructions.agentBudgets.outputLabel),
            1048576,
            0,
          ],
          [
            "ai_agent_total_tokens",
            t(($) => $.settings.ai.instructions.agentBudgets.totalLabel),
            100000000,
            0,
          ],
        ] as const).map(([key, label, max, fallback]) => (
          <label key={key} htmlFor={key} className="block space-y-1 text-xs">
            <span>{label}</span>
            <Input
              id={key}
              type="number"
              min={1}
              max={max}
              step={1}
              placeholder={
                fallback ? String(fallback) : t(($) => $.settings.ai.instructions.agentBudgets.auto)
              }
              value={budgetDraft[key] ?? (cfg[key] == null ? "" : String(cfg[key]))}
              disabled={!configLoaded || budgetSaving}
              onChange={(event) => setBudgetDraft((prev) => ({ ...prev, [key]: event.target.value }))}
            />
          </label>
        ))}
        <Button
          size="sm"
          disabled={!configLoaded || budgetSaving || Object.keys(budgetDraft).length === 0}
          onClick={() => {
            const next = { ...cfg };
            for (const [key, max] of [
              ["ai_agent_max_steps", 2000],
              ["ai_agent_max_output_tokens", 1048576],
              ["ai_agent_total_tokens", 100000000],
            ] as const) {
              const raw = budgetDraft[key];
              if (raw === undefined) continue;
              const value = raw.trim() === "" ? null : Number(raw);
              if (value !== null && (!Number.isSafeInteger(value) || value < 1 || value > max)) {
                setMsg({
                  ok: false,
                  text: t(($) => $.settings.ai.instructions.agentBudgets.invalid, {
                    field: key,
                    max,
                  }),
                });
                return;
              }
              next[key] = value;
            }
            setBudgetSaving(true);
            void persist(next)
              .then(() => setBudgetDraft({}))
              .catch((err) => setMsg({ ok: false, text: describeError(err) }))
              .finally(() => setBudgetSaving(false));
          }}
        >
          {t(($) => $.settings.ai.instructions.agentBudgets.save)}
        </Button>
      </div>

      <SavedInstructionsSection cfg={cfg} configLoaded={configLoaded} persist={persist} />

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
