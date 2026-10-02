import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SettingsRowProps = Readonly<
  Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
    label: ReactNode;
    description?: ReactNode;
    adornment?: ReactNode;
    details?: ReactNode;
    icon?: ReactNode;
    control?: ReactNode;
    testId?: string;
  }
>;

export function SettingsRow({
  label,
  description,
  adornment,
  details,
  icon,
  control,
  testId,
  className,
  ...props
}: SettingsRowProps) {
  const title = adornment ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{label}</span>
      {adornment}
    </div>
  ) : (
    <div className="text-sm font-medium">{label}</div>
  );
  const text = (
    <div className="min-w-0">
      {title}
      {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      {details}
    </div>
  );
  return (
    <div
      data-testid={testId}
      {...props}
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg border bg-card p-3",
        className,
      )}
    >
      {icon ? (
        <div className="flex min-w-0 items-start gap-3">
          {icon}
          {text}
        </div>
      ) : (
        text
      )}
      {control}
    </div>
  );
}
