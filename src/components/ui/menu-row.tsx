import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MenuRow({
  icon,
  label,
  onClick,
  className,
}: Readonly<{
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
  className?: string;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:bg-accent",
        className,
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
