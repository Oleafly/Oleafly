import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CheckBadge({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden
      data-slot="check-badge"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground",
        className,
      )}
    >
      <Check className="size-2.5" strokeWidth={3.5} />
    </span>
  );
}
