import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  id,
  label,
  value,
  detail,
  className,
}: Readonly<{
  id?: string;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
}>) {
  return (
    <div data-stat={id} className={cn("min-w-0 rounded-lg border bg-card p-3", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      {detail ? <dd className="mt-1 text-[0.6875rem] text-muted-foreground">{detail}</dd> : null}
    </div>
  );
}
