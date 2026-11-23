import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, BookmarkPlus, Settings2, Square, X } from "lucide-react";
import { PRESETS } from "@/lib/ai-inline";
import { SAVED_INSTRUCTION_LIMITS, suggestInstructionName } from "@/lib/saved-instructions";
import type { SavedInstruction } from "@/lib/tauri";
import { AiChrome, AiMark } from "@/components/ai/AiChrome";
import { isImeEnter } from "@/components/ai/composer/ime";
import { ModelSelector, type ModelSelectorGroup } from "@/components/ai/ModelSelector";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { SavedInstructionChips } from "./SavedInstructionChips";

export const NAMING_SELECTOR = "[data-instruction-naming]";

function NamingRow({
  initial,
  onSave,
  onCancel,
}: Readonly<{ initial: string; onSave: (name: string) => void; onCancel: () => void }>) {
  const { t } = useTranslation(["common", "editor"]);
  const [name, setName] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);
  const save = () => {
    if (name.trim()) onSave(name.trim());
  };
  return (
    <div data-instruction-naming="" className="flex items-center gap-1.5">
      <Input
        ref={inputRef}
        value={name}
        maxLength={SAVED_INSTRUCTION_LIMITS.name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !isImeEnter(event)) {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        aria-label={t(($) => $.editor.savedInstructions.nameLabel)}
        placeholder={t(($) => $.editor.savedInstructions.nameLabel)}
        className="h-7 min-w-0 flex-1 px-2 text-xs"
      />
      <Button size="xs" onClick={save} disabled={!name.trim()}>
        {t(($) => $.common.actions.save)}
      </Button>
      <Button size="xs" variant="ghost" onClick={onCancel}>
        {t(($) => $.common.actions.cancel)}
      </Button>
    </div>
  );
}

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
  saved = [],
  picked = [],
  onToggleSaved,
  canSave = false,
  onSave,
  onManage,
}: Readonly<{
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
  saved?: readonly SavedInstruction[];
  picked?: readonly string[];
  onToggleSaved?: (id: string) => void;
  canSave?: boolean;
  onSave?: (name: string) => void;
  onManage?: () => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: instruction is the resize trigger, not read in the body.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [instruction]);
  useEffect(() => {
    if (!canSave) setNaming(false);
  }, [canSave]);

  const ready = instruction.trim() !== "" || picked.length > 0;
  const stopNaming = () => {
    setNaming(false);
    inputRef.current?.focus({ preventScroll: true });
  };
  const showSaved = !streaming && (saved.length > 0 || canSave);

  return (
    <AiChrome
      borderVariant="primary"
      className="w-full"
      contentClassName="ai-surface-elevated p-2 text-popover-foreground"
    >
      <div className="flex items-start gap-2">
        <AiMark className="mt-0.5" />
        <Textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => onInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !isImeEnter(e) && !streaming && ready) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={t(($) => $.editor.inlineAi.promptPlaceholder)}
          disabled={streaming}
          rows={2}
          className="min-h-[2.75rem] min-w-0 flex-1 resize-none border-0 bg-transparent text-sm leading-snug shadow-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={t(($) => $.common.actions.close)}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {showSaved && (
        <div className="mt-2">
          {naming && onSave ? (
            <NamingRow
              initial={suggestInstructionName(instruction)}
              onSave={(name) => {
                onSave(name);
                stopNaming();
              }}
              onCancel={stopNaming}
            />
          ) : (
            <SavedInstructionChips instructions={saved} picked={picked} onToggle={(id) => onToggleSaved?.(id)}>
              {canSave && onSave ? (
                <Chip onClick={() => setNaming(true)}>
                  <BookmarkPlus aria-hidden />
                  {t(($) => $.editor.savedInstructions.save)}
                </Chip>
              ) : null}
              {saved.length > 0 && onManage ? (
                <TooltipIconButton
                  label={t(($) => $.editor.savedInstructions.manage)}
                  onClick={onManage}
                  className="size-6 text-muted-foreground [&_svg]:size-3.5"
                >
                  <Settings2 />
                </TooltipIconButton>
              ) : null}
            </SavedInstructionChips>
          )}
        </div>
      )}

      {!streaming && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
          {PRESETS.map((p) => (
            <Chip key={p.id} onClick={() => onPreset(p.instruction)} className="flex-1">
              {p.label}
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {streaming && (
            <span className="ai-shimmer text-[0.625rem] font-medium">
              {t(($) => $.editor.inlineAi.thinking)}
            </span>
          )}
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
            aria-label={t(($) => $.editor.inlineAi.stop)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground hover:bg-accent"
          >
            <Square className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!ready}
            aria-label={t(($) => $.editor.inlineAi.submit)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <ArrowUp className="size-3.5" />
          </button>
        )}
      </div>
    </AiChrome>
  );
}
