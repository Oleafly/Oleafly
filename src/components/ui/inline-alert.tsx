import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function InlineAlert({ children, id, className }: Readonly<{ children: ReactNode; id?: string; className?: string }>) {
  return (
    <p id={id} role="alert" className={cn("select-text rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive", className)}>
      {children}
    </p>
  );
}
