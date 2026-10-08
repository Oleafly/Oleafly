import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type StateSize = "default" | "compact";

const STATE_TEXT: Record<StateSize, { title: string; description: string; body: string }> = {
  default: {
    title: "text-sm font-medium",
    description: "mt-1 max-w-sm text-xs text-muted-foreground",
    body: "text-sm",
  },
  compact: {
    title: "text-xs font-medium",
    description: "mt-1 text-[11px] text-muted-foreground",
    body: "text-xs",
  },
};

export function EmptyState({
  icon,
  title,
  description,
  children,
  size = "default",
  className,
  testId,
}: Readonly<{
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  size?: StateSize;
  className?: string;
  testId?: string;
}>) {
  const text = STATE_TEXT[size];
  return (
    <div
      data-testid={testId}
      className={cn("flex flex-col items-center justify-center gap-3 text-center", className)}
    >
      {icon}
      {title || description ? (
        <div>
          {title ? <p className={text.title}>{title}</p> : null}
          {description ? <p className={text.description}>{description}</p> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function LoadingState({
  label,
  size = "default",
  className,
  id,
  testId,
}: Readonly<{
  label: ReactNode;
  size?: StateSize;
  className?: string;
  id?: string;
  testId?: string;
}>) {
  return (
    <output
      id={id}
      data-testid={testId}
      className={cn("flex items-center gap-2 text-muted-foreground", STATE_TEXT[size].body, className)}
    >
      <Spinner size={size === "compact" ? "sm" : "md"} />
      {label}
    </output>
  );
}

export function ErrorState({
  message,
  children,
  size = "default",
  className,
}: Readonly<{
  message: ReactNode;
  children?: ReactNode;
  size?: StateSize;
  className?: string;
}>) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3", className)}>
      <p className={cn("select-text text-destructive", STATE_TEXT[size].body)}>{message}</p>
      {children}
    </div>
  );
}

export function EmptyIntro({
  eyebrow,
  title,
  description,
  className,
}: Readonly<{
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}>) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
      <h2 className="mt-2.5 text-2xl font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export function Empty({ className, children }: Readonly<{ className?: string; children: ReactNode }>) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-6 text-center", className)}>
      {children}
    </div>
  );
}

export function EmptyHeader({ className, children }: Readonly<{ className?: string; children: ReactNode }>) {
  return <div className={cn("flex flex-col items-center gap-3", className)}>{children}</div>;
}

export function EmptyMedia({
  variant = "default",
  className,
  children,
}: Readonly<{
  variant?: "default" | "icon";
  className?: string;
  children: ReactNode;
}>) {
  return (
    <div
      className={cn(
        "flex size-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground",
        variant === "icon" && "border-primary/20 bg-primary/10 text-primary",
        className
      )}
    >
      {children}
    </div>
  );
}

export function EmptyTitle({ className, children }: Readonly<{ className?: string; children: ReactNode }>) {
  return (
    <h3 className={cn("text-lg font-semibold tracking-tight", className)}>{children}</h3>
  );
}

export function EmptyDescription({ className, children }: Readonly<{ className?: string; children: ReactNode }>) {
  return (
    <p className={cn("max-w-md text-sm text-muted-foreground", className)}>{children}</p>
  );
}

export function EmptyContent({ className, children }: Readonly<{ className?: string; children: ReactNode }>) {
  return (
    <div className={cn("flex w-full flex-col items-center gap-4", className)}>{children}</div>
  );
}
