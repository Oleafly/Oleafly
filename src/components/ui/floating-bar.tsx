import type { ComponentProps } from "react";
import { cn, GLASS_PANEL } from "@/lib/utils";

export function FloatingBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="toolbar"
      {...props}
      className={cn("flex items-center gap-1 rounded-full p-1", GLASS_PANEL, className)}
    />
  );
}
