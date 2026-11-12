import { ChevronRight } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { DELEGATED_TOOLTIP_ATTRIBUTE } from "@/components/ui/delegated-tooltip";
import { cn } from "@/lib/utils";

export function TreeRow({
  depth,
  expanded,
  onToggle,
  toggleLabel,
  active = false,
  onSelect,
  label,
  labelRef,
  labelClassName,
  ariaLabel,
  tooltip,
  trailing,
}: Readonly<{
  depth: number;
  expanded?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
  active?: boolean;
  onSelect: () => void;
  label: ReactNode;
  labelRef?: Ref<HTMLButtonElement>;
  labelClassName?: string;
  ariaLabel?: string;
  tooltip?: string;
  trailing?: ReactNode;
}>) {
  return (
    <div
      style={{ paddingLeft: `${depth * 12 + 12 - (active ? 2 : 0)}px` }}
      className={cn(
        "group flex min-h-7 w-full items-center gap-1 py-1 pr-2 text-[0.8125rem] leading-5 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        active
          ? "border-l-2 border-primary bg-sidebar-accent/60 font-medium text-sidebar-foreground"
          : "text-sidebar-foreground/80",
      )}
    >
      {expanded === undefined ? null : (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={toggleLabel}
          onClick={onToggle}
          className="flex size-3.5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-sidebar-foreground focus-visible:bg-accent/60"
        >
          <ChevronRight aria-hidden className={cn("size-3 transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />
        </button>
      )}
      <button
        type="button"
        ref={labelRef}
        aria-current={active ? "location" : undefined}
        aria-label={ariaLabel}
        {...(tooltip ? { [DELEGATED_TOOLTIP_ATTRIBUTE]: tooltip } : {})}
        onClick={onSelect}
        className={cn("min-w-0 flex-1 truncate text-left text-[0.8125rem] leading-5 focus-visible:bg-accent/60", labelClassName)}
      >
        {label}
      </button>
      {trailing}
    </div>
  );
}
