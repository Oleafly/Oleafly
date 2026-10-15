import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Stat {
  readonly id: string;
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
}

export function StatGrid({ stats, className }: Readonly<{ stats: readonly Stat[]; className?: string }>) {
  return (
    <dl className={cn("grid grid-cols-2 gap-px border-t bg-border text-xs sm:grid-cols-4", className)}>
      {stats.map((item) => (
        <div key={item.id} data-stat={item.id} className="min-w-0 bg-card px-3 py-3">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 truncate text-sm font-semibold text-foreground">{item.value}</dd>
          {item.detail ? (
            <dd className="mt-0.5 truncate text-[0.625rem] text-muted-foreground">{item.detail}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
