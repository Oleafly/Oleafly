import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Shared Explorer and Source Control section chrome. The caller owns the
 * content state so a resizable panel can remain the source of truth for its
 * collapsed size while this component keeps the header reachable.
 */
export function SidebarSection({
  id,
  title,
  icon,
  ariaLabel,
  ariaBusy,
  menuLabel,
  count,
  countLabel,
  titleAdornment,
  open,
  onOpenChange,
  actions,
  menu,
  children,
  className,
  contentClassName,
}: Readonly<{
  id: string;
  title: string;
  icon?: ReactNode;
  ariaLabel?: string;
  ariaBusy?: boolean;
  menuLabel?: string;
  count?: number;
  countLabel?: string;
  titleAdornment?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: ReactNode;
  menu?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}>) {
  const contentId = `${id}-content`;
  return (
    <section
      data-testid={id}
      aria-label={ariaLabel ?? title}
      aria-busy={ariaBusy}
      className={cn(
        "group/section flex min-h-0 flex-col border-b border-sidebar-border",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-8 shrink-0 items-center pr-2 transition-colors hover:bg-sidebar-accent focus-within:bg-sidebar-accent",
          open && "border-b border-sidebar-border/65",
        )}
      >
        <button
          type="button"
          aria-label={title}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => onOpenChange(!open)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown aria-hidden className="size-3 shrink-0" />
          ) : (
            <ChevronRight aria-hidden className="size-3 shrink-0" />
          )}
          {icon}
          <span className="truncate">{title}</span>
          {typeof count === "number" ? (
            <output
              aria-label={countLabel}
              className="shrink-0 rounded-sm bg-muted px-1 font-mono text-[9px] font-normal tracking-normal text-muted-foreground"
            >
              {count}
            </output>
          ) : null}
          {titleAdornment}
        </button>
        {actions ? (
          <div
            data-testid={`${id}-actions`}
            className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100"
          >
            {actions}
          </div>
        ) : null}
        {menu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100 focus-visible:opacity-100"
                aria-label={menuLabel ?? title}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div
        id={contentId}
        hidden={!open}
        className={cn("min-h-0 pb-1", contentClassName)}
      >
        {open ? children : null}
      </div>
    </section>
  );
}
