import * as React from "react";
import { ChevronRight } from "lucide-react";
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
      <div className="relative flex items-center gap-2 p-3">
        <button
          type="button"
          data-testid={`${id}-toggle`}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left after:absolute after:inset-0 after:content-[''] focus-visible:bg-accent/60"
        >
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
        {trailing ? <div className="relative flex shrink-0 items-center gap-2">{trailing}</div> : null}
        <ChevronRight
          aria-hidden
          data-slot="collapsible-chevron"
          className={cn(
            "pointer-events-none size-4 shrink-0 text-muted-foreground motion-safe:transition-transform",
            open && "rotate-90",
          )}
        />
      </div>
      <div id={contentId} hidden={!open} className="space-y-3 px-3 pb-3">
        {open ? children : null}
      </div>
    </section>
  );
}
