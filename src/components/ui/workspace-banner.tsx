import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type WorkspaceBannerTone = "primary" | "neutral" | "warning";

const SURFACE: Readonly<Record<WorkspaceBannerTone, string>> = {
  primary:
    "border-primary/20 bg-[color-mix(in_srgb,var(--primary)_5%,var(--background))] text-foreground",
  neutral: "border-border bg-muted text-foreground",
  warning:
    "border-amber-500/30 bg-[color-mix(in_srgb,var(--color-amber-500)_10%,var(--background))] text-amber-700 dark:text-amber-400",
};

const ACTION: Readonly<Record<WorkspaceBannerTone, string>> = {
  primary: "hover:bg-primary/10 focus-visible:border-primary/40 focus-visible:bg-primary/15",
  neutral: "hover:bg-accent focus-visible:border-border focus-visible:bg-accent",
  warning: "hover:bg-amber-500/15 focus-visible:border-amber-500/40 focus-visible:bg-amber-500/20",
};

export function WorkspaceBanner({
  tone,
  className,
  ...props
}: Readonly<HTMLAttributes<HTMLDivElement> & { tone: WorkspaceBannerTone }>) {
  return (
    <div
      {...props}
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5 text-xs",
        SURFACE[tone],
        className,
      )}
    />
  );
}

export function WorkspaceBannerAlert({ className, ...props }: Readonly<HTMLAttributes<HTMLParagraphElement>>) {
  return <p {...props} role="alert" className={cn("basis-full pb-1 pl-5.5 select-text text-destructive dark:text-red-400", className)} />;
}

export function WorkspaceBannerButton({
  tone,
  className,
  ...props
}: Readonly<Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { tone: WorkspaceBannerTone }>) {
  return (
    <button
      {...props}
      type="button"
      className={cn(
        "flex items-center gap-1 rounded border border-transparent px-2 py-0.5 font-medium transition-colors disabled:opacity-50",
        ACTION[tone],
        className,
      )}
    />
  );
}
