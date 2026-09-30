import { lazy, Suspense } from "react";
import { cn } from "@/lib/utils";

const InlineDiffPreview = lazy(() =>
  import("@/components/editor/diff/InlineDiffPreview").then((module) => ({
    default: module.InlineDiffPreview,
  })),
);

/**
 * A read-only unified diff, loaded on demand so the chat does not pull the
 * diff editor in until someone opens a change. The scroller is focusable and
 * named so keyboard users can scroll it; focus shows as a border colour.
 */
export function DiffPreview({
  path,
  oldText,
  newText,
  label,
  loadingLabel,
  className,
}: Readonly<{
  path: string;
  oldText: string;
  newText: string;
  label: string;
  loadingLabel: string;
  className?: string;
}>) {
  return (
    <div className={cn("overflow-hidden rounded-md border transition-colors focus-within:border-ring", className)}>
      <Suspense fallback={<p className="px-3 py-2 text-[11px] text-muted-foreground">{loadingLabel}</p>}>
        <InlineDiffPreview path={path} oldText={oldText} newText={newText} ariaLabel={label} className="h-56" />
      </Suspense>
    </div>
  );
}
