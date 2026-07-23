import { useEffect, useRef } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import { PRESETS } from "@/lib/ai-inline";
import { AiChrome, AiMark } from "@/components/ai/AiChrome";
import { ModelSelector, type ModelSelectorGroup } from "@/components/ai/ModelSelector";
import { Textarea } from "@/components/ui/textarea";

export function PromptPopover({
  instruction,
  onInstruction,
  onSubmit,
  onPreset,
  onClose,
  streaming,
  onStop,
  providerId,
  modelId,
  modelGroups,
  onModelChange,
}: {
  instruction: string;
  onInstruction: (v: string) => void;
  onSubmit: () => void;
  onPreset: (instruction: string) => void;
  onClose: () => void;
  streaming: boolean;
  onStop: () => void;
  providerId: string;
  modelId: string;
  modelGroups: ModelSelectorGroup[];
  onModelChange: (providerId: string, modelId: string) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: instruction is the resize trigger, not read in the body.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [instruction]);

  return (
    <AiChrome className="w-full" contentClassName="p-2 text-popover-foreground">
      <div className="flex items-start gap-2">
        <AiMark className="mt-0.5" />
        <Textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => onInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !streaming && instruction.trim()) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Describe the change…  (Shift+Enter for a new line)"
          disabled={streaming}
          rows={2}
          className="min-h-[2.75rem] min-w-0 flex-1 resize-none border-0 bg-transparent text-sm leading-snug shadow-none outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {!streaming && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPreset(p.instruction)}
              className="flex-1 whitespace-nowrap rounded-full px-2 py-0.5 text-center text-xs text-primary hover:bg-primary/10"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {streaming && <span className="ai-shimmer text-[10px] font-medium">Thinking…</span>}
        </div>
        <ModelSelector
          compact
          disabled={streaming}
          providerId={providerId}
          modelId={modelId}
          groups={modelGroups}
          onChange={onModelChange}
          className="max-w-28"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground hover:bg-accent"
          >
            <Square className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!instruction.trim()}
            aria-label="Submit"
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <ArrowUp className="size-3.5" />
          </button>
        )}
      </div>
    </AiChrome>
  );
}
