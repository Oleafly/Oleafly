import * as React from "react";
import { cn } from "@/lib/utils";

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pressed?: boolean;
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ pressed, className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center justify-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3 [&_svg]:shrink-0",
        pressed
          ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 focus-visible:bg-primary/20"
          : "border-border bg-muted text-foreground hover:border-primary/50 hover:bg-accent focus-visible:border-primary/50 focus-visible:bg-accent",
        className,
      )}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";
