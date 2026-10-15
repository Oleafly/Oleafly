import type { KeyboardEvent, ReactNode, SyntheticEvent } from "react";
import { Info } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const TRIGGER_CLASS =
  "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground";

function keepTooltipOpen(event: SyntheticEvent) {
  event.stopPropagation();
}

function keepTooltipOpenOnKey(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === " ") event.stopPropagation();
}

export function InfoHint({
  label,
  children,
  href,
  side = "bottom",
  className,
}: Readonly<{
  label: string;
  children: ReactNode;
  href?: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}>) {
  return (
    <Tooltip wide side={side} label={children}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          data-testid="info-hint"
          className={cn(TRIGGER_CLASS, className)}
        >
          <Info aria-hidden className="size-3.5" />
        </a>
      ) : (
        <button
          type="button"
          aria-label={label}
          data-testid="info-hint"
          className={cn(TRIGGER_CLASS, "cursor-help", className)}
          onMouseDown={keepTooltipOpen}
          onClick={keepTooltipOpen}
          onKeyDown={keepTooltipOpenOnKey}
        >
          <Info aria-hidden className="size-3.5" />
        </button>
      )}
    </Tooltip>
  );
}
