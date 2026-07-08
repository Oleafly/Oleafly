import { useEffect, useRef } from "react";
import { ArrowUp, Sparkles, Square, X } from "lucide-react";
import { PRESETS } from "@/lib/ai-inline";

/**
 * The instruction input + preset chips shown when opening an inline AI edit.
 * Presentational: all state lives in the overlay / session store.
 */
export function PromptPopover({
  instruction,
  onInstruction,
  onSubmit,
  onPreset,
  onClose,
  streaming,
  onStop,
  modelLabel,
}: {
  instruction: string;
  onInstruction: (v: string) => void;
  onSubmit: () => void;
  onPreset: (instruction: string) => void;
  onClose: () => void;
  streaming: boolean;
  onStop: () => void;
  modelLabel: string;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // Auto-grow the textarea with its content, up to a cap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: instruction is the resize trigger, not read in the body.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [instruction]);

  return (
    <div className="w-full rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-1 size-4 shrink-0 text-primary" />
        <textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => onInstruction(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter inserts a newline.
            if (e.key === "Enter" && !e.shiftKey && !streaming && instruction.trim()) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Describe the change…  (Shift+Enter for a new line)"
          disabled={streaming}
          rows={2}
          className="min-h-[2.75rem] min-w-0 flex-1 resize-none bg-transparent text-sm leading-snug outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
      </div>

      {!streaming && (
        <div className="mt-2 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPreset(p.instruction)}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
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
        <span className="max-w-[45%] shrink-0 truncate text-[10px] text-muted-foreground">
          {modelLabel}
        </span>
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
