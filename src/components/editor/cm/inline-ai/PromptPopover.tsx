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
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="w-full rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-primary" />
        <input
          ref={inputRef}
          value={instruction}
          onChange={(e) => onInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !streaming && instruction.trim()) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Describe the change…"
          disabled={streaming}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
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

      <div className="mt-1.5 px-0.5 text-[10px] text-muted-foreground">
        {streaming ? "Generating…" : `Enter to run · ${modelLabel}`}
      </div>
    </div>
  );
}
