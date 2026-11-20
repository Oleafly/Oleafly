import { Minus, Plus } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FloatingBar } from "@/components/ui/floating-bar";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";

export interface ZoomBarLabels {
  readonly zoomOut: string;
  readonly zoomIn: string;
  readonly zoomOutTooltip?: ReactNode;
  readonly zoomInTooltip?: ReactNode;
  readonly value?: string;
}

export interface ZoomBarProps extends Omit<ComponentProps<"div">, "children" | "role"> {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onStep: (direction: -1 | 1) => void;
  readonly onReset: () => void;
  readonly resetLabel: string;
  readonly resetIcon?: ReactNode;
  readonly resetDisabled?: boolean;
  readonly size?: "sm" | "md";
  readonly labels: ZoomBarLabels;
}

const VALUE_SIZES = {
  sm: "min-w-12 text-xs font-medium",
  md: "min-w-14 text-sm font-semibold",
} as const;

export function ZoomBar({
  value,
  min,
  max,
  onStep,
  onReset,
  resetLabel,
  resetIcon,
  resetDisabled = false,
  size = "md",
  labels,
  ...bar
}: ZoomBarProps) {
  return (
    <FloatingBar {...bar}>
      <TooltipIconButton
        label={labels.zoomOut}
        tooltip={labels.zoomOutTooltip}
        side="top"
        className="rounded-full"
        disabled={value <= min}
        onClick={() => onStep(-1)}
      >
        <Minus aria-hidden />
      </TooltipIconButton>
      <output aria-label={labels.value} className={cn("text-center tabular-nums", VALUE_SIZES[size])}>
        {formatNumber(value, { style: "percent", maximumFractionDigits: 0 })}
      </output>
      <TooltipIconButton
        label={labels.zoomIn}
        tooltip={labels.zoomInTooltip}
        side="top"
        className="rounded-full"
        disabled={value >= max}
        onClick={() => onStep(1)}
      >
        <Plus aria-hidden />
      </TooltipIconButton>
      {resetIcon ? (
        <TooltipIconButton label={resetLabel} side="top" className="rounded-full" disabled={resetDisabled} onClick={onReset}>
          {resetIcon}
        </TooltipIconButton>
      ) : (
        <>
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-full text-muted-foreground"
            disabled={resetDisabled}
            onClick={onReset}
          >
            {resetLabel}
          </Button>
        </>
      )}
    </FloatingBar>
  );
}
