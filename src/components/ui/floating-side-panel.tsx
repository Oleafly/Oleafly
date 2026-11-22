import type { CSSProperties, ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FloatingSidePanelProps {
  id?: string;
  open: boolean;
  side: "left" | "right";
  title: ReactNode;
  ariaLabel?: string;
  icon?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  width?: string;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function FloatingSidePanel({
  id,
  open,
  side,
  title,
  ariaLabel,
  icon,
  closeLabel,
  onClose,
  width = "19rem",
  headerActions,
  footer,
  children,
  className,
  bodyClassName,
}: Readonly<FloatingSidePanelProps>) {
  const hidden = side === "left" ? "-translate-x-[calc(100%_+_1rem)]" : "translate-x-[calc(100%_+_1rem)]";
  return (
    <aside
      id={id}
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
      inert={!open}
      data-side={side}
      data-state={open ? "open" : "closed"}
      style={{ "--floating-side-panel-width": width } as CSSProperties}
      className={cn(
        "absolute inset-y-2 z-30 flex w-[min(var(--floating-side-panel-width),calc(100%-1rem))] flex-col overflow-hidden rounded-lg border bg-popover/80 text-popover-foreground shadow-xl backdrop-blur-xl supports-[not(backdrop-filter:blur(0))]:bg-popover",
        "transition-transform duration-200 ease-out motion-reduce:transition-none",
        side === "left" ? "left-2" : "right-2",
        open ? "translate-x-0" : hidden,
        className,
      )}
    >
      <div className="flex min-h-11 items-center justify-between gap-2 px-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {icon ? (
            <span aria-hidden className="flex shrink-0 text-muted-foreground [&_svg]:size-4">
              {icon}
            </span>
          ) : null}
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {headerActions}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div data-side-panel-body className={cn("min-h-0 flex-1 overflow-auto p-2", bodyClassName)}>
        {children}
      </div>
      {footer ? <div className="flex items-center justify-between gap-2 border-t px-3 py-2">{footer}</div> : null}
    </aside>
  );
}
