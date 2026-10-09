import { ChevronDown, ChevronRight, MoreHorizontal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const SIDEBAR_TITLE_CLASS =
  "text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/75";

export function SidebarPanelHeader({
  icon: Icon,
  title,
  adornment,
  children,
  className,
}: Readonly<{
  icon: LucideIcon;
  title: string;
  adornment?: ReactNode;
  children?: ReactNode;
  className?: string;
}>) {
  return (
    <header
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2.5",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <h2 title={title} className={cn("min-w-0 truncate", SIDEBAR_TITLE_CLASS)}>
        {title}
      </h2>
      {adornment}
      {children ? (
        <>
          <span aria-hidden className="flex-1" />
          {children}
        </>
      ) : null}
    </header>
  );
}

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
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left [&_svg]:shrink-0",
            SIDEBAR_TITLE_CLASS,
          )}
        >
          {open ? (
            <ChevronDown aria-hidden className="size-3 shrink-0" />
          ) : (
            <ChevronRight aria-hidden className="size-3 shrink-0" />
          )}
          {icon}
          <span title={title} className="truncate">{title}</span>
          {typeof count === "number" ? (
            <output
              aria-label={countLabel}
              className={cn(
                badgeVariants({ variant: "primaryGhost", size: "sm" }),
                "font-mono font-normal tabular-nums tracking-normal",
              )}
            >
              {count}
            </output>
          ) : null}
          {titleAdornment}
        </button>
        {actions ? (
          <div
            data-testid={`${id}-actions`}
            className="hidden shrink-0 items-center gap-0.5 text-muted-foreground group-hover/section:flex group-focus-within/section:flex has-[[data-state=open]]:flex"
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
                className="hidden size-6 text-muted-foreground group-hover/section:inline-flex group-focus-within/section:inline-flex data-[state=open]:inline-flex"
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
