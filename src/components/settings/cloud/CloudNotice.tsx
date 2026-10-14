import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CloudNoticeTone = "warning" | "danger";

const TONE_CLASS: Readonly<Record<CloudNoticeTone, string>> = {
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function CloudNotice({
  tone,
  icon: Icon,
  testId,
  className,
  actions,
  children,
}: Readonly<{
  tone: CloudNoticeTone;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  testId?: string;
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <output
      data-testid={testId}
      className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-xs", TONE_CLASS[tone], className)}
    >
      <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="block min-w-0 flex-1 basis-48 leading-relaxed">{children}</span>
      {actions ? <span className="flex shrink-0 flex-wrap items-center gap-2 self-center">{actions}</span> : null}
    </output>
  );
}
