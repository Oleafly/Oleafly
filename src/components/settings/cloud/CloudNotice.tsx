import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CloudNoticeTone = "warning" | "danger";

const TONE_CLASS: Readonly<Record<CloudNoticeTone, string>> = {
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

const MESSAGE_CLASS = "block min-w-0 flex-1 basis-48 leading-relaxed";

export function CloudNotice({
  tone,
  icon: Icon,
  testId,
  className,
  actions,
  details,
  children,
}: Readonly<{
  tone: CloudNoticeTone;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  testId?: string;
  className?: string;
  actions?: ReactNode;
  details?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <div data-testid={testId} className={cn("rounded-lg border px-3 py-2.5 text-xs", TONE_CLASS[tone], className)}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {tone === "danger" ? (
          <div role="alert" className={MESSAGE_CLASS}>
            {children}
          </div>
        ) : (
          <output className={MESSAGE_CLASS}>{children}</output>
        )}
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 self-center">{actions}</div> : null}
      </div>
      {details}
    </div>
  );
}
