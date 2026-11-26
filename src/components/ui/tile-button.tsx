import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TILE = "h-24 min-w-0 flex-col items-start justify-between gap-1 whitespace-normal rounded-xl bg-card p-3.5 text-left font-normal";

export type TileButtonProps = Omit<ButtonProps, "children"> & { icon: ReactNode; name: string; hint: ReactNode };

export function TileButton({ icon, name, hint, className, ...props }: Readonly<TileButtonProps>) {
  return (
    <Button type="button" variant="outline" className={cn(TILE, className)} {...props}>
      {icon}
      <span className="flex w-full min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold leading-tight">{name}</span>{" "}
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
      </span>
    </Button>
  );
}
