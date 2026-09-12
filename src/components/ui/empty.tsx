import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
