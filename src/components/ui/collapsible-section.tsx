import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  id,
  title,
  description,
  icon: Icon,
  trailing,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  headingLevel: Heading = "h3",
  children,
}: Readonly<{
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  trailing?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  headingLevel?: "h2" | "h3" | "h4";
  children: React.ReactNode;
}>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const contentId = `${id}-content`;
  const titleId = `${id}-title`;
  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <section
      aria-labelledby={titleId}
      data-testid={id}
      data-state={open ? "open" : "closed"}
      className={cn("overflow-hidden rounded-lg border bg-card", className)}
    >
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          data-testid={`${id}-toggle`}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
          {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
          <span className="min-w-0 flex-1">
            <Heading id={titleId} className="text-sm font-medium leading-snug">
              {title}
            </Heading>
            {description ? (
              <span className="block text-xs leading-relaxed text-muted-foreground">{description}</span>
            ) : null}
          </span>
        </button>
        {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
      </div>
      <div id={contentId} hidden={!open} className="space-y-3 px-3 pb-3">
        {open ? children : null}
      </div>
    </section>
  );
}
