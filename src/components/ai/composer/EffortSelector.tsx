import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EffortLevel } from "@oleafly/ai-core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";

const AUTO = "auto";

/** How hard the model reasons; hidden for models without effort levels. */
export function EffortSelector({
  choices,
  value,
  onChange,
  disabled = false,
}: Readonly<{
  choices: readonly EffortLevel[];
  value: EffortLevel | undefined;
  onChange: (next: EffortLevel | undefined) => void;
  disabled?: boolean;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  if (choices.length === 0) return null;
  const levelLabel = (level: EffortLevel) => t(($) => $.ai.effort.levels[level]);
  const current = value !== undefined && choices.includes(value) ? value : undefined;
  const shown = current ? levelLabel(current) : t(($) => $.ai.effort.auto);
  return (
    <span className="ai-composer-effort inline-flex shrink-0">
      <DropdownMenu>
        <Tooltip label={t(($) => $.ai.effort.tooltip)}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              aria-label={t(($) => $.ai.effort.ariaLabel, { level: shown })}
              data-testid="ai-effort-selector"
              className="ai-composer-effort-trigger flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-accent"
            >
              <Gauge className="size-4 shrink-0" />
              <span className="ai-composer-effort-value">{shown}</span>
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t(($) => $.ai.effort.label)}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={current ?? AUTO}
            onValueChange={(next) => onChange(next === AUTO ? undefined : (next as EffortLevel))}
          >
            <DropdownMenuRadioItem value={AUTO}>
              <span className="flex min-w-0 flex-col">
                <span>{t(($) => $.ai.effort.auto)}</span>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {t(($) => $.ai.effort.autoDescription)}
                </span>
              </span>
            </DropdownMenuRadioItem>
            {choices.map((level) => (
              <DropdownMenuRadioItem key={level} value={level}>
                {levelLabel(level)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
