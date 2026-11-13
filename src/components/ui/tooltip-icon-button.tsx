import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type TooltipIconButtonProps = Readonly<
  {
    label: string;
    tooltip?: ReactNode;
    side?: "top" | "bottom" | "left" | "right";
    children: ReactNode;
  } & Omit<ComponentProps<typeof Button>, "aria-label" | "children">
>;

export function TooltipIconButton({ label, tooltip, side = "bottom", className, children, ...props }: TooltipIconButtonProps) {
  return (
    <Tooltip label={tooltip ?? label} side={side}>
      <Button variant="ghost" size="icon" {...props} aria-label={label} className={cn("size-7", className)}>
        {children}
      </Button>
    </Tooltip>
  );
}
