import type { ComponentType } from "react";
import { Tooltip } from "./tooltip";
import { cn } from "@/lib/utils";
export function DiffAction({
  icon: Icon,
  label,
  keyShortcut,
  onClick,
}: Readonly<{
  icon: ComponentType<{ className?: string }>;
  label: string;
  keyShortcut?: string;
  onClick: () => void;
}>) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-keyshortcuts={keyShortcut}
        className={cn(
          "inline-flex size-7 items-center justify-center text-primary transition-colors",
          "hover:bg-primary/15 focus-visible:bg-primary/15",
        )}
      >
        <Icon className="size-4" />
      </button>
    </Tooltip>
  );
}
