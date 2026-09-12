import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ToolSplitView({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-2 md:overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function ToolPane({ title, badge, actions, footer, children, className }: {
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cn("flex min-h-80 min-w-0 flex-col border-b last:border-0 md:min-h-0 md:border-b-0 md:border-r", className)}>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
          {badge && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{badge}</span>}
        </div>
        {actions}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
      {footer && <div className="shrink-0 border-t px-4 py-3">{footer}</div>}
    </section>
  );
}

export function ToolPreviewSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative m-4 flex min-h-64 flex-1 flex-col rounded-xl bg-muted/30 p-6 md:p-8", className)}>
      {children}
    </div>
  );
}

export function ToolStatus({ state, children }: { state: "ready" | "busy" | "error"; children: ReactNode }) {
  return (
    <span role="status" className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", state === "error" ? "bg-destructive" : state === "busy" ? "animate-pulse bg-amber-500 motion-reduce:animate-none" : "bg-emerald-500")} />
      {children}
    </span>
  );
}

export function ToolSegmentedControl<Value extends string>({ label, value, options, onChange }: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string; testId?: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <fieldset aria-label={label} className="flex min-w-0 max-w-full items-center overflow-x-auto rounded-full bg-muted p-0.5 text-xs font-medium">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          data-testid={option.testId}
          onClick={() => onChange(option.value)}
          className={cn("shrink-0 rounded-full px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value === option.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
