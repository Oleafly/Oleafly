import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap rounded-full border font-medium leading-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        quiet: "border-border bg-muted text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        primaryGhost:
          "border-primary/20 bg-primary/10 text-primary",
        success:
          "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        warning:
          "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-300",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        info: "border-transparent bg-sky-500/10 text-sky-700 dark:text-sky-300",
      },
      size: {
        default: "px-2 py-0.5 text-xs",
        sm: "px-1.5 py-0.5 text-[0.625rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
