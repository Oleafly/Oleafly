import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const ALERT_SIZE = {
  xs: { text: "text-xs", icon: "size-3.5" },
  sm: { text: "text-sm", icon: "size-4" },
} as const;

export interface InlineAlertProps {
  readonly children: ReactNode;
  readonly id?: string;
  readonly className?: string;
  readonly icon?: LucideIcon;
  readonly bordered?: boolean;
  readonly size?: keyof typeof ALERT_SIZE;
}

export function InlineAlert({ children, id, className, icon: Icon, bordered = false, size = "xs" }: InlineAlertProps) {
  const scale = ALERT_SIZE[size];
  return (
    <p
      id={id}
      role="alert"
      className={cn(
        "select-text rounded-md bg-destructive/10 px-3 py-2 text-destructive",
        scale.text,
        bordered && "border border-destructive/30 px-2.5",
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
