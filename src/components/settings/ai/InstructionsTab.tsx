import type { Dispatch, SetStateAction } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { setConfig, type AppConfig } from "@/lib/tauri";

export interface InstructionsTabProps {
  cfg: AppConfig;
  setCfg: Dispatch<SetStateAction<AppConfig>>;
  sysPrompt: string;
  setSysPrompt: Dispatch<SetStateAction<string>>;
  sysPromptSaved: boolean;
  saveSystemPrompt: () => Promise<void>;
  setMsg: Dispatch<SetStateAction<{ ok: boolean; text: string } | null>>;
}

export function InstructionsTab({
  cfg,
  setCfg,
  sysPrompt,
  setSysPrompt,
  sysPromptSaved,
  saveSystemPrompt,
  setMsg,
}: InstructionsTabProps) {
  return (
    <div className="space-y-4">
      {/* Filled in by a later task. */}
      <div data-testid="ai-default-model" />

      <div className="space-y-2">
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
    </div>
  );
}
