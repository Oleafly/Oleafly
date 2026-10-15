import { cn } from "@/lib/utils";

export function Progress({
  value,
  indeterminate = false,
  className,
  indicatorClassName,
}: Readonly<{
  value: number;
  // Work is happening but how much is left isn't known yet.
  indeterminate?: boolean;
  className?: string;
  indicatorClassName?: string;
}>) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(percent)}
      aria-busy={indeterminate || undefined}
      data-state={indeterminate ? "indeterminate" : "determinate"}
    >
      <div
        className={cn(
          "h-full rounded-full bg-[#4285F4]",
          indeterminate
            ? "w-full animate-pulse opacity-60 motion-reduce:animate-none"
            : "transition-[width] duration-200",
          indicatorClassName,
        )}
        style={indeterminate ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
