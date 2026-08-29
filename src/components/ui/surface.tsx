import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// The one panel primitive: every workspace surface picks a level instead of
// hand-assembling bg/border/shadow utilities, so elevation reads consistently
// and follows the --oleafly-* tokens in src/styles/tokens.css.
const surfaceVariants = cva("min-w-0", {
  variants: {
    level: {
      base: "bg-surface text-foreground",
      raised: "rounded-lg border bg-surface-secondary text-foreground",
      sunken: "rounded-lg bg-surface-tertiary text-foreground",
      overlay:
        "rounded-lg border bg-surface-secondary text-foreground shadow-lg",
    },
    inset: {
      true: "p-3",
      false: "",
    },
  },
  defaultVariants: {
    level: "base",
    inset: false,
  },
});

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {
  asChild?: boolean;
}

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, level, inset, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        className={cn(surfaceVariants({ level, inset }), className)}
        {...props}
      />
    );
  },
);
Surface.displayName = "Surface";

export { surfaceVariants };
