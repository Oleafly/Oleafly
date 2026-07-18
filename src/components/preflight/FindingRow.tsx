import { memo, useState } from "react";
import { AlertCircle, AlertTriangle, ChevronRight, CornerDownLeft, Info } from "lucide-react";
import type { Finding, Severity } from "@openleaf/preflight";
import { gotoRange } from "@/components/editor/cm/controller";
import { cn } from "@/lib/utils";

const SEV: Record<Severity, { icon: typeof Info; color: string; label: string }> = {
  error: { icon: AlertCircle, color: "text-red-500", label: "Error" },
  warning: { icon: AlertTriangle, color: "text-amber-500", label: "Warning" },
  info: { icon: Info, color: "text-muted-foreground", label: "Note" },
};

const LENS_LABEL: Record<Finding["lens"], string> = {
  ats: "ATS",
  a11y: "Accessibility",
  both: "ATS + Accessibility",
  refs: "References",
};

export const FindingRow = memo(function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const sev = SEV[finding.severity];
  const Icon = sev.icon;
  const sourceRange =
    typeof finding.from === "number" && typeof finding.to === "number"
      ? { from: finding.from, to: finding.to }
      : null;

  return (
    <div className="rounded-md border border-sidebar-border bg-black/[0.03] dark:bg-background">
      <button type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-sidebar-accent"
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0", sev.color)} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug">{finding.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{LENS_LABEL[finding.lens]}</span>
            {finding.page != null && <span>· p.{finding.page}</span>}
          </span>
        </span>
        <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="border-t border-sidebar-border px-2.5 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
          {sourceRange && (
            <button type="button"
              onClick={() => gotoRange(sourceRange.from, sourceRange.to)}
              className="mt-2 inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent"
            >
              <CornerDownLeft className="size-3" /> Jump to source
            </button>
          )}
        </div>
      )}
    </div>
  );
});
