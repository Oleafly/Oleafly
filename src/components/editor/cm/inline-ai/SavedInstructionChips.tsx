import { useState, type MouseEventHandler, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Tooltip } from "@/components/ui/tooltip";
import type { SavedInstruction } from "@/lib/tauri";

const SUGGESTED_INSTRUCTIONS = 5;

export function SavedInstructionChips({
  instructions,
  picked,
  onToggle,
  onMouseDown,
  children,
}: Readonly<{
  instructions: readonly SavedInstruction[];
  picked: readonly string[];
  onToggle: (id: string) => void;
  onMouseDown?: MouseEventHandler<HTMLButtonElement>;
  children?: ReactNode;
}>) {
  const { t } = useTranslation(["editor"]);
  const [expanded, setExpanded] = useState(false);
  const chosen = new Set(picked);
  const shown = expanded
    ? instructions
    : instructions.filter((entry, index) => index < SUGGESTED_INSTRUCTIONS || chosen.has(entry.id));
  const hidden = instructions.length - shown.length;
  if (instructions.length === 0 && !children) return null;
  return (
    <fieldset aria-label={t(($) => $.editor.savedInstructions.label)} className="m-0 min-w-0 border-0 p-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {shown.map((instruction) => {
          const on = chosen.has(instruction.id);
          return (
            <Tooltip key={instruction.id} label={instruction.text} wide>
              <Chip pressed={on} onClick={() => onToggle(instruction.id)} onMouseDown={onMouseDown}>
                {on ? <Check aria-hidden /> : null}
                <span className="truncate">{instruction.name}</span>
              </Chip>
            </Tooltip>
          );
        })}
        {hidden > 0 ? (
          <Chip onClick={() => setExpanded(true)} onMouseDown={onMouseDown}>
            {t(($) => $.editor.savedInstructions.more, { count: hidden })}
          </Chip>
        ) : null}
        {children}
      </div>
    </fieldset>
  );
}
