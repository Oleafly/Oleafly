import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const ALERT_SIZE = {
  xs: { text: "text-xs", icon: "size-3.5" },
  sm: { text: "text-sm", icon: "size-4" },
} as const;

const ALERT_TONE = {
  destructive: { text: "bg-destructive/10 text-destructive", border: "border-destructive/30" },
  warning: { text: "bg-amber-500/10 text-amber-700 dark:text-amber-300", border: "border-amber-500/30" },
} as const;

export interface InlineAlertProps {
  readonly children: ReactNode;
  readonly id?: string;
  readonly className?: string;
  readonly icon?: LucideIcon;
  readonly bordered?: boolean;
  readonly size?: keyof typeof ALERT_SIZE;
  readonly tone?: keyof typeof ALERT_TONE;
}

export function InlineAlert({
  children,
  id,
  className,
  icon: Icon,
  bordered = false,
  size = "xs",
  tone = "destructive",
}: InlineAlertProps) {
  const scale = ALERT_SIZE[size];
  const colors = ALERT_TONE[tone];
  return (
    <p
      id={id}
      role="alert"
      className={cn(
        "select-text rounded-md px-3 py-2",
        colors.text,
        scale.text,
        bordered && cn("border px-2.5", colors.border),
        Icon && "flex items-start gap-2",
        className,
      )}
    >
      {Icon ? (
        <>
          <Icon aria-hidden className={cn("mt-0.5 shrink-0", scale.icon)} />
          <span>{children}</span>
        </>
      ) : (
        children
      )}
    </p>
  );
}
