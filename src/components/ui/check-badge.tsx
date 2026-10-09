import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  primary: "bg-primary text-primary-foreground",
  success: "bg-emerald-600 text-white dark:bg-emerald-500",
} as const;

export function CheckBadge({
  className,
  tone = "primary",
}: Readonly<{ className?: string; tone?: keyof typeof TONES }>) {
  return (
    <span
      aria-hidden
      data-slot="check-badge"
      data-tone={tone}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full",
        TONES[tone],
        className,
      )}
    >
      <Check className="size-2.5" strokeWidth={3.5} />
    </span>
  );
}
