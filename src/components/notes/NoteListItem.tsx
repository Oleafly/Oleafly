import { ChevronDown, MoreHorizontal } from "lucide-react";
import { type ComponentProps, type ComponentType, createContext, type ReactNode, useContext, useId } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const PanelSections = createContext(false);

export function NotePanelSections({ children }: Readonly<{ children: ReactNode }>) {
  return <PanelSections.Provider value>{children}</PanelSections.Provider>;
}

export function useNotePanelSections(): boolean {
  return useContext(PanelSections);
}

type NoteListItemProps = Readonly<
  {
    icon: ReactNode;
    title: ReactNode;
    meta?: ReactNode;
    snippet?: ReactNode;
    badge?: ReactNode;
    active?: boolean;
    trailing?: ReactNode;
  } & Omit<ComponentProps<"button">, "title" | "type" | "children">
>;

export function NoteListItem({
  icon,
  title,
  meta,
  snippet,
  badge,
  active = false,
  trailing,
  className,
  ...button
}: NoteListItemProps) {
  const id = useId();
  const described = [meta ? `${id}-meta` : "", snippet ? `${id}-snippet` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div
      className={cn(
        "group/row relative flex items-start gap-0.5 rounded-md transition-colors hover:bg-accent has-[button:focus-visible]:bg-accent motion-reduce:transition-none",
        trailing && "pr-1",
        active && "bg-primary/10 hover:bg-primary/15 has-[button:focus-visible]:bg-primary/15",
      )}
    >
      <button
        type="button"
        aria-labelledby={`${id}-title`}
        aria-describedby={described}
        {...button}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-1.5 text-left before:absolute before:inset-0 before:rounded-md",
          className,
        )}
      >
        <span className="mt-0.5 flex shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1">
            <span id={`${id}-title`} className="truncate text-sm font-medium text-foreground">
              {title}
            </span>
            {badge}
          </span>
          {meta ? (
            <span id={`${id}-meta`} className="mt-0.5 block truncate text-xs text-muted-foreground">
              {meta}
            </span>
          ) : null}
          {snippet ? (
            <span id={`${id}-snippet`} className="-mb-0.5 line-clamp-2 py-0.5 text-xs text-muted-foreground">
              {snippet}
            </span>
          ) : null}
        </span>
      </button>
      {trailing}
    </div>
  );
}

export function RowMark({
  label,
  icon: Icon,
  className,
  ...span
}: Readonly<
  { label: string; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> } & Omit<
    ComponentProps<"span">,
    "children" | "role" | "aria-label"
  >
>) {
  return (
    <Tooltip label={label}>
      <span role="img" aria-label={label} {...span} className={cn("flex shrink-0 items-center", className)}>
        <Icon aria-hidden className="size-3.5" />
      </span>
    </Tooltip>
  );
}

export function NoteRowMenu({
  label,
  testId,
  onCloseAutoFocus,
  children,
}: Readonly<{ label: string; testId?: string; onCloseAutoFocus?: (event: Event) => void; children: ReactNode }>) {
  return (
    <DropdownMenu>
      <Tooltip label={label} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            data-testid={testId}
            className="mt-1 size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 focus-visible:bg-background/60 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:opacity-100"
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={onCloseAutoFocus}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NoteSectionToggle({
  open,
  count,
  className,
  children,
  ...button
}: Readonly<{ open: boolean; count?: number } & Omit<ComponentProps<"button">, "type" | "aria-expanded">>) {
  const panel = useNotePanelSections();
  const chevron = (
    <ChevronDown
      aria-hidden
      className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", !open && "-rotate-90", panel && "ml-auto text-muted-foreground")}
    />
  );
  return (
    <button
      type="button"
      aria-expanded={open}
      {...button}
      className={cn(
        "flex items-center gap-1 rounded-md font-medium transition-colors hover:bg-accent focus-visible:bg-accent motion-reduce:transition-none",
        panel ? "h-8 w-full px-2 text-left text-sm text-foreground" : "h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {panel ? null : chevron}
      {children}
      {count === undefined ? null : (
        <>
          {" "}
          <span className={cn("tabular-nums", panel && "text-xs text-muted-foreground")}>{count}</span>
        </>
      )}
      {panel ? chevron : null}
    </button>
  );
}

export function NoteLinkSection({
  title,
  footer,
  open,
  count,
  empty,
  onOpenChange,
  className,
  children,
  ...section
}: Readonly<
  {
    title: ReactNode;
    footer?: ReactNode;
    open?: boolean;
    count?: number;
    empty?: ReactNode;
    onOpenChange?: (open: boolean) => void;
  } & Omit<ComponentProps<"section">, "title">
>) {
  const headingId = useId();
  const listId = useId();
  const panel = useNotePanelSections();
  const shown = open ?? true;
  const place = onOpenChange ? "pt-3" : "pt-4";
  return (
    <section {...section} aria-labelledby={headingId} className={cn(panel ? "border-b px-1.5 py-1" : cn("mt-12 border-t", place), className)}>
      {onOpenChange ? (
        <h2 className={cn(!panel && "ml-0.5")}>
          <NoteSectionToggle open={shown} count={count} aria-controls={listId} onClick={() => onOpenChange(!shown)}>
            <span id={headingId}>{title}</span>
          </NoteSectionToggle>
        </h2>
      ) : (
        <h2 id={headingId} className="px-2 text-xs font-medium text-muted-foreground">
          {title}
        </h2>
      )}
      <ul id={listId} hidden={!shown} className={cn("space-y-0.5", panel && "pb-1", !panel && (onOpenChange ? "mt-1" : "mt-2"))}>
        {panel && shown && count === 0 && empty ? <li className="px-2 py-1 text-xs text-muted-foreground">{empty}</li> : null}
        {shown ? children : null}
      </ul>
      {shown ? footer : null}
    </section>
  );
}
